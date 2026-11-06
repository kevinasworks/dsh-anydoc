/**
 * The work behind the three tools: one conversion, a batch conversion, and a
 * read-only capability report.
 *
 * Every function returns a JSON-safe object that exactly matches the output
 * schema declared in `tools.js`, and never throws for an expected failure: the
 * model gets `success: false` plus a stable `errorCode` instead of a broken
 * turn.
 *
 * @module dsh-anydoc/service
 */

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AnyDocFailure, describeFailure } from './errors.js'
import { describeLongPathRisk, describePlatformSupport } from './platform.js'
import { SUPPORTED_EXTENSIONS, extensionOf, hasSupportedExtension } from './formats.js'
import {
  allocateOutputPath,
  checkInputFile,
  isInside,
  prepareOutputDirectory,
  realpathDeep,
  resolveUserPath,
  sanitizeSegment,
  stemOf,
  writeFileSafe,
} from './paths.js'

/**
 * @param {number} startedAt a `performance.now()` reading.
 * @returns {number} elapsed milliseconds, one decimal.
 */
function elapsed(startedAt) {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

/** The shared shape of a failed single conversion. */
function emptyConvertResult() {
  return {
    success: false,
    sourcePath: '',
    resolvedPath: '',
    detectedFormat: '',
    formatSource: 'none',
    outputPath: '',
    markdownChars: 0,
    previewChars: 0,
    markdownPreview: '',
    truncated: false,
    warnings: [],
    errorCode: '',
    errorMessage: '',
    pages: [],
    assets: [],
    durationMs: 0,
    engine: '',
    bytes: 0,
  }
}

/** The shared shape of a failed batch. */
function emptyBatchResult() {
  return {
    success: false,
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    outputDir: '',
    durationMs: 0,
    results: [],
    warnings: [],
    errorCode: '',
    errorMessage: '',
  }
}

/**
 * Append an asset index to the Markdown so exported files are reachable.
 * @param {string} markdown
 * @param {ReadonlyArray<{ file: string, mediaType: string, bytes: number, originPart: string }>} written
 * @returns {string}
 */
function withAssetIndex(markdown, written) {
  if (written.length === 0) return markdown
  const lines = ['', '## Exported assets', '', 'Embedded resources extracted next to this file. Image content itself is not analysed.', '']
  for (const asset of written) {
    lines.push(`- \`${asset.file}\` — ${asset.mediaType}, ${asset.bytes} bytes (from \`${asset.originPart}\`)`)
  }
  return `${markdown}${markdown.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`
}

/**
 * Create the service bound to one plugin instance.
 *
 * @param {{
 *   config: Readonly<object>,
 *   engine: import('./engine.js').Engine,
 *   logger: { info: (message: string) => void, warn: (message: string) => void },
 *   pluginVersion: string,
 *   resolveBaseDir: (exec: object | undefined) => Promise<string>,
 * }} options
 */
export function createService({ config, engine, logger, pluginVersion, resolveBaseDir }) {
  /**
   * Resolve the working directory the caller's paths are relative to.
   * @param {object | undefined} exec tool run context.
   * @returns {Promise<string>}
   */
  async function baseDirFor(exec) {
    try {
      return await resolveBaseDir(exec)
    } catch {
      return process.cwd()
    }
  }

  /**
   * Convert one document and write its Markdown.
   * @param {{ sourcePath: string, outputDir?: string, overwrite?: boolean, exportAssets?: boolean, writeFile?: boolean }} args
   * @param {object} exec tool run context.
   * @returns {Promise<object>} the single-conversion result.
   */
  async function convert(args, exec) {
    const startedAt = performance.now()
    const result = emptyConvertResult()
    result.sourcePath = typeof args?.sourcePath === 'string' ? args.sourcePath : ''
    const baseDir = await baseDirFor(exec)

    let checked
    let outputDir
    try {
      checked = await checkInputFile(args?.sourcePath, {
        baseDir,
        allowedRoots: config.allowedRoots,
        maxFileBytes: config.maxFileBytes,
      })
      result.resolvedPath = checked.realPath
      result.bytes = checked.size
      const requestedOutputDir = typeof args?.outputDir === 'string' && args.outputDir.trim() !== '' ? args.outputDir : config.outputRoot
      outputDir = await prepareOutputDirectory(requestedOutputDir, { baseDir, allowedRoots: config.allowedRoots })
    } catch (error) {
      const failure = describeFailure(error)
      result.errorCode = failure.errorCode
      result.errorMessage = failure.errorMessage
      result.durationMs = elapsed(startedAt)
      logger.warn(`dsh-anydoc: convert failed (${failure.errorCode}) for ${result.sourcePath || '?'}: ${failure.errorMessage}`)
      return result
    }

    const extension = extensionOf(checked.realPath)
    if (!hasSupportedExtension(checked.realPath)) {
      result.warnings.push(
        `extension ".${extension}" is not in AnyDoc's documented format table; conversion was still attempted because AnyDoc detects formats from file content`,
      )
    }

    const wantAssets = args?.exportAssets === true || (args?.exportAssets === undefined && config.exportAssets)
    let payload
    try {
      payload = await engine.convert(
        { file: checked.realPath, wantAssets, maxAssetBytes: config.maxAssetBytes },
        { signal: exec?.signal, timeoutMs: config.timeoutMs },
      )
    } catch (error) {
      const failure = describeFailure(error)
      result.errorCode = failure.errorCode
      result.errorMessage = failure.errorMessage
      result.pages = failure.pages ?? []
      result.durationMs = elapsed(startedAt)
      result.engine = engine.activeMode
      logger.warn(`dsh-anydoc: convert failed (${failure.errorCode}) for ${checked.realPath}: ${failure.errorMessage}`)
      return result
    }

    result.engine = engine.activeMode
    result.detectedFormat = payload.format ?? ''
    result.formatSource = payload.formatSource
    result.warnings.push(...(payload.warnings ?? []))
    let markdown = payload.markdown ?? ''

    if (markdown.length > config.maxOutputChars) {
      result.errorCode = 'OUTPUT_TOO_LARGE'
      result.errorMessage = `converted Markdown is ${markdown.length} characters, above maxOutputChars=${config.maxOutputChars}`
      result.durationMs = elapsed(startedAt)
      logger.warn(`dsh-anydoc: ${result.errorMessage} for ${checked.realPath}`)
      return result
    }

    const writeFile = args?.writeFile !== false && config.keepMarkdownFile
    const overwrite = args?.overwrite === true
    const stem = stemOf(checked.requestedPath === '' ? checked.realPath : checked.requestedPath)
    const written = []
    try {
      if (payload.assets !== undefined && payload.assets.length > 0) {
        const assetsDir = await prepareOutputDirectory(path.join(outputDir, `${stem}.assets`), {
          baseDir,
          allowedRoots: config.allowedRoots,
        })
        for (const asset of payload.assets) {
          const fileName = `${stem}-${asset.id}.${sanitizeSegment(asset.extension, 'bin')}`
          const target = path.join(assetsDir, fileName)
          if (!isInside(target, assetsDir)) throw new AnyDocFailure('OUTPUT_UNWRITABLE', `refusing to write an asset outside its directory: ${target}`)
          const longPath = describeLongPathRisk(target)
          if (longPath !== undefined && !result.warnings.includes(longPath)) result.warnings.push(longPath)
          if (!overwrite) {
            try {
              await stat(target)
              result.warnings.push(`asset already exists and was not overwritten: ${fileName}`)
              continue
            } catch (error) {
              if (error?.code !== 'ENOENT') throw error
            }
          }
          const buffer = Buffer.from(asset.data, 'base64')
          await writeFileSafe(target, buffer, { overwrite })
          written.push({
            id: asset.id,
            // Markdown stays portable when the index uses "/" even on Windows.
            file: path.relative(outputDir, target).split(path.sep).join('/'),
            path: target,
            mediaType: asset.mediaType,
            bytes: buffer.byteLength,
            originPart: asset.originPart,
          })
        }
        markdown = withAssetIndex(markdown, written)
      }

      if (writeFile) {
        const target = await allocateOutputPath(outputDir, stem, '.md', { overwrite })
        const longPath = describeLongPathRisk(target)
        if (longPath !== undefined && !result.warnings.includes(longPath)) result.warnings.push(longPath)
        const payloadText = markdown
        await writeFileSafe(target, payloadText, { overwrite })
        result.outputPath = target
      }
    } catch (error) {
      const failure = describeFailure(error)
      result.errorCode = failure.errorCode
      result.errorMessage = failure.errorMessage
      result.durationMs = elapsed(startedAt)
      logger.warn(`dsh-anydoc: writing output failed (${failure.errorCode}) for ${checked.realPath}: ${failure.errorMessage}`)
      return result
    }

    result.success = true
    result.markdownChars = markdown.length
    result.assets = written.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, bytes: asset.bytes }))
    const requestedPreview = Number(args?.previewChars)
    const previewLimit = Number.isFinite(requestedPreview)
      ? Math.min(200_000, Math.max(0, Math.trunc(requestedPreview)))
      : config.previewChars
    result.markdownPreview = markdown.slice(0, previewLimit)
    result.previewChars = result.markdownPreview.length
    result.truncated = result.markdownPreview.length < markdown.length
    result.durationMs = elapsed(startedAt)
    logger.info(
      `dsh-anydoc: converted ${checked.realPath} -> ${result.outputPath || '(not written)'} format=${result.detectedFormat} chars=${markdown.length} assets=${written.length} ${result.durationMs}ms engine=${result.engine}`,
    )
    return result
  }

  /**
   * Expand one caller-supplied directory into candidate files.
   * @param {string} directory absolute path.
   * @param {boolean} recursive
   * @param {Set<string>} visited real paths already expanded.
   * @returns {Promise<{ files: string[], skipped: Array<{ sourcePath: string, reason: string }> }>}
   */
  async function expandDirectory(directory, recursive, visited) {
    const files = []
    const skipped = []
    const real = await realpathDeep(directory)
    if (visited.has(real)) return { files, skipped }
    visited.add(real)
    let entries
    try {
      entries = await readdir(real, { withFileTypes: true })
    } catch (error) {
      skipped.push({ sourcePath: directory, reason: `unreadable directory: ${error?.message ?? String(error)}` })
      return { files, skipped }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
    for (const entry of entries) {
      const entryPath = path.join(real, entry.name)
      if (entry.isDirectory()) {
        if (recursive) {
          const nested = await expandDirectory(entryPath, recursive, visited)
          files.push(...nested.files)
          skipped.push(...nested.skipped)
        }
        continue
      }
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(entryPath)
          if (target.isDirectory()) {
            if (recursive) {
              const nested = await expandDirectory(entryPath, recursive, visited)
              files.push(...nested.files)
              skipped.push(...nested.skipped)
            }
            continue
          }
          if (!target.isFile()) {
            skipped.push({ sourcePath: entryPath, reason: 'UNSUPPORTED_ENTRY: not a regular file' })
            continue
          }
        } catch (error) {
          skipped.push({ sourcePath: entryPath, reason: `BROKEN_LINK: ${error?.message ?? String(error)}` })
          continue
        }
      } else if (!entry.isFile()) {
        skipped.push({ sourcePath: entryPath, reason: 'UNSUPPORTED_ENTRY: not a regular file' })
        continue
      }
      if (!hasSupportedExtension(entry.name)) {
        skipped.push({ sourcePath: entryPath, reason: `UNSUPPORTED_EXTENSION: .${extensionOf(entry.name) || '(none)'} is not in AnyDoc's documented format table` })
        continue
      }
      files.push(entryPath)
    }
    return { files, skipped }
  }

  /**
   * Convert many documents, isolating each failure.
   * @param {{ paths?: string[], directory?: string, recursive?: boolean, outputDir?: string, overwrite?: boolean, exportAssets?: boolean, concurrency?: number, writeFile?: boolean }} args
   * @param {object} exec tool run context.
   * @returns {Promise<object>} the batch result.
   */
  async function batch(args, exec) {
    const startedAt = performance.now()
    const result = emptyBatchResult()
    const baseDir = await baseDirFor(exec)

    try {
      const candidates = []
      const preSkipped = []
      const listed = Array.isArray(args?.paths) ? args.paths.filter(entry => typeof entry === 'string' && entry.trim() !== '') : []
      const directoryArg = typeof args?.directory === 'string' && args.directory.trim() !== '' ? args.directory : undefined
      if (listed.length === 0 && directoryArg === undefined) {
        throw new AnyDocFailure('INVALID_ARGUMENT', 'provide either `paths` (files or directories) or `directory`')
      }
      const visited = new Set()
      for (const raw of listed) {
        const resolved = await realpathDeep(resolveUserPath(raw, { baseDir, label: 'paths entry' }))
        let info
        try {
          info = await stat(resolved)
        } catch (error) {
          preSkipped.push({ sourcePath: raw, reason: error?.code === 'ENOENT' ? 'FILE_NOT_FOUND' : `IO_ERROR: ${error?.message ?? String(error)}` })
          continue
        }
        if (info.isDirectory()) {
          const expanded = await expandDirectory(resolved, args?.recursive === true, visited)
          candidates.push(...expanded.files)
          preSkipped.push(...expanded.skipped)
        } else {
          candidates.push(resolved)
        }
      }
      if (directoryArg !== undefined) {
        const resolvedDirectory = await realpathDeep(resolveUserPath(directoryArg, { baseDir, label: 'directory' }))
        const info = await stat(resolvedDirectory)
        if (!info.isDirectory()) throw new AnyDocFailure('NOT_A_DIRECTORY', `directory is not a directory: ${directoryArg}`, { path: directoryArg })
        const expanded = await expandDirectory(resolvedDirectory, args?.recursive === true, visited)
        candidates.push(...expanded.files)
        preSkipped.push(...expanded.skipped)
      }

      const unique = []
      const seen = new Set()
      for (const candidate of candidates) {
        const real = await realpathDeep(candidate)
        if (seen.has(real)) continue
        seen.add(real)
        unique.push(real)
      }

      const limit = config.batchMaxFiles
      const selected = unique.slice(0, limit)
      if (unique.length > limit) {
        result.warnings.push(`input listed ${unique.length} candidate files; only the first ${limit} were processed (batchMaxFiles=${limit})`)
      }

      const requestedOutputDir = typeof args?.outputDir === 'string' && args.outputDir.trim() !== '' ? args.outputDir : config.outputRoot
      const outputDir = await prepareOutputDirectory(requestedOutputDir, { baseDir, allowedRoots: config.allowedRoots })
      result.outputDir = outputDir

      const requestedConcurrency = Number(args?.concurrency)
      const concurrency = Number.isFinite(requestedConcurrency)
        ? Math.min(8, Math.max(1, Math.trunc(requestedConcurrency)))
        : config.batchConcurrency
      const overwrite = args?.overwrite === true
      const exportAssets = args?.exportAssets === true
      const writeFile = args?.writeFile !== false && config.keepMarkdownFile

      const items = selected.map(source => ({ source, status: 'pending', outcome: undefined }))
      let cursor = 0
      const workers = []
      const runNext = async () => {
        for (;;) {
          if (exec?.signal?.aborted === true) return
          const index = cursor
          cursor += 1
          if (index >= items.length) return
          const item = items[index]
          const itemStartedAt = performance.now()
          try {
            const single = await convert(
              { sourcePath: item.source, outputDir, overwrite, exportAssets, writeFile, previewChars: 0 },
              { agent: exec?.agent, signal: exec?.signal },
            )
            item.status = single.success ? 'converted' : 'failed'
            item.outcome = {
              sourcePath: item.source,
              status: item.status,
              detectedFormat: single.detectedFormat,
              outputPath: single.outputPath,
              markdownChars: single.markdownChars,
              errorCode: single.errorCode,
              errorMessage: single.errorMessage,
              durationMs: single.durationMs > 0 ? single.durationMs : elapsed(itemStartedAt),
            }
          } catch (error) {
            const failure = describeFailure(error)
            item.status = 'failed'
            item.outcome = {
              sourcePath: item.source,
              status: 'failed',
              detectedFormat: '',
              outputPath: '',
              markdownChars: 0,
              errorCode: failure.errorCode,
              errorMessage: failure.errorMessage,
              durationMs: elapsed(itemStartedAt),
            }
          }
        }
      }
      for (let index = 0; index < Math.min(concurrency, Math.max(items.length, 1)); index++) workers.push(runNext())
      await Promise.all(workers)

      const outcomes = items.filter(item => item.outcome !== undefined).map(item => item.outcome)
      const skippedOutcomes = preSkipped.map(entry => ({
        sourcePath: entry.sourcePath,
        status: 'skipped',
        detectedFormat: '',
        outputPath: '',
        markdownChars: 0,
        errorCode: entry.reason.split(':')[0].trim(),
        errorMessage: entry.reason,
        durationMs: 0,
      }))
      const processed = items.length - outcomes.length
      if (processed > 0) {
        result.warnings.push(`${processed} candidate file(s) were not processed because the tool call was cancelled`)
        for (const item of items) {
          if (item.outcome === undefined) {
            skippedOutcomes.push({
              sourcePath: item.source,
              status: 'skipped',
              detectedFormat: '',
              outputPath: '',
              markdownChars: 0,
              errorCode: 'CANCELLED',
              errorMessage: 'the tool call was cancelled before this file was converted',
              durationMs: 0,
            })
          }
        }
      }

      result.results = [...outcomes, ...skippedOutcomes]
      result.total = result.results.length
      result.succeeded = outcomes.filter(outcome => outcome.status === 'converted').length
      result.failed = outcomes.filter(outcome => outcome.status === 'failed').length
      result.skipped = skippedOutcomes.length
      if (result.total === 0) {
        result.success = false
        result.errorCode = 'NO_INPUT_FILES'
        result.errorMessage = 'no convertible input files were found'
      } else {
        result.success = result.failed === 0
      }
      result.durationMs = elapsed(startedAt)
      logger.info(
        `dsh-anydoc: batch finished total=${result.total} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped} outputDir=${outputDir} ${result.durationMs}ms`,
      )
      return result
    } catch (error) {
      const failure = describeFailure(error)
      result.errorCode = failure.errorCode
      result.errorMessage = failure.errorMessage
      result.durationMs = elapsed(startedAt)
      logger.warn(`dsh-anydoc: batch failed (${failure.errorCode}): ${failure.errorMessage}`)
      return result
    }
  }

  /**
   * Report engine and configuration health. With `selfTest`, also convert a
   * tiny CSV this function creates and removes, proving the whole pipeline.
   * @param {{ selfTest?: boolean }} args
   * @param {object} exec tool run context.
   * @returns {Promise<object>}
   */
  async function capabilities(args, exec) {
    const warnings = []
    const probe = await engine.probe()
    let selfTest = 'not-run'
    let selfTestOutput = ''
    if (args?.selfTest === true) {
      let directory
      try {
        directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-anydoc-selftest-'))
        const sample = path.join(directory, 'selftest.csv')
        await writeFileSafe(sample, 'column_a,column_b\n1,中文示例\n', { overwrite: true })
        const payload = await engine.convert(
          { file: sample, wantAssets: false, maxAssetBytes: 0 },
          { signal: exec?.signal, timeoutMs: config.timeoutMs },
        )
        selfTest = payload.markdown.includes('column_a') ? 'passed' : 'unexpected-output'
        selfTestOutput = payload.markdown.trim().slice(0, 200)
      } catch (error) {
        selfTest = `failed: ${describeFailure(error).errorCode}`
      } finally {
        if (directory !== undefined) await rm(directory, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (!probe.nativeOk) warnings.push(`native binding unavailable: ${probe.error}`)
    else if (probe.error !== '') warnings.push(probe.error)
    const support = describePlatformSupport()
    if (support.status === 'unsupported') {
      warnings.push(`this platform is not supported by upstream AnyDoc: ${support.note}${support.hint === undefined ? '' : ` ${support.hint}`}`)
    }
    return {
      success: probe.nativeOk,
      pluginVersion,
      anydocVersion: probe.anydocVersion,
      engine: probe.mode,
      requestedEngine: probe.requestedMode,
      nativeOk: probe.nativeOk,
      workerOk: probe.mode === 'worker',
      platform: process.platform,
      arch: process.arch,
      platformSupport: support.status,
      platformNote: [support.note, support.hint].filter((part) => typeof part === 'string' && part !== '').join(' '),
      nodeVersion: process.version,
      electronVersion: process.versions.electron ?? '',
      supportedExtensions: [...SUPPORTED_EXTENSIONS],
      ocr: 'not-enabled-local-only',
      networkPolicy: 'local-only',
      limits: {
        maxFileBytes: config.maxFileBytes,
        previewChars: config.previewChars,
        maxOutputChars: config.maxOutputChars,
        timeoutMs: config.timeoutMs,
        batchConcurrency: config.batchConcurrency,
        batchMaxFiles: config.batchMaxFiles,
        maxAssetBytes: config.maxAssetBytes,
      },
      outputRoot: config.outputRoot,
      allowedRoots: [...config.allowedRoots],
      selfTest,
      selfTestOutput,
      warnings,
      errorCode: probe.nativeOk ? '' : 'NATIVE_UNAVAILABLE',
      errorMessage: probe.nativeOk ? '' : probe.error,
    }
  }

  return { convert, batch, capabilities }
}

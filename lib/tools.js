/**
 * The three model-facing tools.
 *
 * Definitions declare the exact output their `execute` returns: the DSH tools
 * pipeline validates every returned value against `output.schema`, so the
 * shapes here mirror `service.js` field by field.
 *
 * @module dsh-anydoc/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { hintForCode } from './errors.js'

const CONVERT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean', required: true },
    sourcePath: { type: 'string', required: true },
    resolvedPath: { type: 'string', required: true },
    detectedFormat: { type: 'string', required: true },
    formatSource: { type: 'string', required: true },
    outputPath: { type: 'string', required: true },
    markdownChars: { type: 'number', required: true },
    previewChars: { type: 'number', required: true },
    markdownPreview: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
    errorCode: { type: 'string', required: true },
    errorMessage: { type: 'string', required: true },
    pages: { type: 'array', items: { type: 'number' }, required: true },
    assets: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number', required: true },
          path: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
        },
      },
    },
    durationMs: { type: 'number', required: true },
    engine: { type: 'string', required: true },
    bytes: { type: 'number', required: true },
  },
}

const BATCH_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sourcePath: { type: 'string', required: true },
    status: { type: 'string', required: true },
    detectedFormat: { type: 'string', required: true },
    outputPath: { type: 'string', required: true },
    markdownChars: { type: 'number', required: true },
    errorCode: { type: 'string', required: true },
    errorMessage: { type: 'string', required: true },
    durationMs: { type: 'number', required: true },
  },
}

const BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean', required: true },
    total: { type: 'number', required: true },
    succeeded: { type: 'number', required: true },
    failed: { type: 'number', required: true },
    skipped: { type: 'number', required: true },
    outputDir: { type: 'string', required: true },
    durationMs: { type: 'number', required: true },
    results: { type: 'array', items: BATCH_ITEM_SCHEMA, required: true },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
    errorCode: { type: 'string', required: true },
    errorMessage: { type: 'string', required: true },
  },
}

const CAPABILITIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean', required: true },
    pluginVersion: { type: 'string', required: true },
    anydocVersion: { type: 'string', required: true },
    engine: { type: 'string', required: true },
    requestedEngine: { type: 'string', required: true },
    nativeOk: { type: 'boolean', required: true },
    workerOk: { type: 'boolean', required: true },
    platform: { type: 'string', required: true },
    arch: { type: 'string', required: true },
    platformSupport: { type: 'string', required: true },
    platformNote: { type: 'string', required: true },
    nodeVersion: { type: 'string', required: true },
    electronVersion: { type: 'string', required: true },
    supportedExtensions: { type: 'array', items: { type: 'string' }, required: true },
    ocr: { type: 'string', required: true },
    networkPolicy: { type: 'string', required: true },
    limits: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        maxFileBytes: { type: 'number', required: true },
        previewChars: { type: 'number', required: true },
        maxOutputChars: { type: 'number', required: true },
        timeoutMs: { type: 'number', required: true },
        batchConcurrency: { type: 'number', required: true },
        batchMaxFiles: { type: 'number', required: true },
        maxAssetBytes: { type: 'number', required: true },
      },
    },
    outputRoot: { type: 'string', required: true },
    allowedRoots: { type: 'array', items: { type: 'string' }, required: true },
    selfTest: { type: 'string', required: true },
    selfTestOutput: { type: 'string', required: true },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
    errorCode: { type: 'string', required: true },
    errorMessage: { type: 'string', required: true },
  },
}

/**
 * @param {number} value
 * @returns {string} thousands-separated integer.
 */
function count(value) {
  return Math.trunc(value).toLocaleString('en-US')
}

/**
 * Model-facing text for one conversion.
 * @param {object} value
 * @returns {string}
 */
export function renderConvert(value) {
  const lines = []
  if (value.success) {
    lines.push(`Converted ${value.sourcePath} -> ${value.outputPath === '' ? '(output file not written)' : value.outputPath}`)
    lines.push(
      `format: ${value.detectedFormat || 'unknown'} (${value.formatSource}) · ${count(value.markdownChars)} chars · ${count(value.bytes)} input bytes · ${value.durationMs} ms · engine: ${value.engine}`,
    )
    if (value.assets.length > 0) lines.push(`assets: ${value.assets.length} exported next to the Markdown`)
  } else {
    lines.push(`Conversion FAILED for ${value.sourcePath || '(no path)'}${value.resolvedPath === '' ? '' : ` (${value.resolvedPath})`}`)
    lines.push(`error: ${value.errorCode}${value.errorMessage === '' ? '' : ` — ${value.errorMessage}`}`)
    if (value.pages.length > 0) lines.push(`pages needing OCR: ${value.pages.join(', ')}`)
    const hint = hintForCode(value.errorCode)
    if (hint !== '') lines.push(`hint: ${hint}`)
  }
  for (const warning of value.warnings) lines.push(`warning: ${warning}`)
  if (value.markdownPreview !== '') {
    lines.push('', '--- markdown preview ---', value.markdownPreview)
    if (value.truncated) {
      lines.push(
        `--- preview truncated: ${count(value.previewChars)} of ${count(value.markdownChars)} characters shown. Read ${value.outputPath || 'the output file'} for the full document. ---`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * Model-facing text for one batch.
 * @param {object} value
 * @returns {string}
 */
export function renderBatch(value) {
  const lines = []
  if (value.errorCode !== '') {
    lines.push(`Batch conversion FAILED: ${value.errorCode}${value.errorMessage === '' ? '' : ` — ${value.errorMessage}`}`)
  } else {
    lines.push(
      `Batch conversion${value.success ? '' : ' completed with failures'}: ${count(value.total)} entries — ${count(value.succeeded)} converted, ${count(value.failed)} failed, ${count(value.skipped)} skipped · ${value.durationMs} ms`,
    )
    lines.push(`output directory: ${value.outputDir}`)
  }
  const shown = value.results.slice(0, 40)
  for (const item of shown) {
    if (item.status === 'converted') {
      lines.push(`- OK ${item.sourcePath} -> ${item.outputPath} (${item.detectedFormat}, ${count(item.markdownChars)} chars, ${item.durationMs} ms)`)
    } else if (item.status === 'skipped') {
      lines.push(`- SKIP ${item.sourcePath} — ${item.errorCode}: ${item.errorMessage}`)
    } else {
      lines.push(`- FAIL ${item.sourcePath} — ${item.errorCode}: ${item.errorMessage}`)
    }
  }
  if (value.results.length > shown.length) lines.push(`- ... ${count(value.results.length - shown.length)} more entries omitted`)
  for (const warning of value.warnings) lines.push(`warning: ${warning}`)
  return lines.join('\n')
}

/**
 * Model-facing text for the capability report.
 * @param {object} value
 * @returns {string}
 */
export function renderCapabilities(value) {
  const lines = [
    `dsh-anydoc ${value.pluginVersion} · AnyDoc ${value.anydocVersion} · engine: ${value.engine}${value.engine === value.requestedEngine ? '' : ` (requested ${value.requestedEngine})`}`,
    `native binding: ${value.nativeOk ? 'ok' : 'FAILED'} · worker: ${value.workerOk ? 'ok' : 'unavailable'} · ${value.platform}/${value.arch} · node ${value.nodeVersion}${value.electronVersion === '' ? '' : ` · electron ${value.electronVersion}`}`,
    `platform support: ${value.platformSupport}${value.platformNote === '' ? '' : ` — ${value.platformNote}`}`,
    `conversion is ${value.networkPolicy}; OCR: ${value.ocr}`,
    `formats: ${value.supportedExtensions.join(', ')}`,
    `limits: maxFileBytes=${value.limits.maxFileBytes}, timeoutMs=${value.limits.timeoutMs}, previewChars=${value.limits.previewChars}, maxOutputChars=${value.limits.maxOutputChars}, batchConcurrency=${value.limits.batchConcurrency}, batchMaxFiles=${value.limits.batchMaxFiles}, maxAssetBytes=${value.limits.maxAssetBytes}`,
    `outputRoot: ${value.outputRoot}`,
    `allowedRoots: ${value.allowedRoots.length === 0 ? '(none — any readable path the user names)' : value.allowedRoots.join(', ')}`,
    `self test: ${value.selfTest}${value.selfTestOutput === '' ? '' : ` — ${value.selfTestOutput.replaceAll('\n', ' ')}`}`,
  ]
  if (value.errorCode !== '') lines.push(`error: ${value.errorCode} — ${value.errorMessage}`)
  for (const warning of value.warnings) lines.push(`warning: ${warning}`)
  return lines.join('\n')
}

/**
 * Build the three tool definitions bound to one service instance.
 * @param {ReturnType<import('./service.js').createService>} service
 * @param {Readonly<object>} config resolved plugin config.
 * @returns {object[]}
 */
export function buildTools(service, config) {
  return [
    defineTool({
      name: 'anydoc_convert',
      description:
        'Parse one local document into GitHub-Flavored Markdown with the bundled AnyDoc engine, entirely offline. Reads Word (.doc/.docx/.docm), PowerPoint (.ppt/.pptx/.pps/.ppsx/.pot/.pptm/.ppsm), Excel (.xls/.xlsx/.xlsm/.xlsb), OpenDocument (.odt/.ods/.odp), .rtf, .epub, .csv and text-layer .pdf, preserving headings, lists, tables, footnotes, speaker notes and LaTeX formulas. The full Markdown is written to a file and a bounded preview is returned; nothing is uploaded. 将本地办公文档/电子书/PDF 解析为 Markdown。',
      parameters: {
        sourcePath: { type: 'string', required: true, description: 'File to parse: an absolute path, or a path relative to the session working directory.' },
        outputDir: { type: 'string', description: `Directory for the .md output. Defaults to the plugin outputRoot.` },
        overwrite: { type: 'boolean', description: 'Overwrite an existing output file. Default false, which picks a free name instead.' },
        exportAssets: { type: 'boolean', description: 'Also export embedded images and embedded objects into a sibling .assets directory. Default from the plugin config.' },
        writeFile: { type: 'boolean', description: 'Write the Markdown file. Default true; set false to preview a small document without writing.' },
        previewChars: { type: 'number', description: `Characters of Markdown returned inline. Default ${config.previewChars}.` },
      },
      output: { schema: CONVERT_SCHEMA, render: (_args, value) => [{ type: 'text', text: renderConvert(value) }] },
      timeoutMs: config.timeoutMs + 30_000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await service.convert(args, exec)
      },
    }),
    defineTool({
      name: 'anydoc_batch_convert',
      description:
        'Parse several local documents into Markdown in one call, offline, with per-file failure isolation and a success/failure/skip summary. Accepts explicit files or one directory; directory scanning is non-recursive unless recursive is true and only takes documented document extensions. Existing outputs are never overwritten unless overwrite is true. 批量把本地文档解析为 Markdown。',
      parameters: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Files or directories to convert. Either this or `directory` is required.' },
        directory: { type: 'string', description: 'One directory to scan for documents.' },
        recursive: { type: 'boolean', description: 'Descend into subdirectories. Default false.' },
        outputDir: { type: 'string', description: 'Directory for all .md outputs. Defaults to the plugin outputRoot.' },
        overwrite: { type: 'boolean', description: 'Overwrite existing output files. Default false.' },
        exportAssets: { type: 'boolean', description: 'Export embedded assets for every converted file. Default false.' },
        concurrency: { type: 'number', description: `Files converted at the same time. Default ${config.batchConcurrency}, maximum 8.` },
        writeFile: { type: 'boolean', description: 'Write each .md file. Default true.' },
      },
      output: { schema: BATCH_SCHEMA, render: (_args, value) => [{ type: 'text', text: renderBatch(value) }] },
      timeoutMs: Math.max(120_000, config.timeoutMs * 2),
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        return await service.batch(args, exec)
      },
    }),
    defineTool({
      name: 'anydoc_capabilities',
      description:
        'Report dsh-anydoc health without reading any user document: plugin and AnyDoc versions, whether the native binding loads, the active engine, supported formats, OCR policy, configured limits, and that conversion stays local. With selfTest=true it also converts a tiny generated CSV to prove the whole pipeline works. 查询 AnyDoc 插件能力与健康状态，不读取本地私人文档。',
      parameters: {
        selfTest: { type: 'boolean', description: 'Run an end-to-end conversion of a tiny generated CSV. Default false.' },
      },
      output: { schema: CAPABILITIES_SCHEMA, render: (_args, value) => [{ type: 'text', text: renderCapabilities(value) }] },
      timeoutMs: Math.max(60_000, config.timeoutMs + 30_000),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await service.capabilities(args, exec)
      },
    }),
  ]
}

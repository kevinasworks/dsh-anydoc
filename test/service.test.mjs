/**
 * Tool-behaviour tests: output placement, overwrite rules, preview bounds,
 * limits, allow-lists, batch scanning and the capability report.
 */

import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { realpathDeep } from '../lib/paths.js'
import { createHarness, GENERATED, invokeTool, renderTool, UPSTREAM } from './support/harness.mjs'

/**
 * Build a batch input directory.
 * @param {string} root
 * @returns {Promise<void>}
 */
async function populate(root) {
  await mkdir(path.join(root, 'nested'), { recursive: true })
  await copyFile(path.join(GENERATED, 'zh-mixed.docx'), path.join(root, 'a.docx'))
  await copyFile(path.join(GENERATED, 'zh-table.xlsx'), path.join(root, 'b.xlsx'))
  await writeFile(path.join(root, 'c.txt'), 'plain text is not a document format here')
  await copyFile(path.join(GENERATED, 'zh-mixed.docx'), path.join(root, 'nested', 'd.docx'))
  await copyFile(path.join(UPSTREAM, 'malformed-encrypted--errors.odt'), path.join(root, 'encrypted.odt'))
}

test('convert writes <stem>.md under the configured output root', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(GENERATED, 'zh-mixed.docx') })
  assert.equal(result.success, true)
  assert.equal(path.basename(result.outputPath), 'zh-mixed.md')
  assert.equal(path.dirname(result.outputPath), path.join(await (await import('node:fs/promises')).realpath(harness.baseDir), 'out'))
  assert.equal((await stat(result.outputPath)).isFile(), true)
})

test('existing outputs are preserved and a free name is chosen', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const source = path.join(GENERATED, 'zh-mixed.docx')
  const first = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: source })
  const second = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: source })
  assert.equal(path.basename(first.outputPath), 'zh-mixed.md')
  assert.equal(path.basename(second.outputPath), 'zh-mixed-1.md')
  const overwritten = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: source, overwrite: true })
  assert.equal(path.basename(overwritten.outputPath), 'zh-mixed.md')
})

test('writeFile=false returns a preview and writes nothing', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', {
    sourcePath: path.join(GENERATED, 'zh-mixed.csv'),
    writeFile: false,
  })
  assert.equal(result.success, true)
  assert.equal(result.outputPath, '')
  assert.ok(result.markdownPreview.includes('张三'))
  const entries = await readdir(path.join(await (await import('node:fs/promises')).realpath(harness.baseDir), 'out')).catch(() => [])
  assert.deepEqual(entries, [])
})

test('a long document is truncated in the preview but complete on disk', async (t) => {
  const harness = await createHarness({ config: { previewChars: 1000 } })
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(GENERATED, 'zh-long.docx') })
  assert.equal(result.success, true)
  assert.equal(result.truncated, true)
  assert.equal(result.previewChars, 1000)
  assert.equal(result.markdownPreview.length, 1000)
  assert.ok(result.markdownChars > 10_000)
  const written = await readFile(result.outputPath, 'utf8')
  assert.equal(written.length, result.markdownChars)
  const rendered = renderTool(harness.tools, 'anydoc_convert', {}, result)
  assert.match(rendered, /preview truncated: 1,000 of [\d,]+ characters shown/)
})

test('a short document is not marked as truncated', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(UPSTREAM, 'csv-sheet.csv') })
  assert.equal(result.truncated, false)
  assert.equal(result.previewChars, result.markdownChars)
})

test('maxFileBytes is enforced before the engine runs', async (t) => {
  const harness = await createHarness({ config: { maxFileBytes: 1024 * 1024 } })
  t.after(harness.dispose)
  const big = path.join(harness.baseDir, 'big.docx')
  await writeFile(big, Buffer.alloc(1536 * 1024, 3))
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: big })
  assert.equal(result.success, false)
  assert.equal(result.errorCode, 'FILE_TOO_LARGE')
  assert.match(result.errorMessage, /maxFileBytes/)
  assert.equal(harness.engine.pool.live.size, 0, 'no worker was started for a rejected file')
})

test('missing, empty and directory inputs each report their own code', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const cases = [
    [path.join(harness.baseDir, 'nope.docx'), 'FILE_NOT_FOUND'],
    [path.join(UPSTREAM, 'malformed-empty--errors.docx'), 'EMPTY_FILE'],
    [harness.baseDir, 'NOT_A_FILE'],
  ]
  for (const [sourcePath, expected] of cases) {
    const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath })
    assert.equal(result.success, false)
    assert.equal(result.errorCode, expected)
  }
})

test('allowedRoots blocks inputs and outputs outside the allow-list', async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'anydoc-roots-'))
  t.after(() => rm(sandbox, { recursive: true, force: true }))
  const allowed = path.join(sandbox, 'allowed')
  await mkdir(allowed)
  await copyFile(path.join(GENERATED, 'zh-mixed.docx'), path.join(allowed, 'inside.docx'))
  const outside = path.join(sandbox, 'outside.docx')
  await copyFile(path.join(GENERATED, 'zh-mixed.docx'), outside)

  const harness = await createHarness({ config: { allowedRoots: [allowed], outputRoot: allowed } })
  t.after(harness.dispose)
  assert.deepEqual(harness.config.allowedRoots, [await realpathDeep(allowed)], 'configured roots and input paths use identical canonical names')
  const blocked = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: outside })
  assert.equal(blocked.errorCode, 'PATH_OUTSIDE_ALLOWED_ROOTS')
  const ok = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(allowed, 'inside.docx') })
  assert.equal(ok.success, true, JSON.stringify(ok))
  const badOutput = await invokeTool(harness.tools, 'anydoc_convert', {
    sourcePath: path.join(allowed, 'inside.docx'),
    outputDir: path.join(sandbox, 'elsewhere'),
  })
  assert.equal(badOutput.errorCode, 'PATH_OUTSIDE_ALLOWED_ROOTS')
})

test('batch scans one directory without recursion by default', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const input = path.join(harness.baseDir, 'input')
  await populate(input)
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', { directory: input })
  assert.equal(result.total, 4, 'two documents, one skipped text file, one encrypted document')
  assert.equal(result.succeeded, 2)
  assert.equal(result.failed, 1)
  assert.equal(result.skipped, 1)
  assert.equal(result.success, false, 'a failing item makes the batch unsuccessful')
  const skipped = result.results.find(item => item.status === 'skipped')
  assert.equal(skipped.errorCode, 'UNSUPPORTED_EXTENSION')
  const failed = result.results.find(item => item.status === 'failed')
  assert.equal(failed.errorCode, 'ENCRYPTED_DOCUMENT')
  assert.ok(!result.results.some(item => item.sourcePath.includes('nested')), 'nested files are not scanned')
})

test('batch recursion adds nested documents', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const input = path.join(harness.baseDir, 'input')
  await populate(input)
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', { directory: input, recursive: true })
  assert.equal(result.succeeded, 3)
  assert.ok(result.results.some(item => item.sourcePath.endsWith('d.docx')))
})

test('batch de-duplicates repeated inputs', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const input = path.join(harness.baseDir, 'input')
  await populate(input)
  const file = path.join(input, 'a.docx')
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', { paths: [file, file, input] })
  assert.equal(result.total, 4)
  assert.equal(result.succeeded, 2)
})

test('batch keeps one failure from aborting the rest', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const input = path.join(harness.baseDir, 'input')
  await populate(input)
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', {
    paths: [path.join(input, 'a.docx'), path.join(input, 'encrypted.odt'), path.join(input, 'b.xlsx')],
    concurrency: 3,
  })
  assert.equal(result.succeeded, 2)
  assert.equal(result.failed, 1)
  const failed = result.results.find(item => item.status === 'failed')
  assert.equal(path.basename(failed.sourcePath), 'encrypted.odt')
  assert.equal(failed.errorCode, 'ENCRYPTED_DOCUMENT')
})

test('batch respects batchMaxFiles and says so', async (t) => {
  const harness = await createHarness({ config: { batchMaxFiles: 2 } })
  t.after(harness.dispose)
  const input = path.join(harness.baseDir, 'input')
  await populate(input)
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', { paths: [input] })
  assert.equal(result.succeeded + result.failed, 2)
  assert.ok(result.warnings.some(message => message.includes('batchMaxFiles=2')))
})

test('an empty directory is reported, not silently successful', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const empty = path.join(harness.baseDir, 'empty')
  await mkdir(empty)
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', { directory: empty })
  assert.equal(result.success, false)
  assert.equal(result.errorCode, 'NO_INPUT_FILES')
})

test('batch requires an input selection', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_batch_convert', {})
  assert.equal(result.success, false)
  assert.equal(result.errorCode, 'INVALID_ARGUMENT')
})

test('the capability report needs no user document and its self test passes', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const plain = await invokeTool(harness.tools, 'anydoc_capabilities', {})
  assert.equal(plain.success, true)
  assert.equal(plain.selfTest, 'not-run')
  assert.equal(plain.ocr, 'not-enabled-local-only')
  assert.equal(plain.networkPolicy, 'local-only')
  assert.equal(plain.anydocVersion, '0.2.4')
  assert.equal(plain.engine, 'worker')
  assert.equal(plain.nativeOk, true)
  assert.ok(['supported', 'unsupported', 'unknown'].includes(plain.platformSupport), 'platformSupport is reported')
  assert.equal(typeof plain.platformNote, 'string')
  assert.ok(plain.supportedExtensions.includes('docx'))
  assert.ok(plain.supportedExtensions.includes('pdf'))

  const withSelfTest = await invokeTool(harness.tools, 'anydoc_capabilities', { selfTest: true })
  assert.equal(withSelfTest.selfTest, 'passed')
  assert.ok(withSelfTest.selfTestOutput.includes('column_a'))
})

test('every conversion is logged without document content', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(GENERATED, 'zh-mixed.docx') })
  const info = harness.logger.lines.filter(line => line.level === 'info' && line.message.includes('converted'))
  assert.equal(info.length, 1)
  assert.match(info[0].message, /format=docx chars=\d+ assets=0/)
  for (const line of harness.logger.lines) {
    assert.ok(!line.message.includes('季度技术评审报告'), 'no document text reaches the log')
  }
})

test('in-process mode is reported by the capability tool', async (t) => {
  const harness = await createHarness({ config: { engine: 'inprocess' } })
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_capabilities', {})
  assert.equal(result.engine, 'inprocess')
  assert.equal(result.requestedEngine, 'inprocess')
  assert.equal(result.workerOk, false)
  assert.equal(result.nativeOk, true)
})

test('a per-call previewChars request is capped', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', {
    sourcePath: path.join(GENERATED, 'zh-heavy.docx'),
    previewChars: 10_000_000,
  })
  assert.equal(result.success, true)
  assert.equal(result.previewChars, 200_000, 'the argument cannot exceed the documented 200,000 cap')
  assert.equal(result.markdownPreview.length, 200_000)
  assert.equal(result.truncated, true)
})

test('a non-numeric concurrency falls back instead of stalling the batch', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const input = path.join(harness.baseDir, 'input')
  await populate(input)
  // Bypass the tool's schema validation to reach the service guard itself.
  const result = await harness.service.batch({ directory: input, concurrency: '四' }, {})
  assert.equal(result.succeeded, 2)
  assert.equal(result.total, 4)
})

test('a symlinked source is named after the link the caller used', { skip: process.platform === 'win32' ? 'creating symlinks on Windows needs Developer Mode or elevation' : false }, async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const link = path.join(harness.baseDir, '别名链接-alias.docx')
  await (await import('node:fs/promises')).symlink(path.join(GENERATED, 'zh-mixed.docx'), link)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: link })
  assert.equal(result.success, true)
  assert.equal(path.basename(result.outputPath), '别名链接-alias.md')
})

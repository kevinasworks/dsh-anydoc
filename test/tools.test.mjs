/**
 * Tool-definition tests: names, schemas, argument validation and rendering.
 * These are what DSH projects into the model's tool list and system prompt.
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createHarness, GENERATED, invokeTool, toolNamed } from './support/harness.mjs'

test('three tools are registered with their documented names', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  assert.deepEqual(
    harness.tools.map(tool => tool.name),
    ['anydoc_convert', 'anydoc_batch_convert', 'anydoc_capabilities'],
  )
  for (const tool of harness.tools) {
    assert.ok(tool.description.length > 80, `${tool.name} needs a real description`)
    assert.ok(tool.description.includes('本地') || tool.description.includes('本地文档') || tool.description.includes('离线'), `${tool.name} should hint at local parsing in Chinese`)
    assert.ok(Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('anydoc_convert declares its parameters and output shape', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const tool = toolNamed(harness.tools, 'anydoc_convert')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['sourcePath'])
  assert.equal(tool.parameters.properties.sourcePath.type, 'string')
  assert.equal(tool.parameters.properties.overwrite.type, 'boolean')
  assert.equal(tool.parameters.properties.previewChars.type, 'number')

  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, false)
  for (const key of ['success', 'sourcePath', 'detectedFormat', 'outputPath', 'markdownPreview', 'truncated', 'warnings', 'errorCode', 'errorMessage']) {
    assert.ok(tool.output.schema.properties[key], `output schema needs ${key}`)
  }
  assert.equal(tool.output.schema.properties.assets.items.type, 'object')
})

test('anydoc_batch_convert declares batch limits and result rows', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const tool = toolNamed(harness.tools, 'anydoc_batch_convert')
  assert.equal(tool.parameters.properties.paths.type, 'array')
  assert.equal(tool.parameters.properties.paths.items.type, 'string')
  assert.equal(tool.parameters.properties.recursive.type, 'boolean')
  assert.equal(tool.parameters.required, undefined, 'either paths or directory is acceptable')
  const resultItem = tool.output.schema.properties.results.items
  assert.equal(resultItem.additionalProperties, false)
  assert.deepEqual(resultItem.required.sort(), ['detectedFormat', 'durationMs', 'errorCode', 'errorMessage', 'markdownChars', 'outputPath', 'sourcePath', 'status'])
})

test('anydoc_capabilities declares a read-only health report', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const tool = toolNamed(harness.tools, 'anydoc_capabilities')
  assert.equal(tool.parameters.properties.selfTest.type, 'boolean')
  assert.equal(tool.parameters.required, undefined)
  for (const key of ['pluginVersion', 'anydocVersion', 'nativeOk', 'engine', 'supportedExtensions', 'ocr', 'networkPolicy', 'limits']) {
    assert.ok(tool.output.schema.properties[key], `capability schema needs ${key}`)
  }
})

test('concurrency policy matches the work each tool does', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  assert.equal(toolNamed(harness.tools, 'anydoc_convert').isConcurrencySafe({ sourcePath: 'a' }), true)
  assert.equal(toolNamed(harness.tools, 'anydoc_batch_convert').isConcurrencySafe({}), false)
  assert.equal(toolNamed(harness.tools, 'anydoc_capabilities').isConcurrencySafe({}), true)
})

test('invalid arguments fail before the tool body runs', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const tool = toolNamed(harness.tools, 'anydoc_convert')
  await assert.rejects(tool.execute({}, { signal: new AbortController().signal }), /invalid arguments/)
  await assert.rejects(tool.execute({ sourcePath: 42 }, { signal: new AbortController().signal }), /invalid arguments/)
  await assert.rejects(tool.execute({ sourcePath: 'a', overwrite: 'yes' }, { signal: new AbortController().signal }), /invalid arguments/)
})

test('rendering a successful conversion shows path, format and preview', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const value = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(GENERATED, 'zh-mixed.docx') })
  const text = toolNamed(harness.tools, 'anydoc_convert').output.render({}, value).map(block => block.text).join('\n')
  assert.match(text, /^Converted /)
  assert.match(text, /format: docx \(content\)/)
  assert.match(text, /engine: worker/)
  assert.match(text, /--- markdown preview ---/)
  assert.match(text, /季度技术评审报告/)
})

test('rendering a failure shows the code, hint and OCR pages', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const value = await invokeTool(harness.tools, 'anydoc_convert', {
    sourcePath: path.join(harness.baseDir, 'nope.docx'),
  })
  const text = toolNamed(harness.tools, 'anydoc_convert').output.render({}, value).map(block => block.text).join('\n')
  assert.match(text, /^Conversion FAILED/)
  assert.match(text, /error: FILE_NOT_FOUND/)
  assert.match(text, /hint: /)
})

test('rendering a batch summarises counts and per-file lines', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const value = await invokeTool(harness.tools, 'anydoc_batch_convert', {
    paths: [path.join(GENERATED, 'zh-mixed.docx'), path.join(GENERATED, 'zh-table.xlsx')],
  })
  const text = toolNamed(harness.tools, 'anydoc_batch_convert').output.render({}, value).map(block => block.text).join('\n')
  assert.match(text, /Batch conversion: 2 entries — 2 converted, 0 failed, 0 skipped/)
  assert.match(text, /^- OK .*zh-mixed\.docx -> .*\.md \(docx, [\d,]+ chars, [\d.]+ ms\)$/m)
  assert.match(text, /output directory: /)
})

test('rendering capabilities reports the offline policy', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const value = await invokeTool(harness.tools, 'anydoc_capabilities', {})
  const text = toolNamed(harness.tools, 'anydoc_capabilities').output.render({}, value).map(block => block.text).join('\n')
  assert.match(text, /dsh-anydoc test · AnyDoc 0\.2\.4 · engine: worker/)
  assert.match(text, /conversion is local-only; OCR: not-enabled-local-only/)
  assert.match(text, /native binding: ok/)
})

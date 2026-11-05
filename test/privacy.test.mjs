/**
 * Privacy tests.
 *
 * The plugin's contract is that a document never leaves the machine. These
 * tests prove it three ways: the conversion path is statically free of the
 * hosted-OCR option, an in-process conversion works with `fetch` poisoned, and
 * a worker conversion works with `fetch` poisoned inside the worker process
 * through `NODE_OPTIONS=--import`.
 */

import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createHarness, GENERATED, PLUGIN_ROOT, UPSTREAM } from './support/harness.mjs'

const NO_NETWORK = path.join(PLUGIN_ROOT, 'test', 'support', 'no-network.mjs')

test('the shipped sources never request hosted OCR', async () => {
  const root = path.join(PLUGIN_ROOT, 'lib')
  const files = (await readdir(root)).filter(name => name.endsWith('.js'))
  for (const name of files) {
    // Comments explain the invariant; only executable code is inspected.
    const text = (await readFile(path.join(root, name), 'utf8'))
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/^\s*\/\/.*$/gm, '')
    assert.ok(!/ocr\s*:\s*['"]hosted['"]/.test(text), `${name} must not request hosted OCR`)
    assert.ok(!/parseHosted/.test(text), `${name} must not call the upstream hosted parser`)
    assert.ok(!/FIRECRAWL_API_KEY/.test(text), `${name} must not read a Firecrawl API key`)
    assert.ok(!/https?:\/\//.test(text), `${name} must not embed a service endpoint`)
  }
})

test('an in-process conversion works with fetch disabled', async (t) => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => {
    calls += 1
    throw new Error('network access is disabled by the privacy test')
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const harness = await createHarness({ config: { engine: 'inprocess' } })
  t.after(harness.dispose)
  const result = await harness.engine.convert({
    file: path.join(GENERATED, 'zh-mixed.docx'),
    wantAssets: true,
    maxAssetBytes: 1024 * 1024,
  })
  assert.match(result.markdown, /季度技术评审报告/)
  assert.equal(calls, 0, 'no fetch happened during conversion')
})

test('a worker conversion works with fetch disabled inside the worker', {
  // NODE_OPTIONS splits on spaces, so a repository path containing one cannot
  // carry a preload module through it.
  skip: NO_NETWORK.includes(' ') ? 'NODE_OPTIONS cannot carry a path containing spaces' : false,
}, async (t) => {
  const previous = process.env.NODE_OPTIONS ?? ''
  process.env.NODE_OPTIONS = `${previous} --import=${NO_NETWORK}`.trim()
  t.after(() => {
    if (previous === '') delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previous
  })
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const result = await harness.engine.convert({
    file: path.join(UPSTREAM, 'docx-text.docx'),
    wantAssets: true,
    maxAssetBytes: 1024 * 1024,
  })
  assert.match(result.markdown, /Fixture Document/)
  assert.equal(result.assets.length, 1)
})

test('the worker process does not inherit a Firecrawl configuration dependency', async (t) => {
  const previous = process.env.FIRECRAWL_API_KEY
  process.env.FIRECRAWL_API_KEY = 'placeholder-not-a-real-key'
  t.after(() => {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY
    else process.env.FIRECRAWL_API_KEY = previous
  })
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const result = await harness.engine.convert({
    file: path.join(UPSTREAM, 'pdf-text.pdf'),
    wantAssets: false,
    maxAssetBytes: 0,
  })
  assert.match(result.markdown, /# Fixture Document/)
})

test('the scanned-PDF path reports OCR as unavailable instead of uploading', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  await assert.rejects(
    harness.engine.convert({ file: path.join(UPSTREAM, 'pdf-handmade-scanned.pdf'), wantAssets: false, maxAssetBytes: 0 }),
    (error) => {
      assert.equal(error.code, 'NEEDS_OCR')
      assert.ok(!/hosted|parse/i.test(error.message), 'the failure must not mention a hosted fallback')
      return true
    },
  )
})

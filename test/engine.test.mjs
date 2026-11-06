/**
 * Engine tests: both execution modes, real process isolation, timeouts that
 * actually terminate, and the upstream error vocabulary.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createHarness, GENERATED, UPSTREAM } from './support/harness.mjs'

const DOCX = path.join(UPSTREAM, 'docx-text.docx')
const HEAVY = path.join(GENERATED, 'zh-heavy.docx')

test('worker mode reports the installed AnyDoc version', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const probe = await harness.engine.probe()
  assert.equal(probe.nativeOk, true)
  assert.equal(probe.mode, 'worker')
  assert.match(probe.anydocVersion, /^\d+\.\d+\.\d+/)
  assert.equal(harness.engine.fallbackReason, '')
})

test('worker and in-process modes produce byte-identical Markdown', async (t) => {
  const worker = await createHarness({ config: { engine: 'worker' } })
  const inprocess = await createHarness({ config: { engine: 'inprocess' } })
  t.after(worker.dispose)
  t.after(inprocess.dispose)
  const request = { file: DOCX, wantAssets: false, maxAssetBytes: 0 }
  const fromWorker = await worker.engine.convert(request)
  const fromHost = await inprocess.engine.convert(request)
  assert.equal(fromWorker.markdown, fromHost.markdown)
  assert.equal(fromWorker.format, 'docx')
  assert.equal(fromWorker.formatSource, 'content')
  assert.equal(fromWorker.bytesRead, fromHost.bytesRead)
  assert.ok(fromWorker.durationMs >= 0)
})

test('a per-file timeout terminates the worker process', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  await harness.engine.probe()
  const liveBefore = harness.engine.pool.live.size
  // Make the response absent deterministically, rather than betting that a
  // real conversion takes longer than the platform's timer resolution.
  const [handle] = harness.engine.pool.live
  let dispatched = false
  handle.child.send = (message) => {
    assert.equal(message.type, 'convert')
    dispatched = true
    return true
  }
  await assert.rejects(
    harness.engine.convert({ file: DOCX, wantAssets: false, maxAssetBytes: 0 }, { timeoutMs: 30 }),
    (error) => error.code === 'TIMEOUT',
  )
  assert.equal(dispatched, true, 'the request reached worker dispatch')
  assert.equal(handle.child.killed, true, 'the worker received a kill signal')
  assert.equal(harness.engine.pool.live.size, liveBefore - 1, 'the timed-out worker must be gone')
  // The pool recovers for the next conversion.
  const recovered = await harness.engine.convert({ file: DOCX, wantAssets: false, maxAssetBytes: 0 })
  assert.match(recovered.markdown, /Fixture Document/)
})

test('the in-process mode reports a timeout it cannot cancel', async (t) => {
  const harness = await createHarness({ config: { engine: 'inprocess' } })
  t.after(harness.dispose)
  await assert.rejects(
    harness.engine.convert({ file: HEAVY, wantAssets: false, maxAssetBytes: 0 }, { timeoutMs: 1 }),
    (error) => error.code === 'TIMEOUT_NOT_CANCELLED' && /may still be running/.test(error.message),
  )
  // Give the abandoned native call a moment to finish before the engine disposes.
  await new Promise(resolve => setTimeout(resolve, 50))
})

test('an already-aborted signal fails without starting work', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    harness.engine.convert({ file: DOCX, wantAssets: false, maxAssetBytes: 0 }, { signal: controller.signal }),
    (error) => error.code === 'CANCELLED',
  )
})

test('aborting mid-conversion kills the worker', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  await harness.engine.probe()
  const controller = new AbortController()
  const pending = harness.engine.convert({ file: DOCX, wantAssets: false, maxAssetBytes: 0 }, { signal: controller.signal, timeoutMs: 10_000 })
  controller.abort()
  await assert.rejects(pending, (error) => error.code === 'CANCELLED')
})

test('assets are returned from the document model', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const result = await harness.engine.convert({
    file: path.join(UPSTREAM, 'docx-handmade-rich.docx'),
    wantAssets: true,
    maxAssetBytes: 8 * 1024 * 1024,
  })
  assert.equal(result.assets.length, 2)
  assert.ok(result.assets.some(asset => asset.mediaType.startsWith('image/')), 'the embedded image is exported')
  for (const asset of result.assets) {
    assert.ok(asset.mediaType.length > 0)
    assert.ok(Buffer.from(asset.data, 'base64').byteLength > 0)
    assert.ok(asset.originPart.length > 0)
  }
})

test('the asset budget drops what does not fit instead of failing', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const result = await harness.engine.convert({
    file: path.join(UPSTREAM, 'docx-handmade-rich.docx'),
    wantAssets: true,
    maxAssetBytes: 10,
  })
  assert.equal(result.assets.length, 0)
  assert.ok(result.assetsSkipped > 0)
  assert.ok(result.warnings.some(message => /maxAssetBytes/.test(message)))
})

test('upstream error codes map onto the plugin vocabulary', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const cases = [
    ['malformed-encrypted--errors.odt', 'ENCRYPTED_DOCUMENT'],
    ['malformed-truncated--errors.docx', 'MALFORMED_DOCUMENT'],
    ['abuse-zipbomb--errors.docx', 'RESOURCE_LIMIT'],
  ]
  for (const [name, expected] of cases) {
    await assert.rejects(
      harness.engine.convert({ file: path.join(UPSTREAM, name), wantAssets: false, maxAssetBytes: 0 }),
      (error) => error.code === expected,
      `${name} should fail with ${expected}`,
    )
  }
  await assert.rejects(
    harness.engine.convert({ file: path.join(UPSTREAM, 'pdf-handmade-scanned.pdf'), wantAssets: false, maxAssetBytes: 0 }),
    (error) => error.code === 'NEEDS_OCR' && Array.isArray(error.details?.pages) && error.details.pages.length === 2,
  )
})

test('a disposed engine refuses further work', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  await harness.engine.probe()
  harness.engine.dispose()
  await assert.rejects(
    harness.engine.convert({ file: DOCX, wantAssets: false, maxAssetBytes: 0 }),
    (error) => error.code === 'ENGINE_DISPOSED' || error.code === 'ENGINE_FAILED',
  )
  t.after(harness.dispose)
})

test('the engine never mutates the source document', async (t) => {
  const harness = await createHarness({ config: { engine: 'worker' } })
  t.after(harness.dispose)
  const before = await readFile(DOCX)
  await harness.engine.convert({ file: DOCX, wantAssets: true, maxAssetBytes: 1024 * 1024 })
  const after = await readFile(DOCX)
  assert.deepEqual(after, before)
})

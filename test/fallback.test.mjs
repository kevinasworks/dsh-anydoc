/**
 * Worker-start failure fallback.
 *
 * A copy of the plugin is made in a temp directory and its worker entry is
 * removed, so `fork` cannot start. The engine must fall back to in-process
 * conversion and still produce the document. The installed plugin is never
 * modified: the copy is created and removed inside the test.
 */

import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, rm, symlink, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PLUGIN_ROOT, UPSTREAM } from './support/harness.mjs'

/** @returns {'junction' | 'dir'} the unprivileged directory link for this platform. */
const linkType = () => (process.platform === 'win32' ? 'junction' : 'dir')

test('a worker that cannot start falls back to in-process conversion', async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'anydoc-fallback-'))
  t.after(() => rm(sandbox, { recursive: true, force: true }))
  await cp(path.join(PLUGIN_ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true })
  // A directory junction needs no elevation on Windows; a directory symlink does.
  await symlink(path.join(PLUGIN_ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), linkType())
  await rename(path.join(sandbox, 'lib', 'worker-entry.js'), path.join(sandbox, 'lib', 'worker-entry.js.disabled'))

  const { resolveConfig } = await import(path.join(sandbox, 'lib', 'config.js'))
  const { Engine } = await import(path.join(sandbox, 'lib', 'engine.js'))
  const logs = []
  const logger = { info: () => {}, warn: message => logs.push(String(message)), error: () => {}, debug: () => {} }
  const config = resolveConfig({ engine: 'worker', workerStartTimeoutMs: 5000 })
  const engine = new Engine({ config, logger })
  t.after(() => engine.dispose())

  const result = await engine.convert({
    file: path.join(UPSTREAM, 'docx-text.docx'),
    wantAssets: false,
    maxAssetBytes: 0,
  })
  assert.match(result.markdown, /Fixture Document/)
  assert.equal(engine.activeMode, 'inprocess')
  assert.match(engine.fallbackReason, /fell back to in-process/)
  assert.ok(logs.some(message => message.includes('fell back to in-process')), 'the fallback is logged')

  const probe = await engine.probe()
  assert.equal(probe.mode, 'inprocess')
  assert.equal(probe.nativeOk, true)
})

test('a missing native binding reports actionable platform advice', async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'anydoc-no-native-'))
  t.after(() => rm(sandbox, { recursive: true, force: true }))
  await cp(path.join(PLUGIN_ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true })
  // Every dependency resolves except @firecrawl/anydoc, which simulates a
  // plugin directory copied from another machine, or a host with no prebuilt
  // AnyDoc binary (e.g. Windows on ARM).
  const sandboxModules = path.join(sandbox, 'node_modules')
  await mkdir(sandboxModules, { recursive: true })
  for (const entry of await readdir(path.join(PLUGIN_ROOT, 'node_modules'))) {
    if (entry === '@firecrawl') continue
    await symlink(path.join(PLUGIN_ROOT, 'node_modules', entry), path.join(sandboxModules, entry), linkType())
  }
  // @deepseek-ai holds the peer packages the sandbox needs; it must not bring
  // @firecrawl with it, so link the scoped directory entry by entry.
  await rm(path.join(sandboxModules, '@deepseek-ai'), { force: true })
  await mkdir(path.join(sandboxModules, '@deepseek-ai'), { recursive: true })
  for (const entry of await readdir(path.join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai'))) {
    await symlink(
      path.join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai', entry),
      path.join(sandboxModules, '@deepseek-ai', entry),
      linkType(),
    )
  }

  const { resolveConfig } = await import(path.join(sandbox, 'lib', 'config.js'))
  const { Engine } = await import(path.join(sandbox, 'lib', 'engine.js'))
  const logs = []
  const logger = { info: () => {}, warn: (message) => logs.push(String(message)), error: () => {}, debug: () => {} }
  const engine = new Engine({ config: resolveConfig({ engine: 'worker', workerStartTimeoutMs: 5000 }), logger })
  t.after(() => engine.dispose())

  const probe = await engine.probe()
  assert.equal(probe.nativeOk, false)
  assert.match(probe.error, /@firecrawl\/anydoc/)
  assert.match(probe.error, /npm install --omit=dev/, 'the error tells the user how to fix it')
  assert.match(probe.error, new RegExp(`${process.platform}/${process.arch}`), 'the error names this platform')

  await assert.rejects(
    engine.convert({ file: path.join(UPSTREAM, 'docx-text.docx'), wantAssets: false, maxAssetBytes: 0 }),
    (error) => error.code === 'NATIVE_UNAVAILABLE' && /npm install --omit=dev/.test(error.message),
  )
})

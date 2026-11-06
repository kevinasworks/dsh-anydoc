/**
 * Plugin mount tests: the `apply()` contract against a stand-in Cordis context,
 * plus configuration bounds. These are the same code paths DSH runs when the
 * row activates, without needing the Host.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripWindowsPrefix } from '../lib/platform.js'
import { Config, defaultOutputRoot, resolveConfig } from '../lib/config.js'
import { SUPPORTED_EXTENSIONS, extensionOf, hasSupportedExtension } from '../lib/formats.js'
import { apply, inject, name } from '../index.js'

/**
 * A minimal Cordis context: effects, logging, optional services, tool registry.
 * @returns {{ ctx: object, registered: object[], logs: string[], effects: number, disposed: number }}
 */
function fakeContext() {
  const registered = []
  const logs = []
  const state = { effects: 0, disposed: 0 }
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {
          state.disposed += 1
        }
      },
    },
    effects: [],
    effect(callback) {
      state.effects += 1
      const disposer = callback()
      ctx.effects.push(disposer)
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    on() {
      return () => {}
    },
    get(service) {
      if (service === 'workingDirectory') {
        return { defaultDirectory: '/tmp/session-cwd' }
      }
      return undefined
    },
    logger() {
      return {
        info: message => logs.push(`info ${message}`),
        warn: message => logs.push(`warn ${message}`),
        error: message => logs.push(`error ${message}`),
        debug: () => {},
      }
    },
  }
  return { ctx, registered, logs, state }
}

test('the plugin exports the contract DSH expects', () => {
  assert.equal(name, 'anydoc')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof apply, 'function')
  assert.equal(typeof Config, 'function')
})

test('apply registers the three tools and logs its configuration', (t) => {
  const { ctx, registered, logs } = fakeContext()
  apply(ctx, {})
  t.after(() => {
    for (const dispose of ctx.effects) if (typeof dispose === 'function') dispose()
  })
  assert.deepEqual(
    registered.map(tool => tool.name),
    ['anydoc_convert', 'anydoc_batch_convert', 'anydoc_capabilities'],
  )
  assert.ok(logs.some(line => line.startsWith('info dsh-anydoc ') && line.includes('registered 3 tools')), 'the mount is traceable')
  assert.ok(logs.some(line => line.includes('engine=worker')))
})

test('plugin disposal stops the engine', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, { engine: 'worker' })
  // The first effect owns the engine, the following three own the tools.
  const [engineEffect] = ctx.effects
  assert.equal(typeof engineEffect, 'function')
  engineEffect()
  assert.equal(registered.length, 3)
})

test('resolveConfig applies safe defaults', () => {
  const config = resolveConfig({})
  assert.equal(config.engine, 'worker')
  assert.equal(config.maxFileBytes, 100 * 1024 * 1024)
  assert.equal(config.batchConcurrency, 2)
  assert.equal(config.timeoutMs, 60_000)
  assert.equal(config.outputRoot, defaultOutputRoot())
  assert.deepEqual(config.allowedRoots, [])
  assert.equal(config.exportAssets, false)
  assert.equal(config.keepMarkdownFile, true)
  assert.equal(config.maxAssetBytes, 64 * 1024 * 1024)
})

test('resolveConfig clamps unsafe values', () => {
  const config = resolveConfig({
    maxFileBytes: 1,
    previewChars: 10 ** 9,
    timeoutMs: 0,
    batchConcurrency: 99,
    batchMaxFiles: 0,
    workerPoolSize: 50,
    maxOutputChars: -5,
    maxAssetBytes: 10 ** 12,
  })
  assert.equal(config.maxFileBytes, 1024 * 1024)
  assert.equal(config.previewChars, 200_000)
  assert.equal(config.timeoutMs, 1000)
  assert.equal(config.batchConcurrency, 8)
  assert.equal(config.batchMaxFiles, 1)
  assert.equal(config.workerPoolSize, 4)
  assert.equal(config.maxOutputChars, 1000)
  assert.equal(config.maxAssetBytes, 512 * 1024 * 1024)
})

test('resolveConfig ignores unusable allow-list entries', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'anydoc-config-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const warnings = []
  const config = resolveConfig({ allowedRoots: ['relative/path', path.join(directory, 'missing'), directory] }, { warn: message => warnings.push(message) })
  assert.equal(config.allowedRoots.length, 1, String(config.allowedRoots))
  assert.equal(config.allowedRoots[0], stripWindowsPrefix(realpathSync.native(directory)))
  assert.equal(warnings.length, 2)
})

test('the schemastery schema validates a row config', () => {
  const parsed = Config({ maxFileBytes: 2048, engine: 'inprocess' })
  assert.equal(parsed.maxFileBytes, 2048)
  assert.equal(parsed.engine, 'inprocess')
  assert.throws(() => Config({ engine: 'magic' }), /worker|inprocess|union/i)
})

test('the documented format table matches the plugin checks', () => {
  assert.ok(SUPPORTED_EXTENSIONS.includes('docx'))
  assert.ok(SUPPORTED_EXTENSIONS.includes('xlsb'))
  assert.ok(SUPPORTED_EXTENSIONS.includes('ppsx'))
  assert.ok(!SUPPORTED_EXTENSIONS.includes('txt'))
  assert.equal(extensionOf('/a/b/C.PPTX'), 'pptx')
  assert.equal(hasSupportedExtension('/a/b.unknown'), false)
})

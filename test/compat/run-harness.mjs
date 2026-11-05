#!/usr/bin/env node
/**
 * Compatibility harness, executed inside a sandbox created by
 * `test/check-compat.mjs`.
 *
 * The sandbox contains a copy of this plugin's shipping modules (`lib/`,
 * `index.js`) plus one specific generation of `@deepseek-ai/dsh-tools` (and
 * whatever `@deepseek-ai/schemastery` / `@deepseek-ai/cordis` that generation
 * resolves to). Running this file proves the plugin's tool definitions,
 * argument validation, rendering and a real conversion work against that
 * generation — not merely that the packages import.
 *
 * It is not meant to be run directly from the repository: `test/check-compat.mjs`
 * builds the sandbox and passes the repository root as argv[2].
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Config, resolveConfig } from './lib/config.js'
import { Engine } from './lib/engine.js'
import { createService } from './lib/service.js'
import { buildTools } from './lib/tools.js'
import { apply, inject, name as pluginName } from './index.js'

const REPO_ROOT = process.argv[2] ?? process.cwd()

/**
 * @param {string} name package name.
 * @returns {Promise<string>} the version installed in this sandbox.
 */
async function readVersion(name) {
  try {
    const text = await readFile(path.join('node_modules', ...name.split('/'), 'package.json'), 'utf8')
    return JSON.parse(text).version
  } catch {
    return 'absent'
  }
}

const versions = {
  dshTools: await readVersion('@deepseek-ai/dsh-tools'),
  schemastery: await readVersion('@deepseek-ai/schemastery'),
  cordis: await readVersion('@deepseek-ai/cordis'),
}

// 1. Configuration schema loads and validates on this schemastery generation.
const defaults = Config({})
assert.equal(defaults.engine, 'worker', 'schema default engine')
assert.equal(defaults.timeoutMs, 60_000, 'schema default timeoutMs')
const clamped = resolveConfig({ maxFileBytes: 1, batchConcurrency: 99 })
assert.equal(clamped.maxFileBytes, 1024 * 1024, 'clamp min maxFileBytes')
assert.equal(clamped.batchConcurrency, 8, 'clamp max batchConcurrency')
assert.equal(resolveConfig(undefined).engine, 'worker', 'undefined config falls back to defaults')

// 2. defineTool compiles the author DSL into the same public schema shape.
const warnings = []
const logger = { info() {}, warn: (message) => warnings.push(String(message)), error() {}, debug() {} }
const config = {
  ...clamped,
  engine: 'inprocess',
  outputRoot: await mkdtemp(path.join(os.tmpdir(), 'anydoc-compat-out-')),
}
const engine = new Engine({ config, logger })
const service = createService({
  config,
  engine,
  logger,
  pluginVersion: 'compat',
  resolveBaseDir: async () => REPO_ROOT,
})
const tools = buildTools(service, config)

assert.deepEqual(tools.map((tool) => tool.name), ['anydoc_convert', 'anydoc_batch_convert', 'anydoc_capabilities'])
const convert = tools[0]
assert.equal(convert.parameters.type, 'object')
assert.deepEqual(convert.parameters.required, ['sourcePath'])
assert.equal(convert.parameters.properties.sourcePath.type, 'string')
assert.equal(convert.output.schema.type, 'object')
assert.equal(convert.output.schema.additionalProperties, false)
assert.equal(convert.output.schema.properties.assets.items.type, 'object')
const batch = tools[1]
assert.equal(batch.parameters.properties.paths.items.type, 'string')
assert.equal(batch.output.schema.properties.results.items.type, 'object')
const capabilitiesTool = tools[2]
assert.equal(capabilitiesTool.parameters.properties.selfTest.type, 'boolean')

// 3. The capability tool runs the whole pipeline without touching a user document.
const exec = { signal: new AbortController().signal, agent: undefined }
const capabilities = await capabilitiesTool.execute({ selfTest: true }, exec)
assert.equal(capabilities.success, true)
assert.equal(capabilities.selfTest, 'passed')
assert.equal(capabilities.nativeOk, true)

// 4. A real conversion through the same code path.
const fixture = path.join(REPO_ROOT, 'test/fixtures/upstream/docx-text.docx')
const converted = await convert.execute({ sourcePath: fixture, previewChars: 500 }, exec)
assert.equal(converted.success, true, `${converted.errorCode}: ${converted.errorMessage}`)
assert.match(converted.markdownPreview, /Fixture Document/)
assert.ok(converted.outputPath.endsWith('.md'))
const text = await readFile(converted.outputPath, 'utf8')
assert.match(text, /\*\*bold\*\*/)

// 5. Arguments are validated by the same defineTool wrapper.
await assert.rejects(convert.execute({}, exec), /invalid arguments/)
await assert.rejects(convert.execute({ sourcePath: 42 }, exec), /invalid arguments/)

// 6. Rendering still produces one text block.
const rendered = convert.output.render({}, converted)
assert.equal(rendered.length, 1)
assert.equal(rendered[0].type, 'text')
assert.match(rendered[0].text, /^Converted /)

// 7. The plugin entry mounts through a stand-in Cordis context: this is the
//    contract DSH itself drives on activation.
assert.equal(pluginName, 'anydoc')
assert.deepEqual(inject, ['tools'])
const registered = []
const effects = []
const logs = []
const fakeCtx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  effect(callback) {
    const disposer = callback()
    effects.push(disposer)
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
  on() {
    return () => {}
  },
  get() {
    return undefined
  },
  logger() {
    return { info: (message) => logs.push(String(message)), warn: () => {}, error: () => {}, debug: () => {} }
  },
}
apply(fakeCtx, { engine: 'inprocess', outputRoot: config.outputRoot })
assert.deepEqual(registered.map((tool) => tool.name), ['anydoc_convert', 'anydoc_batch_convert', 'anydoc_capabilities'])
assert.ok(logs.some((line) => line.includes('registered 3 tools')), 'mount is logged')
for (const dispose of effects) if (typeof dispose === 'function') dispose()

engine.dispose()
console.log(JSON.stringify({ ok: true, ...versions, warnings: warnings.length, registered: registered.length }))

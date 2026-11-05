/**
 * Shared test harness: a plugin instance without the DSH Host.
 *
 * The real plugin receives `ctx` from DSH; these helpers build the same pieces
 * `apply()` builds (resolved config, engine, service, tool definitions) so the
 * tests exercise shipping code paths rather than reimplementations.
 *
 * @module dsh-anydoc/test/support/harness
 */

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Config, resolveConfig } from '../../lib/config.js'
import { Engine } from '../../lib/engine.js'
import { createService } from '../../lib/service.js'
import { buildTools } from '../../lib/tools.js'

export const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..')
export const FIXTURES = path.join(PLUGIN_ROOT, 'test', 'fixtures')
export const GENERATED = path.join(FIXTURES, 'generated')
export const UPSTREAM = path.join(FIXTURES, 'upstream')

/**
 * A collecting logger with the same surface as `ctx.logger(name)`.
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function, lines: Array<{ level: string, message: string }> }}
 */
export function createLogger() {
  const lines = []
  const record = level => (message) => {
    lines.push({ level, message: String(message) })
  }
  return { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'), lines }
}

/**
 * @typedef {object} Harness
 * @property {Readonly<object>} config resolved plugin config.
 * @property {Engine} engine conversion engine.
 * @property {ReturnType<typeof createService>} service the three tools' implementation.
 * @property {ReturnType<typeof createLogger>} logger collected log lines.
 * @property {object[]} tools the three registered tool definitions.
 * @property {string} baseDir the directory relative paths resolve against.
 * @property {() => Promise<void>} dispose stop the engine and remove the sandbox.
 */

/**
 * Build a plugin instance for tests.
 * @param {object} [options]
 * @param {object} [options.config] overrides merged over schema defaults.
 * @param {string} [options.baseDir] relative-path base; defaults to a fresh temp dir.
 * @returns {Promise<Harness>}
 */
export async function createHarness({ config: overrides = {}, baseDir } = {}) {
  const directory = baseDir ?? (await mkdtemp(path.join(os.tmpdir(), 'dsh-anydoc-test-')))
  const defaults = Config({})
  const config = resolveConfig({ ...defaults, outputRoot: path.join(directory, 'out'), ...overrides })
  const logger = createLogger()
  const engine = new Engine({ config, logger })
  const service = createService({
    config,
    engine,
    logger,
    pluginVersion: 'test',
    resolveBaseDir: async () => directory,
  })
  const tools = buildTools(service, config)
  return {
    config,
    engine,
    service,
    logger,
    tools,
    baseDir: directory,
    dispose: async () => {
      engine.dispose()
      if (baseDir === undefined) await rm(directory, { recursive: true, force: true })
    },
  }
}

/**
 * Find one tool definition by name.
 * @param {object[]} tools
 * @param {string} name
 * @returns {object}
 */
export function toolNamed(tools, name) {
  const tool = tools.find(entry => entry.name === name)
  if (tool === undefined) throw new Error(`tool not registered: ${name}`)
  return tool
}

/**
 * Call a tool the way the DSH pipeline does once arguments are validated.
 * @param {object[]} tools
 * @param {string} name
 * @param {object} args
 * @param {{ signal?: AbortSignal, agent?: object }} [exec]
 * @returns {Promise<unknown>} the declared output value.
 */
export async function invokeTool(tools, name, args, exec = {}) {
  const tool = toolNamed(tools, name)
  return await tool.execute(args, { signal: exec.signal ?? new AbortController().signal, agent: exec.agent })
}

/**
 * Render a tool result the way the pipeline does.
 * @param {object[]} tools
 * @param {string} name
 * @param {object} args
 * @param {unknown} value
 * @returns {string}
 */
export function renderTool(tools, name, args, value) {
  const tool = toolNamed(tools, name)
  return tool.output.render(args, value).map(block => block.text).join('\n')
}

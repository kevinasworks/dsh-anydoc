/**
 * dsh-anydoc — native DeepSeek Harness plugin exposing Firecrawl AnyDoc
 * document parsing as tools.
 *
 * ```text
 * DSH tool call -> dsh-anydoc tools -> conversion engine
 *   -> @firecrawl/anydoc (N-API) -> local Rust parser -> Markdown
 * ```
 *
 * Nothing in this plugin uploads a document: AnyDoc's only network path is an
 * explicit `ocr: 'hosted'` option, which is never passed.
 *
 * @module dsh-anydoc
 */

import { createRequire } from 'node:module'
import { Config, resolveConfig } from './lib/config.js'
import { Engine } from './lib/engine.js'
import { createService } from './lib/service.js'
import { buildTools } from './lib/tools.js'

const require = createRequire(import.meta.url)

/** Registered plugin name, matching `cordis.patch.yml`. */
export const name = 'anydoc'

/** The tool registry is the only Host service this plugin needs. */
export const inject = ['tools']

export { Config }

/**
 * Installed plugin version, read from the package manifest.
 * @returns {string}
 */
function pluginVersion() {
  try {
    return require('./package.json').version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Mount the plugin: resolve configuration, start the engine, register tools.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context.
 * @param {object} config the row configuration validated by {@link Config}.
 */
export function apply(ctx, config) {
  const logger = ctx.logger(name)
  const resolved = resolveConfig(config, { warn: message => logger.warn(message) })
  const version = pluginVersion()

  const engine = new Engine({ config: resolved, logger })
  ctx.effect(() => () => engine.dispose())

  /**
   * The directory caller-supplied relative paths resolve against: the
   * session working directory when the Host provides one.
   * @param {object | undefined} exec
   * @returns {Promise<string>}
   */
  const resolveBaseDir = async (exec) => {
    const workingDirectory = ctx.get('workingDirectory')
    const agent = exec?.agent
    if (workingDirectory !== undefined && agent !== undefined && typeof workingDirectory.ensure === 'function') {
      try {
        return await workingDirectory.ensure(agent, exec?.signal)
      } catch {
        // Fall through to the static default below.
      }
    }
    if (typeof workingDirectory?.defaultDirectory === 'string' && workingDirectory.defaultDirectory !== '') {
      return workingDirectory.defaultDirectory
    }
    return process.cwd()
  }

  const service = createService({ config: resolved, engine, logger, pluginVersion: version, resolveBaseDir })

  for (const tool of buildTools(service, resolved)) {
    ctx.effect(() => ctx.tools.register(tool))
  }

  logger.info(
    `dsh-anydoc ${version} registered 3 tools (engine=${resolved.engine}, outputRoot=${resolved.outputRoot}, maxFileBytes=${resolved.maxFileBytes}, timeoutMs=${resolved.timeoutMs})`,
  )
}

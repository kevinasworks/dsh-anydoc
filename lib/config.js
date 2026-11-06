/**
 * Plugin configuration: the schemastery declaration shown by Plugin Manager,
 * and the resolved runtime shape the tools use.
 *
 * Defaults are conservative: 100 MiB per file, two concurrent conversions in a
 * batch, a 60 s per-file timeout, and no output outside the configured root.
 *
 * @module dsh-anydoc/config
 */

import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { stripWindowsPrefix } from './platform.js'

const MIB = 1024 * 1024

/** Absolute default output root: `$DSH_HOME/anydoc-output`. */
export function defaultOutputRoot() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'anydoc-output')
}

export const Config = z.object({
  /** 'worker' isolates conversion in a child process; 'inprocess' runs it here. */
  engine: z.union(['worker', 'inprocess']).default('worker'),
  /** Directory for converted Markdown. Empty means `$DSH_HOME/anydoc-output`. */
  outputRoot: z.string().default(''),
  /** Largest accepted input file, in bytes. */
  maxFileBytes: z.number().default(100 * MIB),
  /** Characters of Markdown returned inline in a tool result. */
  previewChars: z.number().default(8000),
  /** Largest Markdown document the plugin will write or return. */
  maxOutputChars: z.number().default(5_000_000),
  /** Per-file conversion deadline, in milliseconds. */
  timeoutMs: z.number().default(60_000),
  /** Files converted at the same time inside one batch call. */
  batchConcurrency: z.number().default(2),
  /** Largest number of files one batch call accepts. */
  batchMaxFiles: z.number().default(50),
  /** Child processes available to the worker engine. */
  workerPoolSize: z.number().default(2),
  /** How long a worker process may take to report a ready binding. */
  workerStartTimeoutMs: z.number().default(20_000),
  /** Extra allow-list for inputs and outputs; empty means "no extra limit". */
  allowedRoots: z.array(z.string()).default([]),
  /** Whether `anydoc_convert` exports embedded images by default. */
  exportAssets: z.boolean().default(false),
  /** Total bytes of embedded assets one conversion may export. */
  maxAssetBytes: z.number().default(64 * MIB),
  /** Whether a converted Markdown file is written even for a small result. */
  keepMarkdownFile: z.boolean().default(true),
})

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} name
 * @returns {number}
 */
function clampInteger(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`dsh-anydoc: ${name} must be a finite number`)
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Read a numeric field, applying the schema default when the row omits it.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @param {string} name
 * @returns {number}
 */
function numberOr(value, fallback, min, max, name) {
  const candidate = typeof value === 'number' ? value : fallback
  return clampInteger(candidate, min, max, name)
}

/**
 * Canonicalise the configured allow-list roots.
 * @param {readonly string[]} roots
 * @param {(message: string) => void} [warn]
 * @returns {string[]}
 */
export function resolveAllowedRoots(roots, warn) {
  const resolved = []
  for (const raw of roots) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const expanded = raw.trim() === '~' ? os.homedir() : raw.trim().startsWith('~/') ? path.join(os.homedir(), raw.trim().slice(2)) : raw.trim()
    if (!path.isAbsolute(expanded)) {
      warn?.(`dsh-anydoc: allowedRoots entry is not absolute and was ignored: ${raw}`)
      continue
    }
    try {
      // Match fs.promises.realpath used for inputs/outputs: on Windows the
      // JS realpathSync implementation can retain DOS 8.3 aliases (RUNNER~1),
      // while the native resolver expands them (runneradmin).
      resolved.push(stripWindowsPrefix(realpathSync.native(expanded)))
    } catch {
      warn?.(`dsh-anydoc: allowedRoots entry does not exist and was ignored: ${raw}`)
    }
  }
  return resolved
}

/**
 * Turn the raw row config into the runtime shape, applying bounds.
 * @param {object} raw the validated row config.
 * @param {{ warn?: (message: string) => void }} [options]
 * @returns {Readonly<object>}
 */
export function resolveConfig(raw, { warn } = {}) {
  const config = raw ?? {}
  const engine = config.engine === 'inprocess' ? 'inprocess' : 'worker'
  const outputRoot = typeof config.outputRoot === 'string' && config.outputRoot.trim() !== ''
    ? (config.outputRoot.trim() === '~' ? os.homedir() : config.outputRoot.trim().startsWith('~/') ? path.join(os.homedir(), config.outputRoot.trim().slice(2)) : config.outputRoot.trim())
    : defaultOutputRoot()

  return Object.freeze({
    engine,
    outputRoot: path.resolve(outputRoot),
    maxFileBytes: numberOr(config.maxFileBytes, 100 * MIB, MIB, 2 * 1024 * MIB, 'maxFileBytes'),
    previewChars: numberOr(config.previewChars, 8000, 500, 200_000, 'previewChars'),
    maxOutputChars: numberOr(config.maxOutputChars, 5_000_000, 1000, 100_000_000, 'maxOutputChars'),
    timeoutMs: numberOr(config.timeoutMs, 60_000, 1000, 600_000, 'timeoutMs'),
    batchConcurrency: numberOr(config.batchConcurrency, 2, 1, 8, 'batchConcurrency'),
    batchMaxFiles: numberOr(config.batchMaxFiles, 50, 1, 500, 'batchMaxFiles'),
    workerPoolSize: numberOr(config.workerPoolSize, 2, 1, 4, 'workerPoolSize'),
    workerStartTimeoutMs: numberOr(config.workerStartTimeoutMs, 20_000, 1000, 120_000, 'workerStartTimeoutMs'),
    allowedRoots: Object.freeze(resolveAllowedRoots(Array.isArray(config.allowedRoots) ? config.allowedRoots : [], warn)),
    exportAssets: config.exportAssets === true,
    maxAssetBytes: numberOr(config.maxAssetBytes, 64 * MIB, 0, 512 * MIB, 'maxAssetBytes'),
    keepMarkdownFile: config.keepMarkdownFile !== false,
  })
}

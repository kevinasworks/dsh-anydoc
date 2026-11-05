/**
 * Filesystem safety for dsh-anydoc.
 *
 * The plugin runs inside the DSH Host process, so Node's own filesystem calls
 * are not sandboxed. These helpers are therefore the whole boundary: they
 * normalise the path, resolve symlinks and junctions before use, refuse
 * credential locations, enforce optional allow-listed roots, and never let a
 * caller-supplied name escape the chosen output directory.
 *
 * @module dsh-anydoc/paths
 */

import { constants as fsConstants } from 'node:fs'
import { access, mkdir, open, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AnyDocFailure } from './errors.js'
import {
  classifyReadError,
  classifyWriteError,
  isPathInside,
  isWindowsAbsolute,
  sanitizeFileName,
  stripWindowsPrefix,
} from './platform.js'

export { isWindowsAbsolute, stripWindowsPrefix }

/**
 * Locations this plugin refuses to read, matched on the resolved real path.
 * The list is deliberately small: it covers credentials and private keys, and
 * nothing a user would reasonably hand to a document converter.
 */
const FORBIDDEN_FRAGMENTS = Object.freeze([
  '/.ssh/',
  '/.gnupg/',
  '/.aws/credentials',
  '/library/keychains/',
  '/.dsh/credentials',
  '/.netrc',
])

const MAX_STEM_LENGTH = 120

/**
 * `~` is the only home abbreviation accepted; everything else is literal.
 * @param {string} value
 * @returns {string}
 */
function expandUser(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

/**
 * Validate and absolutise one caller-supplied path without touching the disk.
 * @param {string} raw caller-supplied path.
 * @param {{ baseDir: string, label?: string }} options
 * @returns {string} an absolute, normalised path.
 */
export function resolveUserPath(raw, { baseDir, label = 'path' }) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new AnyDocFailure('INVALID_ARGUMENT', `${label} must be a non-empty string`)
  }
  if (raw.includes('\0')) {
    throw new AnyDocFailure('INVALID_ARGUMENT', `${label} contains a NUL byte`)
  }
  const expanded = expandUser(raw.trim())
  if (isWindowsAbsolute(expanded) && process.platform !== 'win32') {
    throw new AnyDocFailure('INVALID_ARGUMENT', `${label} looks like a Windows absolute path, which this host cannot resolve: ${raw}`)
  }
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDir, expanded)
}

/**
 * Resolve symlinks for the part of `target` that exists, and keep the missing
 * tail verbatim. Output directories and files that do not exist yet still get
 * their existing ancestors checked.
 * @param {string} target absolute, normalised path.
 * @returns {Promise<string>}
 */
export async function realpathDeep(target) {
  let current = target
  const tail = []
  for (;;) {
    try {
      const resolved = await realpath(current)
      const full = tail.length > 0 ? path.join(resolved, ...tail.reverse()) : resolved
      return stripWindowsPrefix(full)
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      const parent = path.dirname(current)
      if (parent === current) return stripWindowsPrefix(target)
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Whether `child` is `parent` or sits below it after normalisation.
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
export function isInside(child, parent) {
  return isPathInside(child, parent, { pathImpl: path })
}

/**
 * Reject credential and private-key locations.
 * @param {string} resolvedPath
 */
export function assertNotForbidden(resolvedPath) {
  const probe = `/${resolvedPath.replaceAll('\\', '/').toLowerCase()}/`
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    if (probe.includes(fragment)) {
      throw new AnyDocFailure('PATH_FORBIDDEN', `refusing to read a credential location: ${resolvedPath}`, { path: resolvedPath })
    }
  }
}

/**
 * Enforce the optional allow-list. Empty list means "no extra restriction".
 * @param {string} resolvedPath
 * @param {readonly string[]} allowedRoots absolute, already-resolved roots.
 * @param {string} label
 */
export function assertAllowedRoot(resolvedPath, allowedRoots, label) {
  if (allowedRoots.length === 0) return
  for (const root of allowedRoots) {
    if (isInside(resolvedPath, root)) return
  }
  throw new AnyDocFailure(
    'PATH_OUTSIDE_ALLOWED_ROOTS',
    `${label} is outside configured allowedRoots: ${resolvedPath}`,
    { path: resolvedPath, allowedRoots: [...allowedRoots] },
  )
}

/**
 * Check one input document and return its canonical real path and size.
 * @param {string} raw caller-supplied path.
 * @param {{ baseDir: string, allowedRoots: readonly string[], maxFileBytes: number }} options
 * @returns {Promise<{ requestedPath: string, realPath: string, size: number, mtimeMs: number }>}
 */
export async function checkInputFile(raw, { baseDir, allowedRoots, maxFileBytes }) {
  const requestedPath = resolveUserPath(raw, { baseDir, label: 'path' })
  const realPath = await realpathDeep(requestedPath)
  assertNotForbidden(realPath)
  assertAllowedRoot(realPath, allowedRoots, 'path')

  let info
  try {
    info = await stat(realPath)
  } catch (error) {
    const classified = classifyReadError(error, requestedPath)
    throw new AnyDocFailure(classified.code, classified.message, { path: requestedPath })
  }
  if (!info.isFile()) throw new AnyDocFailure('NOT_A_FILE', `not a regular file: ${requestedPath}`, { path: requestedPath })
  if (info.size === 0) throw new AnyDocFailure('EMPTY_FILE', `file is empty: ${requestedPath}`, { path: requestedPath })
  if (info.size > maxFileBytes) {
    throw new AnyDocFailure(
      'FILE_TOO_LARGE',
      `file is ${info.size} bytes, above maxFileBytes=${maxFileBytes}: ${requestedPath}`,
      { path: requestedPath, size: info.size, maxFileBytes },
    )
  }
  try {
    await access(realPath, fsConstants.R_OK)
  } catch {
    throw new AnyDocFailure('PERMISSION_DENIED', `file is not readable: ${requestedPath}`, { path: requestedPath })
  }
  return { requestedPath, realPath, size: info.size, mtimeMs: info.mtimeMs }
}

/**
 * Resolve, validate and create an output directory.
 * @param {string} raw caller-supplied directory.
 * @param {{ baseDir: string, allowedRoots: readonly string[] }} options
 * @returns {Promise<string>} the canonical directory path.
 */
export async function prepareOutputDirectory(raw, { baseDir, allowedRoots }) {
  const requested = resolveUserPath(raw, { baseDir, label: 'outputDir' })
  const resolved = await realpathDeep(requested)
  assertAllowedRoot(resolved, allowedRoots, 'outputDir')
  try {
    await mkdir(resolved, { recursive: true })
  } catch (error) {
    throw new AnyDocFailure('OUTPUT_UNWRITABLE', `cannot create output directory ${resolved}: ${error?.message ?? String(error)}`, { path: resolved })
  }
  let info
  try {
    info = await stat(resolved)
  } catch (error) {
    throw new AnyDocFailure('OUTPUT_UNWRITABLE', `cannot stat output directory ${resolved}: ${error?.message ?? String(error)}`, { path: resolved })
  }
  if (!info.isDirectory()) throw new AnyDocFailure('OUTPUT_UNWRITABLE', `outputDir is not a directory: ${resolved}`, { path: resolved })
  try {
    await access(resolved, fsConstants.W_OK)
  } catch {
    throw new AnyDocFailure('OUTPUT_UNWRITABLE', `output directory is not writable: ${resolved}`, { path: resolved })
  }
  return realpathDeep(resolved)
}

/**
 * Make one user-controlled name safe as a single path segment.
 * @param {string} value
 * @param {string} fallback used when nothing usable remains.
 * @returns {string}
 */
export function sanitizeSegment(value, fallback = 'document') {
  return sanitizeFileName(value, { fallback })
}

/**
 * The file-name stem for a source document: `report.docx` -> `report`.
 * @param {string} sourcePath
 * @returns {string}
 */
export function stemOf(sourcePath) {
  const base = path.basename(sourcePath)
  const extension = path.extname(base)
  const stem = extension === '' ? base : base.slice(0, -extension.length)
  return sanitizeSegment(stem, 'document')
}

/**
 * Reserve an unused output file name. The returned path is not created; the
 * writer opens it with `wx` and retries on `EEXIST`, which closes the race.
 * @param {string} directory canonical output directory.
 * @param {string} stem sanitized file-name stem.
 * @param {string} extensionWithDot e.g. `.md`.
 * @param {{ overwrite: boolean }} options
 * @returns {Promise<string>}
 */
export async function allocateOutputPath(directory, stem, extensionWithDot, { overwrite }) {
  if (overwrite) return path.join(directory, `${stem}${extensionWithDot}`)
  for (let index = 0; index < 1000; index++) {
    const candidate = path.join(directory, index === 0 ? `${stem}${extensionWithDot}` : `${stem}-${index}${extensionWithDot}`)
    if (!isInside(candidate, directory)) {
      throw new AnyDocFailure('OUTPUT_UNWRITABLE', `refusing to write outside the output directory: ${candidate}`, { path: candidate })
    }
    try {
      await stat(candidate)
      continue
    } catch (error) {
      if (error?.code === 'ENOENT') return candidate
      throw new AnyDocFailure('OUTPUT_UNWRITABLE', `cannot inspect ${candidate}: ${error?.message ?? String(error)}`, { path: candidate })
    }
  }
  throw new AnyDocFailure('OUTPUT_EXISTS', `no free output name for ${stem}${extensionWithDot} after 1000 attempts`, { path: directory })
}

/**
 * Write a file honouring the no-overwrite default.
 * @param {string} filePath
 * @param {string | Uint8Array} data
 * @param {{ overwrite: boolean }} options
 * @returns {Promise<{ path: string, bytes: number }>}
 */
export async function writeFileSafe(filePath, data, { overwrite }) {
  const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
  const flags = overwrite ? 'w' : 'wx'
  let handle
  try {
    handle = await open(filePath, flags, 0o600)
  } catch (error) {
    const classified = classifyWriteError(error, filePath)
    throw new AnyDocFailure(classified.code, classified.message, { path: filePath })
  }
  try {
    await handle.writeFile(payload)
  } finally {
    await handle.close()
  }
  return { path: filePath, bytes: payload.byteLength }
}

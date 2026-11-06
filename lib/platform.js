/**
 * Platform rules, kept pure so Windows behaviour can be tested on a macOS or
 * Linux host.
 *
 * Every function takes its `path` implementation and platform flag explicitly
 * instead of reading `process.platform` deep inside. `lib/paths.js` calls them
 * with the real `node:path` and `process.platform`; the test suite calls them
 * with `path.win32` and `win32: true` to exercise the Windows branch.
 *
 * @module dsh-anydoc/platform
 */

import nodePath from 'node:path'

/**
 * The prebuilt binding packages upstream AnyDoc 0.2.4 publishes, by npm
 * package suffix. This list is the plugin's whole support envelope: anything
 * outside it is unsupported rather than "maybe".
 */
export const UPSTREAM_PREBUILT_TARGETS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-x64-gnu',
  'linux-x64-musl',
  'win32-x64-msvc',
])

/** Windows device names that cannot be used as a file name, extension or not. */
export const WINDOWS_RESERVED_NAMES = Object.freeze(
  new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`])]),
)

/** Windows' legacy MAX_PATH, minus headroom for the extension and a suffix. */
export const WINDOWS_LONG_PATH_THRESHOLD = 240

/**
 * A Windows drive or UNC path seen on a POSIX host names nothing usable.
 * @param {string} value
 * @returns {boolean}
 */
export function isWindowsAbsolute(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/**
 * Undo the `\\?\` extended-length prefix that `fs.realpath` returns on Windows,
 * including the `\\?\UNC\` form, without corrupting a plain UNC path.
 * @param {string} value
 * @returns {string}
 */
export function stripWindowsPrefix(value) {
  if (!value.startsWith('\\\\?\\')) return value
  const rest = value.slice(4)
  // \\?\UNC\server\share -> \\server\share
  if (rest.toUpperCase().startsWith('UNC\\')) return `\\\\${rest.slice(4)}`
  return rest
}

/**
 * Whether `child` is `parent` or sits below it. On Windows `path.relative` is
 * case-insensitive and returns an absolute path when the two live on different
 * drives, which this treats as "not inside".
 * @param {string} child
 * @param {string} parent
 * @param {{ pathImpl?: typeof nodePath }} [options]
 * @returns {boolean}
 */
export function isPathInside(child, parent, { pathImpl = nodePath } = {}) {
  const relative = pathImpl.relative(parent, child)
  if (relative === '') return true
  return !relative.startsWith('..') && !pathImpl.isAbsolute(relative)
}

/**
 * Make one user-controlled name safe as a single path segment on this platform.
 *
 * Always: Unicode NFC, no control characters, no separators, no traversal-only
 * name, no trailing dots or spaces, bounded length.
 * Windows additionally: no colon (NTFS alternate data streams) and no reserved
 * device name.
 *
 * @param {string} value raw name.
 * @param {{ fallback?: string, win32?: boolean, maxLength?: number }} [options]
 * @returns {string}
 */
export function sanitizeFileName(value, { fallback = 'document', win32 = process.platform === 'win32', maxLength = 120 } = {}) {
  let cleaned = String(value)
    .normalize('NFC')
    .replaceAll(/[\u0000-\u001f\u007f]/g, '')
    .replaceAll(/[\\/]+/g, '_')
    .replace(/^\.+$/, '_')
    // Windows drops trailing dots and spaces; doing it everywhere keeps names
    // portable between platforms.
    .replaceAll(/[. ]+$/g, '')
    .trim()

  if (win32) {
    // "name:stream" creates an alternate data stream rather than a file.
    cleaned = cleaned.replaceAll(':', '_').replaceAll(/[. ]+$/g, '')
    const bare = cleaned.split('.')[0]?.toLowerCase() ?? ''
    if (WINDOWS_RESERVED_NAMES.has(bare) || WINDOWS_RESERVED_NAMES.has(cleaned.toLowerCase())) {
      cleaned = `_${cleaned}`
    }
  }

  // Truncate by code point so a surrogate pair (emoji) is never split.
  if (cleaned.length > maxLength) cleaned = [...cleaned].slice(0, maxLength).join('')
  return cleaned === '' ? fallback : cleaned
}

/**
 * Report when a Windows path would cross the legacy MAX_PATH limit. Node can
 * still open such a path on hosts with long-path support, so this is a warning
 * rather than a refusal.
 * @param {string} target absolute path.
 * @param {{ win32?: boolean }} [options]
 * @returns {string | undefined} a warning message, or undefined.
 */
export function describeLongPathRisk(target, { win32 = process.platform === 'win32' } = {}) {
  if (!win32) return undefined
  if (target.length <= WINDOWS_LONG_PATH_THRESHOLD) return undefined
  return `output path is ${target.length} characters, close to or past the legacy Windows MAX_PATH limit (260); enable long-path support or choose a shorter outputDir`
}

/**
 * Translate a failed read/stat into the plugin's vocabulary. Only the read
 * side maps `ENOENT` to `FILE_NOT_FOUND`; writers treat a missing parent as an
 * output problem instead.
 * @param {unknown} error
 * @param {string} target path being touched.
 * @returns {{ code: string, message: string }}
 */
export function classifyReadError(error, target) {
  switch (error?.code) {
    case 'ENOENT':
      return { code: 'FILE_NOT_FOUND', message: `no such file: ${target}` }
    case 'EACCES':
    case 'EPERM':
      return { code: 'PERMISSION_DENIED', message: `permission denied: ${target}` }
    case 'EBUSY':
      return { code: 'PERMISSION_DENIED', message: `the file is locked by another program: ${target}` }
    case 'ENAMETOOLONG':
      return { code: 'IO_ERROR', message: `path is too long: ${target}` }
    default:
      return { code: 'IO_ERROR', message: `cannot read ${target}: ${error?.message ?? String(error)}` }
  }
}

/**
 * Translate a failed write into the plugin's vocabulary.
 * @param {unknown} error
 * @param {string} target path being written.
 * @returns {{ code: string, message: string }}
 */
export function classifyWriteError(error, target) {
  switch (error?.code) {
    case 'EEXIST':
      return { code: 'OUTPUT_EXISTS', message: `output file already exists: ${target}` }
    case 'EACCES':
    case 'EPERM':
      return { code: 'OUTPUT_UNWRITABLE', message: `permission denied while writing: ${target}` }
    case 'EBUSY':
      return { code: 'OUTPUT_UNWRITABLE', message: `the file is locked by another program: ${target}` }
    case 'ENOSPC':
      return { code: 'OUTPUT_UNWRITABLE', message: `the destination volume is full: ${target}` }
    case 'EROFS':
      return { code: 'OUTPUT_UNWRITABLE', message: `the destination is read-only: ${target}` }
    case 'ENAMETOOLONG':
      return { code: 'OUTPUT_UNWRITABLE', message: `path is too long: ${target}` }
    default:
      return { code: 'OUTPUT_UNWRITABLE', message: `cannot write ${target}: ${error?.message ?? String(error)}` }
  }
}

/**
 * What upstream AnyDoc provides for a platform/CPU pair, and what to do when it
 * provides nothing. Pure so every combination can be tested on one machine.
 *
 * @param {string} [platform] Node's `process.platform`.
 * @param {string} [arch] Node's `process.arch`.
 * @returns {{ key: string, status: 'supported' | 'unsupported' | 'unknown', note: string, hint?: string }}
 */
export function describePlatformSupport(platform = process.platform, arch = process.arch) {
  const key = `${platform}/${arch}`
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      key,
      status: 'supported',
      note: 'Apple silicon: upstream publishes a native arm64 binding (anydoc.darwin-arm64.node). This is the plugin\'s primary platform and the one its test suite and real tool calls run on.',
    }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return {
      key,
      status: 'supported',
      note: 'Intel Macs run the published darwin-x64 binding natively; on Apple silicon it requires Rosetta.',
    }
  }
  if (platform === 'win32' && arch === 'x64') {
    return { key, status: 'supported', note: 'Windows 10/11 x64: upstream publishes a native x64 binding (anydoc.win32-x64-msvc.node).' }
  }
  if (platform === 'win32' && arch === 'arm64') {
    return {
      key,
      status: 'unsupported',
      note: 'Upstream AnyDoc publishes no win32-arm64 binding, so a native arm64 Windows host cannot load the parser.',
      hint: 'Use the x64 build of DSH (Windows runs it under x64 emulation) or an x64 machine; there is no arm64 binary to install.',
    }
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return {
      key,
      status: 'supported',
      note: `Upstream publishes glibc and musl bindings for linux ${arch}; npm selects the matching optional dependency.`,
    }
  }
  return {
    key,
    status: 'unsupported',
    note: `Upstream AnyDoc publishes no binding for ${key}; its prebuilt targets are darwin arm64/x64, win32 x64, and linux x64/arm64 (glibc and musl).`,
    hint: 'Run this plugin only where upstream ships a binding; other platforms are out of scope until upstream adds a target.',
  }
}

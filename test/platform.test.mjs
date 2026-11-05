/**
 * Platform-rule tests.
 *
 * The Windows branches run on this macOS host by passing `path.win32` and
 * `win32: true` into the pure helpers in `lib/platform.js`. That covers the
 * platform-specific rules; it does not pretend to execute a Windows binary —
 * see KNOWN_LIMITATIONS for what remains unverified.
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  classifyReadError,
  classifyWriteError,
  describeLongPathRisk,
  isPathInside,
  isWindowsAbsolute,
  sanitizeFileName,
  stripWindowsPrefix,
} from '../lib/platform.js'
import { sanitizeSegment, isInside } from '../lib/paths.js'

const win32 = path.win32

test('stripWindowsPrefix restores drive and UNC paths', () => {
  assert.equal(stripWindowsPrefix('\\\\?\\C:\\Users\\me\\a.docx'), 'C:\\Users\\me\\a.docx')
  assert.equal(stripWindowsPrefix('\\\\?\\UNC\\server\\share\\dir\\a.docx'), '\\\\server\\share\\dir\\a.docx')
  assert.equal(stripWindowsPrefix('C:\\Users\\me\\a.docx'), 'C:\\Users\\me\\a.docx')
  assert.equal(stripWindowsPrefix('/Volumes/data/a.docx'), '/Volumes/data/a.docx')
  // A plain UNC path must not lose its leading separators.
  assert.equal(stripWindowsPrefix('\\\\server\\share\\a.docx'), '\\\\server\\share\\a.docx')
})

test('isPathsInside matches Windows semantics including case and drives', () => {
  assert.equal(isPathInside('C:\\Docs\\a.docx', 'C:\\Docs', { pathImpl: win32 }), true)
  assert.equal(isPathInside('c:\\docs\\a.docx', 'C:\\Docs', { pathImpl: win32 }), true, 'Windows paths are case-insensitive')
  assert.equal(isPathInside('C:\\Docs\\sub\\a.docx', 'C:\\Docs', { pathImpl: win32 }), true)
  assert.equal(isPathInside('C:\\Docs', 'C:\\Docs', { pathImpl: win32 }), true)
  assert.equal(isPathInside('C:\\Docsy\\a.docx', 'C:\\Docs', { pathImpl: win32 }), false)
  assert.equal(isPathInside('D:\\Other\\a.docx', 'C:\\Docs', { pathImpl: win32 }), false, 'different drive')
  assert.equal(isPathInside('C:\\Docs\\..\\Other\\a.docx', 'C:\\Docs', { pathImpl: win32 }), false, 'traversal')
  assert.equal(isPathInside('\\\\server\\share\\docs\\a.docx', '\\\\server\\share\\docs', { pathImpl: win32 }), true)
  assert.equal(isPathInside('\\\\server\\share\\other\\a.docx', '\\\\server\\share\\docs', { pathImpl: win32 }), false)
  // POSIX stays case-sensitive.
  assert.equal(isPathInside('/Volumes/Docs/a.docx', '/Volumes/Docs'), true)
  assert.equal(isPathInside('/Volumes/docs/a.docx', '/Volumes/Docs'), false)
})

test('isWindowsAbsolute recognises drive and UNC input', () => {
  assert.equal(isWindowsAbsolute('C:\\Users\\a.docx'), true)
  assert.equal(isWindowsAbsolute('d:/data/a.docx'), true)
  assert.equal(isWindowsAbsolute('\\\\server\\share\\a.docx'), true)
  assert.equal(isWindowsAbsolute('/Volumes/data/a.docx'), false)
  // Drive-relative names are not absolute paths.
  assert.equal(win32.isAbsolute('C:foo'), false)
})

test('sanitizeFileName enforces Windows-specific rules only on win32', () => {
  // Reserved device names.
  assert.equal(sanitizeFileName('CON', { win32: true }), '_CON')
  assert.equal(sanitizeFileName('con.txt', { win32: true }), '_con.txt')
  assert.equal(sanitizeFileName('LPT1', { win32: true }), '_LPT1')
  assert.equal(sanitizeFileName('COM9.report', { win32: true }), '_COM9.report')
  assert.equal(sanitizeFileName('console', { win32: true }), 'console', 'prefix matches are not device names')
  // Alternate data streams.
  assert.equal(sanitizeFileName('report:stream', { win32: true }), 'report_stream')
  // POSIX keeps a colon and a reserved-looking name.
  assert.equal(sanitizeFileName('report:stream', { win32: false }), 'report:stream')
  assert.equal(sanitizeFileName('CON', { win32: false }), 'CON')
  // Trailing dots and spaces are dropped everywhere.
  assert.equal(sanitizeFileName('report. . ', { win32: true }), 'report')
  assert.equal(sanitizeFileName('report. . ', { win32: false }), 'report')
  // Separators, traversal and control characters.
  assert.equal(sanitizeFileName('..\\..\\evil', { win32: true }), '.._.._evil')
  assert.equal(sanitizeFileName('../etc/passwd', { win32: false }), '.._etc_passwd')
  assert.equal(sanitizeFileName('a\u0000b\u001fc', { win32: true }), 'abc')
  // Length bound and empty fallback.
  assert.equal(sanitizeFileName('长'.repeat(400), { win32: true }).length, 120)
  // Truncation never splits a surrogate pair.
  const emoji = sanitizeFileName('👨‍👩‍👧'.repeat(60), { win32: true, maxLength: 5 })
  assert.equal([...emoji].length, 5)
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji), 'no dangling high surrogate')
  assert.equal(sanitizeFileName('...', { win32: true }), '_')
  assert.equal(sanitizeFileName('', { win32: true, fallback: 'document' }), 'document')
  // Unicode survives intact.
  assert.equal(sanitizeFileName('中文 文件名（含空格）', { win32: true }), '中文 文件名（含空格）')
})

test('the shipping wrappers use the same rules', () => {
  assert.equal(isInside('/a/b', '/a'), true)
  assert.equal(isInside('/a/../etc', '/a'), false)
  assert.equal(sanitizeSegment('../etc/passwd'), '.._etc_passwd')
  assert.equal(sanitizeSegment('', 'fallback'), 'fallback')
})

test('long Windows paths are warned about, not refused', () => {
  const short = 'C:\\Users\\me\\out\\a.md'
  assert.equal(describeLongPathRisk(short, { win32: true }), undefined)
  const long = `C:\\Users\\me\\${'x'.repeat(240)}\\a.md`
  const warning = describeLongPathRisk(long, { win32: true })
  assert.match(warning, /MAX_PATH/)
  assert.equal(describeLongPathRisk(long, { win32: false }), undefined, 'POSIX has no MAX_PATH')
})

test('filesystem errors map to actionable codes', () => {
  assert.equal(classifyReadError({ code: 'ENOENT' }, 'C:\\a.docx').code, 'FILE_NOT_FOUND')
  assert.equal(classifyReadError({ code: 'EACCES' }, 'C:\\a.docx').code, 'PERMISSION_DENIED')
  assert.match(classifyReadError({ code: 'EBUSY' }, 'C:\\a.docx').message, /locked by another program/)
  assert.equal(classifyReadError({ code: 'ENAMETOOLONG' }, 'C:\\a.docx').code, 'IO_ERROR')
  assert.equal(classifyReadError({ code: 'EIO', message: 'boom' }, 'C:\\a.docx').code, 'IO_ERROR')

  assert.equal(classifyWriteError({ code: 'EEXIST' }, 'C:\\a.md').code, 'OUTPUT_EXISTS')
  assert.equal(classifyWriteError({ code: 'EPERM' }, 'C:\\a.md').code, 'OUTPUT_UNWRITABLE')
  assert.match(classifyWriteError({ code: 'EBUSY' }, 'C:\\a.md').message, /locked/)
  assert.equal(classifyWriteError({ code: 'ENOSPC' }, 'C:\\a.md').code, 'OUTPUT_UNWRITABLE')
  assert.equal(classifyWriteError({ code: 'EROFS' }, 'C:\\a.md').code, 'OUTPUT_UNWRITABLE')
})

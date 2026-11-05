/**
 * Filesystem-boundary tests: normalisation, symlink resolution, allow-lists,
 * credential refusal, output naming, and overwrite protection.
 */

import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  allocateOutputPath,
  assertAllowedRoot,
  assertNotForbidden,
  checkInputFile,
  isInside,
  isWindowsAbsolute,
  prepareOutputDirectory,
  realpathDeep,
  resolveUserPath,
  sanitizeSegment,
  stemOf,
  writeFileSafe,
} from '../lib/paths.js'
import { AnyDocFailure } from '../lib/errors.js'

/**
 * Make a throwaway sandbox.
 * @returns {Promise<{ root: string, dispose: () => Promise<void> }>}
 */
async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'anydoc-paths-'))
  return { root, dispose: () => rm(root, { recursive: true, force: true }) }
}

test('resolveUserPath resolves relative paths against the base directory', () => {
  // Expectations are derived with the same `path` implementation the plugin
  // uses, so this test also holds on Windows.
  const base = '/tmp/base'
  assert.equal(resolveUserPath('docs/a.docx', { baseDir: base }), path.resolve(base, 'docs/a.docx'))
  assert.equal(resolveUserPath('./x/../y.docx', { baseDir: base }), path.resolve(base, 'y.docx'))
  assert.equal(resolveUserPath('~/a.docx', { baseDir: base }), path.join(os.homedir(), 'a.docx'))
  if (process.platform !== 'win32') {
    assert.equal(resolveUserPath('/abs/a.docx', { baseDir: base }), '/abs/a.docx')
  }
})

test('resolveUserPath rejects unusable arguments', () => {
  assert.throws(() => resolveUserPath('', { baseDir: '/tmp' }), (error) => error instanceof AnyDocFailure && error.code === 'INVALID_ARGUMENT')
  assert.throws(() => resolveUserPath('   ', { baseDir: '/tmp' }), /non-empty/)
  assert.throws(() => resolveUserPath('a\0b', { baseDir: '/tmp' }), /NUL/)
  assert.throws(() => resolveUserPath(42, { baseDir: '/tmp' }), /non-empty/)
})

test('a Windows drive path is refused on a POSIX host', { skip: process.platform === 'win32' }, () => {
  assert.equal(isWindowsAbsolute('C:\\Users\\a.docx'), true)
  assert.equal(isWindowsAbsolute('\\\\server\\share\\a.docx'), true)
  assert.equal(isWindowsAbsolute('/tmp/a.docx'), false)
  assert.throws(() => resolveUserPath('C:\\Users\\a.docx', { baseDir: '/tmp' }), /Windows absolute path/)
})

test('isInside accepts the root itself and rejects siblings', () => {
  assert.equal(isInside('/a/b', '/a'), true)
  assert.equal(isInside('/a', '/a'), true)
  assert.equal(isInside('/a/bc', '/a/b'), false)
  assert.equal(isInside('/a/../etc', '/a'), false)
  assert.equal(isInside('/ab', '/a'), false)
})

test('realpathDeep resolves the existing ancestor of a missing path', async (t) => {
  const box = await sandbox()
  t.after(box.dispose)
  await mkdir(path.join(box.root, 'real'))
  const resolved = await realpathDeep(path.join(box.root, 'real', 'missing', 'file.md'))
  assert.equal(resolved, path.join(await realpathDeep(box.root), 'real', 'missing', 'file.md'))
})

test('sanitizeSegment keeps one safe path segment', () => {
  assert.equal(sanitizeSegment('report'), 'report')
  assert.equal(sanitizeSegment('../etc/passwd'), '.._etc_passwd')
  assert.equal(sanitizeSegment('a/b\\c'), 'a_b_c')
  assert.equal(sanitizeSegment('name\u0000with\u001fcontrol'), 'namewithcontrol')
  assert.equal(sanitizeSegment('trailing. . '), 'trailing')
  assert.equal(sanitizeSegment('...'), '_')
  assert.equal(sanitizeSegment('', 'fallback'), 'fallback')
  assert.equal(sanitizeSegment('中文 文件名（含空格）'), '中文 文件名（含空格）')
  assert.equal(sanitizeSegment('x'.repeat(400)).length, 120)
})

test('stemOf strips only the final extension', () => {
  assert.equal(stemOf('/docs/report.v2.docx'), 'report.v2')
  assert.equal(stemOf('/docs/无扩展名'), '无扩展名')
  assert.equal(stemOf('/docs/.hidden'), '.hidden')
})

test('credential locations are refused before any stat', () => {
  assert.throws(() => assertNotForbidden(path.join(os.homedir(), '.ssh', 'id_rsa')), (error) => error.code === 'PATH_FORBIDDEN')
  assert.throws(() => assertNotForbidden('/home/me/.aws/credentials'), /credential/)
  assert.throws(() => assertNotForbidden('/Users/me/.dsh/credentials/anything.json'), /credential/)
  assert.doesNotThrow(() => assertNotForbidden(path.join(os.homedir(), 'Documents', 'a.docx')))
})

test('allowedRoots rejects anything outside its roots', () => {
  assert.throws(() => assertAllowedRoot('/etc/passwd', ['/srv/docs'], 'path'), (error) => error.code === 'PATH_OUTSIDE_ALLOWED_ROOTS')
  assert.doesNotThrow(() => assertAllowedRoot('/srv/docs/a.docx', ['/srv/docs'], 'path'))
  assert.doesNotThrow(() => assertAllowedRoot('/anywhere/a.docx', [], 'path'))
})

test('checkInputFile reports each rejection with a stable code', async (t) => {
  const box = await sandbox()
  t.after(box.dispose)
  const empty = path.join(box.root, 'empty.docx')
  await writeFile(empty, '')
  const missing = path.join(box.root, 'missing.docx')
  const directory = path.join(box.root, 'dir.docx')
  await mkdir(directory)
  const big = path.join(box.root, 'big.docx')
  await writeFile(big, Buffer.alloc(2 * 1024 * 1024, 7))
  const unreadable = path.join(box.root, 'unreadable.docx')
  await writeFile(unreadable, 'x')
  await chmod(unreadable, 0o000)

  const options = { baseDir: box.root, allowedRoots: [], maxFileBytes: 100 * 1024 * 1024 }
  await assert.rejects(checkInputFile(missing, options), (error) => error.code === 'FILE_NOT_FOUND')
  await assert.rejects(checkInputFile(directory, options), (error) => error.code === 'NOT_A_FILE')
  await assert.rejects(checkInputFile(empty, options), (error) => error.code === 'EMPTY_FILE')
  await assert.rejects(checkInputFile(big, { ...options, maxFileBytes: 1024 * 1024 }), (error) => error.code === 'FILE_TOO_LARGE')
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    // chmod-based read denial is not how Windows models permissions.
    await assert.rejects(checkInputFile(unreadable, options), (error) => error.code === 'PERMISSION_DENIED')
  }

  const ok = path.join(box.root, 'ok.docx')
  await writeFile(ok, 'content')
  const checked = await checkInputFile('ok.docx', options)
  assert.equal(checked.size, 7)
  assert.equal(checked.realPath, path.join(await realpathDeep(box.root), 'ok.docx'))
})

test('a symlink cannot escape allowedRoots', { skip: process.platform === 'win32' ? 'creating symlinks on Windows needs Developer Mode or elevation' : false }, async (t) => {
  const box = await sandbox()
  t.after(box.dispose)
  const allowed = path.join(box.root, 'allowed')
  await mkdir(allowed)
  const outside = path.join(box.root, 'secret.docx')
  await writeFile(outside, 'secret')
  await symlink(outside, path.join(allowed, 'link.docx'))
  await assert.rejects(
    checkInputFile(path.join(allowed, 'link.docx'), { baseDir: box.root, allowedRoots: [allowed], maxFileBytes: 1024 * 1024 }),
    (error) => error.code === 'PATH_OUTSIDE_ALLOWED_ROOTS',
  )
  // Without the allow-list the resolved target is still reported honestly.
  const checked = await checkInputFile(path.join(allowed, 'link.docx'), { baseDir: box.root, allowedRoots: [], maxFileBytes: 1024 * 1024 })
  assert.equal(checked.realPath, await realpathDeep(outside))
})

test('output directories are created, validated and never escape allowedRoots', async (t) => {
  const box = await sandbox()
  t.after(box.dispose)
  const nested = path.join(box.root, 'a', 'b')
  const created = await prepareOutputDirectory(nested, { baseDir: box.root, allowedRoots: [] })
  assert.equal(created, await realpathDeep(nested))
  assert.equal((await stat(created)).isDirectory(), true)
  await assert.rejects(
    prepareOutputDirectory(path.join(box.root, 'outside'), { baseDir: box.root, allowedRoots: [path.join(box.root, 'a')] }),
    (error) => error.code === 'PATH_OUTSIDE_ALLOWED_ROOTS',
  )
})

test('allocateOutputPath never reuses a name and respects overwrite', async (t) => {
  const box = await sandbox()
  t.after(box.dispose)
  const first = await allocateOutputPath(box.root, 'report', '.md', { overwrite: false })
  assert.equal(path.basename(first), 'report.md')
  await writeFile(first, 'x')
  const second = await allocateOutputPath(box.root, 'report', '.md', { overwrite: false })
  assert.equal(path.basename(second), 'report-1.md')
  await writeFile(second, 'x')
  const third = await allocateOutputPath(box.root, 'report', '.md', { overwrite: false })
  assert.equal(path.basename(third), 'report-2.md')
  const forced = await allocateOutputPath(box.root, 'report', '.md', { overwrite: true })
  assert.equal(path.basename(forced), 'report.md')
})

test('writeFileSafe refuses to overwrite unless asked', async (t) => {
  const box = await sandbox()
  t.after(box.dispose)
  const target = path.join(box.root, 'out.md')
  await writeFileSafe(target, 'one', { overwrite: false })
  await assert.rejects(writeFileSafe(target, 'two', { overwrite: false }), (error) => error.code === 'OUTPUT_EXISTS')
  await writeFileSafe(target, 'three', { overwrite: true })
  assert.equal(await (await import('node:fs/promises')).readFile(target, 'utf8'), 'three')
})

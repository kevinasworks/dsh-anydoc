#!/usr/bin/env node
/**
 * Platform packaging verifier.
 *
 * Checks the parts of "runs on Windows 10+ / Apple-silicon macOS" that can be
 * proven without those machines:
 *
 *   1. `@firecrawl/anydoc` publishes a prebuilt binding for both targets;
 *   2. the installed macOS binary really is an arm64 Mach-O bundle;
 *   3. (online) the published Windows binary really is an x64 PE image.
 *
 * It does not and cannot execute the Windows binary.
 *
 *   node test/check-platforms.mjs            # includes the online Windows check
 *   node test/check-platforms.mjs --offline  # local checks only
 *
 * Exit codes: 0 = all verified, 1 = mismatch, 2 = offline/registry unreachable.
 */

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const OFFLINE = process.argv.includes('--offline')
const NPM_CACHE = path.join(os.tmpdir(), 'anydoc-platform-check-cache')
// Windows resolves `npm` to npm.cmd, which Node cannot spawn without a shell.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const SHELL = process.platform === 'win32'

/** @type {Array<{ check: string, target: string, result: string, detail: string }>} */
const rows = []
const record = (check, target, result, detail = '') => rows.push({ check, target, result, detail })

/**
 * @param {string} file
 * @returns {Promise<Buffer>}
 */
const head = async (file, bytes = 4096) => (await readFile(file)).subarray(0, bytes)

/**
 * @param {Buffer} buffer
 * @returns {{ format: string, arch: string }}
 */
function describeBinary(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) {
    const cpuType = buffer.readUInt32LE(4)
    const arch = cpuType === 0x0100000c ? 'arm64' : cpuType === 0x01000007 ? 'x86_64' : `cputype:0x${cpuType.toString(16)}`
    return { format: 'Mach-O 64', arch }
  }
  if (buffer.length >= 0x40 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    const peOffset = buffer.readUInt32LE(0x3c)
    if (peOffset + 6 <= buffer.length && buffer.toString('latin1', peOffset, peOffset + 4) === 'PE\0\0') {
      const machine = buffer.readUInt16LE(peOffset + 4)
      const arch = machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : machine === 0x014c ? 'x86' : `machine:0x${machine.toString(16)}`
      return { format: 'PE', arch }
    }
  }
  return { format: 'unknown', arch: 'unknown' }
}

/**
 * @param {string} directory
 * @param {string} suffix
 * @returns {Promise<string | undefined>} first file ending in suffix.
 */
async function findFile(directory, suffix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.endsWith(suffix)) return full
    if (entry.isDirectory()) {
      const nested = await findFile(full, suffix)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

// 1. The dependency declares a prebuilt binding for both targets.
const anydocDir = path.join(REPO_ROOT, 'node_modules', '@firecrawl', 'anydoc')
const anydocManifest = JSON.parse(await readFile(path.join(anydocDir, 'package.json'), 'utf8'))
const optional = anydocManifest.optionalDependencies ?? {}
const pinned = anydocManifest.version
for (const [name, expectation] of [
  ['@firecrawl/anydoc-darwin-arm64', 'Apple silicon macOS'],
  ['@firecrawl/anydoc-win32-x64-msvc', 'Windows 10/11 x64'],
]) {
  const version = optional[name]
  if (version === undefined) record('optionalDependency', `${name} (${expectation})`, 'FAIL', 'not declared by the published package')
  else if (version !== pinned) record('optionalDependency', `${name} (${expectation})`, 'FAIL', `declares ${version}, package is ${pinned}`)
  else record('optionalDependency', `${name} (${expectation})`, 'PASS', `version ${version}`)
}

// 2. Check the binding for this runner, not a hard-coded macOS package.
const localTarget = process.platform === 'darwin'
  ? { pkg: `darwin-${process.arch}`, format: 'Mach-O 64', arch: process.arch === 'x64' ? 'x86_64' : process.arch }
  : process.platform === 'win32'
    ? { pkg: `win32-${process.arch}-msvc`, format: 'PE', arch: process.arch }
    : null
if (localTarget === null) {
  record('installed binary', `${process.platform}/${process.arch}`, 'FAIL', 'local binary verification is not implemented for this platform')
} else {
  try {
    const directory = path.join(REPO_ROOT, 'node_modules', '@firecrawl', `anydoc-${localTarget.pkg}`)
    const binary = await findFile(directory, '.node')
    if (binary === undefined) throw new Error('no .node file')
    const described = describeBinary(await head(binary, 4096))
    const size = (await stat(binary)).size
    const result = described.format === localTarget.format && described.arch === localTarget.arch ? 'PASS' : 'FAIL'
    record('installed binary', localTarget.pkg, result, `${path.basename(binary)} · ${described.format} ${described.arch} · ${size} bytes`)
  } catch (error) {
    record('installed binary', localTarget.pkg, 'FAIL', error instanceof Error ? error.message : String(error))
  }
}

// 3. The published Windows binding is an x64 PE image.
if (OFFLINE) {
  record('published binary', 'win32-x64-msvc', 'SKIP', '--offline')
} else {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'anydoc-win32-check-'))
  try {
    execFileSync(NPM, ['pack', `@firecrawl/anydoc-win32-x64-msvc@${pinned}`, '--silent'], {
      cwd: sandbox,
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: SHELL,
      env: { ...process.env, npm_config_cache: NPM_CACHE },
    })
    const tarball = (await readdir(sandbox)).find((name) => name.endsWith('.tgz'))
    if (tarball === undefined) throw new Error('npm pack produced no tarball')
    execFileSync('tar', ['-xzf', path.join(sandbox, tarball), '-C', sandbox], { timeout: 60_000 })
    const binary = await findFile(path.join(sandbox, 'package'), '.node')
    if (binary === undefined) throw new Error('no .node file in the published tarball')
    const described = describeBinary(await head(binary, 4096))
    const size = (await stat(binary)).size
    if (described.format === 'PE' && described.arch === 'x64') {
      record('published binary', 'win32-x64-msvc', 'PASS', `${path.basename(binary)} · PE x64 · ${size} bytes`)
    } else {
      record('published binary', 'win32-x64-msvc', 'FAIL', `${described.format} ${described.arch}`)
    }
  } catch (error) {
    record('published binary', 'win32-x64-msvc', 'SKIP', (error instanceof Error ? error.message : String(error)).slice(0, 120))
  } finally {
    await rm(sandbox, { recursive: true, force: true }).catch(() => {})
  }
}

const width = Math.max(...rows.map((row) => row.check.length))
console.log('dsh-anydoc 平台打包检查\n')
console.log(`AnyDoc ${pinned} · 本机 ${process.platform}/${process.arch} · node ${process.version}\n`)
console.log(`${'检查'.padEnd(width)}  ${'目标'.padEnd(24)}  ${'结果'.padEnd(5)}  说明`)
for (const row of rows) console.log(`${row.check.padEnd(width)}  ${row.target.padEnd(24)}  ${row.result.padEnd(5)}  ${row.detail}`)

console.log('')
const failed = rows.filter((row) => row.result === 'FAIL')
const skipped = rows.filter((row) => row.result === 'SKIP')
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((row) => row.target).join(', ')}`)
  process.exit(1)
}
if (skipped.length > 0) {
  console.log(`部分检查跳过（离线或注册表不可达）：${skipped.map((row) => row.target).join(', ')}`)
  process.exit(2)
}
console.log('PASS: macOS arm64 与 Windows x64 的预编译产物均已就绪')

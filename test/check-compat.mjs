#!/usr/bin/env node
/**
 * Backward-compatibility checker.
 *
 * For every DSH generation the plugin claims to support, this builds a
 * throwaway sandbox with that generation's `@deepseek-ai/dsh-tools` (which
 * pins the matching `@deepseek-ai/schemastery` and `@deepseek-ai/cordis`),
 * copies this plugin's shipping modules into it, and executes
 * `test/compat/run-harness.mjs` there. The harness compiles the tool schemas,
 * validates arguments, runs the capability self test and converts a real
 * document — so a pass means the plugin's public contract works on that
 * generation, not merely that the packages import.
 *
 *   node test/check-compat.mjs            # verify every claimed line
 *   node test/check-compat.mjs --keep     # keep sandboxes for inspection
 *
 * Needs network access for `npm install`. When the registry is unreachable the
 * affected line is reported as SKIP instead of failing.
 */

import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const HARNESS = path.join(REPO_ROOT, 'test', 'compat', 'run-harness.mjs')
const NPM_CACHE = path.join(os.tmpdir(), 'anydoc-compat-npm-cache')
const KEEP = process.argv.includes('--keep')
const TIMEOUT_MS = 180_000
// Windows resolves `npm` to npm.cmd, which Node cannot spawn without a shell.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const SHELL = process.platform === 'win32'

/**
 * The generations this plugin claims to support, expressed as the
 * `@deepseek-ai/dsh-tools` version that ships with each DSH line. The mapping
 * mirrors the `engines.dsh` range in package.json.
 */
const MATRIX = [
  { dsh: '0.2.0-rc.2', dshTools: '0.2.0-rc.2' },
  { dsh: '0.2.1-rc.5', dshTools: '0.2.1-rc.5' },
  { dsh: '0.2.2-rc.1', dshTools: '0.2.2-rc.1' },
]

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ ok: boolean, stdout: string, stderr: string }}
 */
function run(args, cwd) {
  try {
    const stdout = execFileSync(args[0], args.slice(1), {
      cwd,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: args[0] === NPM ? SHELL : false,
      env: { ...process.env, npm_config_cache: NPM_CACHE },
    })
    return { ok: true, stdout, stderr: '' }
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error.message) }
  }
}

/**
 * @param {{ dsh: string, dshTools: string }} entry
 * @returns {Promise<{ dsh: string, dshTools: string, schemastery: string, cordis: string, result: string, detail: string, sandbox: string }>}
 */
async function checkLine(entry) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), `anydoc-compat-${entry.dshTools}-`))
  const row = { dsh: entry.dsh, dshTools: entry.dshTools, schemastery: '?', cordis: '?', result: 'FAIL', detail: '', sandbox }

  await writeFile(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'anydoc-compat', private: true, type: 'module' }, null, 2))

  const install = run([NPM, 'install', '--no-audit', '--no-fund', `@deepseek-ai/dsh-tools@${entry.dshTools}`], sandbox)
  if (!install.ok) {
    row.result = 'SKIP'
    row.detail = `npm install failed: ${install.stderr.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 160)}`
    return row
  }

  await cp(path.join(REPO_ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true })
  await cp(path.join(REPO_ROOT, 'index.js'), path.join(sandbox, 'index.js'))
  await cp(HARNESS, path.join(sandbox, 'run-harness.mjs'))
  await symlink(path.join(REPO_ROOT, 'node_modules', '@firecrawl'), path.join(sandbox, 'node_modules', '@firecrawl'), 'dir')

  for (const [key, name] of [['schemastery', '@deepseek-ai/schemastery'], ['cordis', '@deepseek-ai/cordis']]) {
    try {
      row[key] = JSON.parse(await readFile(path.join(sandbox, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version
    } catch {
      row[key] = 'absent'
    }
  }

  const executed = run(['node', 'run-harness.mjs', REPO_ROOT], sandbox)
  if (executed.ok) {
    row.result = 'PASS'
    const line = executed.stdout.trim().split('\n').at(-1) ?? ''
    row.detail = `warnings=${JSON.parse(line).warnings ?? '?'}`
  } else {
    const message = (executed.stderr || executed.stdout).split('\n').filter(Boolean).slice(-3).join(' | ')
    row.detail = message.slice(0, 220)
  }
  return row
}

const rows = []
for (const entry of MATRIX) {
  process.stdout.write(`checking dsh ${entry.dsh} (dsh-tools ${entry.dshTools}) ... `)
  const row = await checkLine(entry)
  rows.push(row)
  console.log(row.result)
}

const width = Math.max(...rows.map((row) => row.dsh.length))
console.log('')
console.log(`${'DSH'.padEnd(width)}  ${'dsh-tools'.padEnd(12)}  ${'schemastery'.padEnd(11)}  ${'cordis'.padEnd(7)}  result`)
for (const row of rows) {
  console.log(`${row.dsh.padEnd(width)}  ${row.dshTools.padEnd(12)}  ${row.schemastery.padEnd(11)}  ${row.cordis.padEnd(7)}  ${row.result}${row.detail === '' ? '' : `  (${row.detail})`}`)
}

if (!KEEP) {
  for (const row of rows) await rm(row.sandbox, { recursive: true, force: true }).catch(() => {})
} else {
  console.log('\nsandboxes kept:')
  for (const row of rows) console.log(' ', row.sandbox)
}

const failed = rows.filter((row) => row.result === 'FAIL')
const skipped = rows.filter((row) => row.result === 'SKIP')
console.log('')
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((row) => row.dsh).join(', ')}`)
  process.exit(1)
}
if (skipped.length === rows.length) {
  console.log('所有目标线都无法安装（离线？），未能验证。')
  process.exit(2)
}
console.log(`PASS: ${rows.filter((row) => row.result === 'PASS').map((row) => row.dsh).join(', ')}${skipped.length > 0 ? ` | SKIP: ${skipped.map((row) => row.dsh).join(', ')}` : ''}`)

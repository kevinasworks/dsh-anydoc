#!/usr/bin/env node
/**
 * 检查 dsh-anydoc 是否需要升级或重新适配。
 *
 * 比对四类事实：
 *   1. 本机 DSH 版本 vs 官方仓库最新 tag、桌面端 nightly feed
 *   2. 插件锁定并安装的 @firecrawl/anydoc 版本
 *   3. npm 上 @firecrawl/anydoc 的 latest
 *   4. 上游仓库最新 tag / HEAD
 *
 * 只读：不安装、不下载、不修改任何文件。网络不可用时对应项标记为 unknown。
 *
 *   node test/check-updates.mjs
 *
 * 退出码：0 = 无需升级；1 = 有可用更新；2 = 关键项无法判定。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TIMEOUT_MS = 20_000
const FEED = 'https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml'
const REPO = 'https://github.com/firecrawl/anydoc.git'
const DSH_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git'
const NPM_CACHE = path.join(os.tmpdir(), 'dsh-anydoc-update-check-cache')

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {string | null} trimmed stdout, or null when it failed.
 */
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ...options.env },
    }).trim()
  } catch {
    return null
  }
}

/**
 * @param {string} url
 * @returns {string | null}
 */
function fetchText(url) {
  const result = run('curl', ['-fsSL', '--max-time', '15', url])
  return result === null || result === '' ? null : result
}

/**
 * Compare two dotted versions; prerelease suffixes sort before the release.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareVersions(left, right) {
  const split = value => {
    const [core, ...rest] = value.replace(/^v/, '').split('-')
    return { core: core.split('.').map(Number), pre: rest.join('-') }
  }
  const a = split(left)
  const b = split(right)
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (delta !== 0) return delta
  }
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const pinnedAnyDoc = manifest.dependencies['@firecrawl/anydoc']
const installedAnyDoc = (() => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'node_modules/@firecrawl/anydoc/package.json'), 'utf8')).version
  } catch {
    return null
  }
})()

const dshInstalled = (run('dsh', ['--version']) ?? '').replace(/^v/, '') || null

const feedVersion = (() => {
  const text = fetchText(FEED)
  if (text === null) return null
  return /^version:\s*(\S+)$/m.exec(text)?.[1] ?? null
})()

const dshRepoLatest = (() => {
  const text = run('git', ['ls-remote', '--tags', '--refs', DSH_REPO])
  if (text === null) return null
  const versions = text
    .split('\n')
    .map(line => line.split('/').pop())
    .filter(tag => tag.startsWith('dsh-v'))
    .map(tag => tag.slice('dsh-v'.length))
    .sort(compareVersions)
  return versions.at(-1) ?? null
})()

const anyDocNpmLatest = (() => {
  const text = run('npm', ['view', '@firecrawl/anydoc', 'dist-tags', '--json'], { env: { npm_config_cache: NPM_CACHE } })
  if (text === null) return null
  try {
    return JSON.parse(text).latest ?? null
  } catch {
    return null
  }
})()

const anyDocRepoLatest = (() => {
  const text = run('git', ['ls-remote', '--tags', '--refs', REPO])
  if (text === null) return null
  const versions = text
    .split('\n')
    .map(line => line.split('/').pop())
    .filter(tag => /^v\d/.test(tag))
    .map(tag => tag.slice(1))
    .sort(compareVersions)
  return versions.at(-1) ?? null
})()

/** @type {Array<{ item: string, local: string, upstream: string, verdict: string }>} */
const rows = []
const push = (item, local, upstream, compare) => {
  let verdict = 'unknown'
  if (local !== null && upstream !== null) verdict = compare(local, upstream) >= 0 ? 'up-to-date' : 'UPDATE AVAILABLE'
  else if (local === null) verdict = 'local missing'
  rows.push({ item, local: local ?? 'unknown', upstream: upstream ?? 'unreachable', verdict })
}

push('DSH (GitHub latest tag)', dshInstalled, dshRepoLatest, compareVersions)
push('DSH (desktop nightly feed)', dshInstalled, feedVersion, compareVersions)
push('@firecrawl/anydoc (npm latest)', pinnedAnyDoc, anyDocNpmLatest, compareVersions)
push('@firecrawl/anydoc (git latest tag)', pinnedAnyDoc, anyDocRepoLatest, compareVersions)

console.log('dsh-anydoc 更新检查\n')
console.log(`插件版本            : ${manifest.version}`)
console.log(`锁定 AnyDoc         : ${pinnedAnyDoc}`)
console.log(`实际安装 AnyDoc     : ${installedAnyDoc ?? '未安装'}`)
console.log(`engines.dsh         : ${manifest.engines?.dsh ?? '(未声明)'}`)
console.log(`engines.node        : ${manifest.engines?.node ?? '(未声明)'}`)
console.log(`平台                : ${process.platform}/${process.arch}  node ${process.version}\n`)

const width = Math.max(...rows.map(row => row.item.length))
console.log(`${'检查项'.padEnd(width)}  ${'本机'.padEnd(18)}  ${'上游'.padEnd(18)}  结论`)
for (const row of rows) {
  console.log(`${row.item.padEnd(width)}  ${row.local.padEnd(18)}  ${row.upstream.padEnd(18)}  ${row.verdict}`)
}

const pinnedMismatch = installedAnyDoc !== null && installedAnyDoc !== pinnedAnyDoc
if (pinnedMismatch) {
  console.log(`\n注意：实际安装的 AnyDoc ${installedAnyDoc} 与 package.json 锁定的 ${pinnedAnyDoc} 不一致。`)
}

const updates = rows.filter(row => row.verdict === 'UPDATE AVAILABLE')
const unknown = rows.filter(row => row.verdict === 'unknown')

console.log('')
if (updates.length > 0) {
  console.log(`结论：有 ${updates.length} 项可更新 —— ${updates.map(row => row.item).join('、')}。升级前必须先跑完整测试与真实 Tool Call 复验。`)
  process.exit(1)
}
if (unknown.length > 0 && unknown.length === rows.length) {
  console.log('结论：所有上游检查项都无法访问（离线？），无法判定是否需要升级。')
  process.exit(2)
}
console.log('结论：不需要升级，也不需要重新适配。' + (unknown.length > 0 ? `（${unknown.length} 项上游不可达，已跳过）` : ''))

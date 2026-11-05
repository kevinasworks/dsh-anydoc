#!/usr/bin/env node
/**
 * dsh-anydoc benchmark.
 *
 * Measures real conversions through the shipping engine (worker mode by
 * default) and prints per-file timing plus output size. These are this
 * plugin's numbers on this machine, not upstream's published benchmark.
 *
 *   node test/bench.mjs [--mode worker|inprocess] [--runs 5]
 */

import { readdir, readFile, stat, writeFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Engine } from '../lib/engine.js'
import { resolveConfig } from '../lib/config.js'
import { createLogger } from './support/harness.mjs'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const mode = argValue('--mode', 'worker')
const runs = Number(argValue('--runs', '5'))
const root = path.resolve(import.meta.dirname, '..')
const targets = [
  path.join(root, 'test/fixtures/generated/zh-mixed.docx'),
  path.join(root, 'test/fixtures/generated/zh-long.docx'),
  path.join(root, 'test/fixtures/generated/zh-heavy.docx'),
  path.join(root, 'test/fixtures/generated/zh-table.xlsx'),
  path.join(root, 'test/fixtures/generated/zh-slides.pptx'),
  path.join(root, 'test/fixtures/upstream/docx-text.docx'),
  path.join(root, 'test/fixtures/upstream/pdf-text.pdf'),
  path.join(root, 'test/fixtures/upstream/pptx-pres.pptx'),
  path.join(root, 'test/fixtures/upstream/xlsx-sheet.xlsx'),
]

const logger = createLogger()
const config = resolveConfig({ engine: mode })
const engine = new Engine({ config, logger })

/**
 * @param {number[]} values
 * @returns {{ min: number, median: number, max: number }}
 */
function stats(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  }
}

console.log(`mode=${mode} runs=${runs} platform=${process.platform}/${process.arch} runtime=${process.version}`)
const rows = []
for (const file of targets) {
  const size = (await stat(file)).size
  const timings = []
  let chars = 0
  for (let index = 0; index < runs; index++) {
    const started = performance.now()
    const result = await engine.convert({ file, wantAssets: false, maxAssetBytes: 0 })
    timings.push(performance.now() - started)
    chars = result.markdown.length
  }
  const measured = stats(timings)
  rows.push({ file: path.basename(file), size, chars, ...measured })
  console.log(
    `${path.basename(file).padEnd(30)} in=${String(size).padStart(8)}B out=${String(chars).padStart(8)}ch ` +
      `min=${measured.min.toFixed(1)}ms median=${measured.median.toFixed(1)}ms max=${measured.max.toFixed(1)}ms`,
  )
}

// Concurrency behaviour: the same ten files, one and four at a time.
const directory = path.join(root, 'test/fixtures/generated')
const files = (await readdir(directory)).filter(name => name.endsWith('.docx') || name.endsWith('.xlsx') || name.endsWith('.pptx') || name.endsWith('.csv'))
for (const concurrency of [1, 4]) {
  const started = performance.now()
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (index >= files.length) return
      await engine.convert({ file: path.join(directory, files[index]), wantAssets: false, maxAssetBytes: 0 })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  console.log(`concurrency=${concurrency} files=${files.length} wall=${(performance.now() - started).toFixed(1)}ms`)
}

engine.dispose()
console.log(JSON.stringify({ mode, rows }, null, 2))

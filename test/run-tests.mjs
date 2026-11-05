#!/usr/bin/env node
/**
 * Cross-platform test entry point.
 *
 * `node --test test/*.test.mjs` depends on the shell expanding the glob, which
 * cmd.exe does not do; this runner expands it itself and passes explicit file
 * paths to the Node test runner, so `npm test` behaves the same on macOS,
 * Linux and Windows.
 */

import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const directory = import.meta.dirname
const files = (await readdir(directory))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(directory, name))

if (files.length === 0) {
  console.error('no *.test.mjs files found')
  process.exit(1)
}

try {
  execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
} catch (error) {
  process.exit(typeof error?.status === 'number' ? error.status : 1)
}

/**
 * Conversion worker process for dsh-anydoc.
 *
 * Runs the AnyDoc native binding in a separate Node process so a panic,
 * runaway allocation, or an uninterruptible parse can be stopped with
 * `SIGKILL` and cannot take the DSH Host down with it. The parent enforces
 * every path and size limit before a request is sent and owns all filesystem
 * writes.
 *
 * Protocol (one request in flight at a time):
 *   parent -> child  { type: 'convert', id, file, wantAssets, maxAssetBytes }
 *   child  -> parent { type: 'ready', anydocVersion }
 *   child  -> parent { type: 'fatal', errorCode, errorMessage }
 *   child  -> parent { type: 'result', id, ok, ... }
 *
 * @module dsh-anydoc/worker-entry
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { convertWithAnyDoc, mapEngineError } from './convert-core.js'

const require = createRequire(import.meta.url)

let anydocModule

/**
 * @returns {Promise<Record<string, unknown>>} the loaded AnyDoc binding.
 */
async function loadAnyDoc() {
  if (anydocModule === undefined) anydocModule = await import('@firecrawl/anydoc')
  return anydocModule
}

/** @returns {string} the installed `@firecrawl/anydoc` version, or 'unknown'. */
function anydocVersion() {
  try {
    return require('@firecrawl/anydoc/package.json').version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * @param {number} id request correlation id.
 * @param {{ file: string, wantAssets: boolean, maxAssetBytes: number }} request
 */
async function handleConvert(id, request) {
  const anydoc = await loadAnyDoc()
  const bytes = await readFile(request.file)
  const payload = await convertWithAnyDoc(anydoc, {
    bytes,
    file: request.file,
    wantAssets: request.wantAssets,
    maxAssetBytes: request.maxAssetBytes,
  })
  process.send?.({ type: 'result', id, ok: true, ...payload })
}

process.on('message', (message) => {
  if (message === null || typeof message !== 'object' || message.type !== 'convert') return
  handleConvert(message.id, message).catch((error) => {
    process.send?.({ type: 'result', id: message.id, ok: false, ...mapEngineError(error) })
  })
})

// Report a binding that cannot load immediately, so the parent can explain it
// instead of timing out on the first request.
loadAnyDoc().then(
  () => process.send?.({ type: 'ready', anydocVersion: anydocVersion() }),
  (error) => {
    process.send?.({
      type: 'fatal',
      errorCode: 'NATIVE_UNAVAILABLE',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  },
)

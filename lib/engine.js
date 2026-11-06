/**
 * Execution engine for dsh-anydoc.
 *
 * Two modes, one conversion core:
 *  - `worker` (default): a pool of child processes running the AnyDoc native
 *    binding. A timeout or cancellation kills the process, which is real
 *    interruption rather than an abandoned promise, and a native crash cannot
 *    take the DSH Host down.
 *  - `inprocess`: the binding is loaded in the Host process. Used when a
 *    worker cannot be started, and selectable for diagnosis. A timeout there
 *    cannot stop the running native call, and the reported code says so.
 *
 * @module dsh-anydoc/engine
 */

import { fork } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { convertWithAnyDoc } from './convert-core.js'
import { AnyDocFailure } from './errors.js'
import { describePlatformSupport } from './platform.js'

const WORKER_ENTRY = fileURLToPath(new URL('./worker-entry.js', import.meta.url))

/**
 * Actionable advice for a native binding that will not load. Upstream ships no
 * Windows-on-ARM build, and a plugin directory copied between machines keeps
 * the other platform's binaries.
 * @returns {string}
 */
function nativeLoadHint() {
  const support = describePlatformSupport()
  if (support.status === 'supported') {
    return 'run "npm install --omit=dev" inside the plugin directory on this machine so the platform binary for this OS and CPU is installed'
  }
  return support.hint ?? `${support.key} is not a platform upstream AnyDoc builds for`
}
const require = createRequire(import.meta.url)
const STDERR_TAIL_BYTES = 4000

/**
 * @param {object} payload worker failure payload.
 * @returns {AnyDocFailure}
 */
function failureFromPayload(payload) {
  return new AnyDocFailure(payload.errorCode ?? 'CONVERSION_FAILED', payload.errorMessage ?? 'conversion failed', {
    pages: payload.pages ?? undefined,
    rawCode: payload.rawCode ?? undefined,
  })
}

/** A pool of Node processes running `worker-entry.js`. */
class WorkerPool {
  /**
   * @param {{ size: number, logger: { warn: (message: string) => void }, spawnTimeoutMs?: number }} options
   */
  constructor({ size, logger, spawnTimeoutMs = 20_000 }) {
    this.size = Math.max(1, Math.trunc(size))
    this.logger = logger
    this.spawnTimeoutMs = spawnTimeoutMs
    this.idle = []
    this.live = new Set()
    this.waiters = []
    this.disposed = false
  }

  /**
   * Run one conversion, reusing an idle worker when possible.
   * @param {{ file: string, wantAssets: boolean, maxAssetBytes: number }} request
   * @param {{ signal?: AbortSignal, timeoutMs: number }} options
   * @returns {Promise<object>}
   */
  async run(request, { signal, timeoutMs }) {
    if (this.disposed) throw new AnyDocFailure('ENGINE_DISPOSED', 'the AnyDoc conversion engine is disposed')
    if (signal?.aborted === true) throw new AnyDocFailure('CANCELLED', 'the tool call was cancelled')
    const handle = await this.#acquire(signal)
    try {
      return await this.#dispatch(handle, request, { signal, timeoutMs })
    } finally {
      this.#release(handle)
    }
  }

  /**
   * Start (or reuse) a worker and report its binding version.
   * @returns {Promise<{ anydocVersion: string }>}
   */
  async probe() {
    const handle = await this.#acquire(undefined)
    try {
      return { anydocVersion: handle.readyInfo?.anydocVersion ?? 'unknown' }
    } finally {
      this.#release(handle)
    }
  }

  /** Stop every worker process. */
  dispose() {
    this.disposed = true
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.signal !== undefined) waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.reject(new AnyDocFailure('ENGINE_DISPOSED', 'the AnyDoc conversion engine is disposed'))
    }
    for (const handle of [...this.live]) this.#kill(handle, 'engine disposed')
    this.idle.length = 0
  }

  /**
   * @param {AbortSignal | undefined} signal
   * @returns {Promise<object>} a worker handle.
   */
  async #acquire(signal) {
    if (this.disposed) throw new AnyDocFailure('ENGINE_DISPOSED', 'the AnyDoc conversion engine is disposed')
    const reusable = this.idle.pop()
    if (reusable !== undefined) {
      reusable.busy = true
      return reusable
    }
    if (this.live.size < this.size) return await this.#spawn()
    return await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: undefined }
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new AnyDocFailure('CANCELLED', 'the tool call was cancelled while waiting for a conversion worker'))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  /** @param {object} handle */
  #release(handle) {
    if (handle.dead || this.disposed) {
      handle.busy = false
      this.live.delete(handle)
      return
    }
    const waiter = this.waiters.shift()
    if (waiter !== undefined) {
      if (waiter.signal !== undefined) waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.resolve(handle)
      return
    }
    handle.busy = false
    this.idle.push(handle)
  }

  /** @returns {Promise<object>} a started worker handle. */
  async #spawn() {
    let child
    try {
      child = fork(WORKER_ENTRY, [], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        serialization: 'json',
      })
    } catch (error) {
      throw new AnyDocFailure('WORKER_START_FAILED', `cannot start the AnyDoc worker process: ${error instanceof Error ? error.message : String(error)}`)
    }

    const handle = {
      child,
      busy: true,
      dead: false,
      pending: null,
      nextId: 0,
      stderr: '',
      readyInfo: null,
      onReady: null,
      onFatal: null,
    }
    this.live.add(handle)

    child.stderr?.on('data', (chunk) => {
      handle.stderr = (handle.stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
    })
    child.on('message', (message) => this.#onMessage(handle, message))
    child.on('error', (error) => {
      this.#onDeath(handle, `worker process error: ${error instanceof Error ? error.message : String(error)}`)
    })
    child.on('exit', (code, signal) => {
      this.#onDeath(handle, `worker process exited (code=${code}, signal=${signal})`)
    })

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#kill(handle, 'worker start timeout')
          reject(new AnyDocFailure('WORKER_START_FAILED', `the AnyDoc worker did not become ready within ${this.spawnTimeoutMs}ms${handle.stderr === '' ? '' : `: ${handle.stderr.trim()}`}`))
        }, this.spawnTimeoutMs)
        handle.onReady = (info) => {
          clearTimeout(timer)
          resolve(info)
        }
        handle.onFatal = (payload) => {
          clearTimeout(timer)
          this.#kill(handle, 'worker reported a fatal load error')
          const detail = payload.errorMessage ?? 'the AnyDoc binding failed to load'
          // A binding that cannot load in the worker needs the same platform
          // advice the in-process path gives.
          const message = payload.errorCode === 'NATIVE_UNAVAILABLE' ? `${detail} — ${nativeLoadHint()}` : detail
          reject(new AnyDocFailure(payload.errorCode ?? 'NATIVE_UNAVAILABLE', message))
        }
      })
    } finally {
      handle.onReady = null
      handle.onFatal = null
    }
    return handle
  }

  /**
   * @param {object} handle
   * @param {any} message
   */
  #onMessage(handle, message) {
    if (message === null || typeof message !== 'object') return
    if (message.type === 'ready') {
      handle.readyInfo = { anydocVersion: message.anydocVersion ?? 'unknown' }
      handle.onReady?.(handle.readyInfo)
      return
    }
    if (message.type === 'fatal') {
      handle.onFatal?.(message)
      return
    }
    if (message.type !== 'result') return
    const pending = handle.pending
    if (pending === null || pending.id !== message.id) return
    if (message.ok === true) pending.resolve(message)
    else pending.reject(failureFromPayload(message))
  }

  /**
   * @param {object} handle
   * @param {string} reason
   */
  #onDeath(handle, reason) {
    if (handle.dead) return
    handle.dead = true
    this.live.delete(handle)
    const index = this.idle.indexOf(handle)
    if (index >= 0) this.idle.splice(index, 1)
    handle.onFatal?.({ errorCode: 'WORKER_START_FAILED', errorMessage: reason })
    const pending = handle.pending
    if (pending !== null) {
      handle.pending = null
      const detail = handle.stderr.trim()
      const code = reason.includes('exited') ? 'ENGINE_CRASHED' : 'ENGINE_FAILED'
      pending.reject(new AnyDocFailure(code, `${reason}${detail === '' ? '' : `: ${detail}`}`))
    }
  }

  /**
   * @param {object} handle
   * @param {string} reason
   */
  #kill(handle, reason) {
    if (!handle.dead) {
      handle.dead = true
      this.live.delete(handle)
      const index = this.idle.indexOf(handle)
      if (index >= 0) this.idle.splice(index, 1)
    }
    try {
      handle.child.kill('SIGKILL')
    } catch {
      // The process is already gone; nothing to clean up.
    }
  }

  /**
   * @param {object} handle
   * @param {{ file: string, wantAssets: boolean, maxAssetBytes: number }} request
   * @param {{ signal?: AbortSignal, timeoutMs: number }} options
   * @returns {Promise<object>}
   */
  #dispatch(handle, request, { signal, timeoutMs }) {
    return new Promise((resolve, reject) => {
      if (handle.dead) {
        reject(new AnyDocFailure('ENGINE_FAILED', 'the conversion worker is no longer running'))
        return
      }
      // An abort that arrived while the worker was starting produced no event
      // for a later listener, so it is checked here as well.
      if (signal?.aborted === true) {
        reject(new AnyDocFailure('CANCELLED', 'the tool call was cancelled'))
        return
      }
      handle.nextId += 1
      const id = handle.nextId
      let settled = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (handle.pending?.id === id) handle.pending = null
        fn(value)
      }
      const onAbort = () => {
        this.#kill(handle, 'call cancelled')
        settle(reject, new AnyDocFailure('CANCELLED', 'the tool call was cancelled; the worker process was terminated'))
      }
      const timer = setTimeout(() => {
        this.#kill(handle, `conversion exceeded timeoutMs=${timeoutMs}`)
        settle(reject, new AnyDocFailure('TIMEOUT', `conversion exceeded timeoutMs=${timeoutMs}; the worker process was terminated, so the conversion actually stopped`))
      }, timeoutMs)

      handle.busy = true
      handle.pending = {
        id,
        resolve: (payload) => settle(resolve, payload),
        reject: (error) => settle(reject, error),
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        handle.child.send({ type: 'convert', id, ...request })
      } catch (error) {
        settle(reject, new AnyDocFailure('ENGINE_FAILED', `cannot reach the conversion worker: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
  }
}

/** The plugin's conversion engine. */
export class Engine {
  /**
   * @param {{ config: object, logger: { warn: (message: string) => void } }} options
   */
  constructor({ config, logger }) {
    this.config = config
    this.logger = logger
    this.requestedMode = config.engine
    this.activeMode = config.engine === 'inprocess' ? 'inprocess' : 'worker'
    this.module = undefined
    this.pool = this.activeMode === 'worker'
      ? new WorkerPool({ size: config.workerPoolSize, logger, spawnTimeoutMs: config.workerStartTimeoutMs })
      : null
    this.fallbackReason = ''
    this.disposed = false
  }

  /**
   * @returns {Promise<Record<string, unknown>>} the binding loaded in-process.
   */
  async #loadModule() {
    if (this.module === undefined) {
      try {
        this.module = await import('@firecrawl/anydoc')
      } catch (error) {
        throw new AnyDocFailure('NATIVE_UNAVAILABLE', `cannot load @firecrawl/anydoc on ${process.platform}/${process.arch}: ${error instanceof Error ? error.message : String(error)} — ${nativeLoadHint()}`)
      }
    }
    return this.module
  }

  /**
   * Report engine health without touching any user document.
   * @returns {Promise<{ mode: string, requestedMode: string, nativeOk: boolean, anydocVersion: string, error: string }>}
   */
  async probe() {
    if (this.disposed) {
      return { mode: this.activeMode, requestedMode: this.requestedMode, nativeOk: false, anydocVersion: 'unknown', error: 'engine disposed' }
    }
    try {
      if (this.activeMode === 'worker' && this.pool !== null) {
        try {
          const { anydocVersion } = await this.pool.probe()
          return { mode: 'worker', requestedMode: this.requestedMode, nativeOk: true, anydocVersion, error: '' }
        } catch (error) {
          this.#switchToInProcess(error)
        }
      }
      await this.#loadModule()
      return {
        mode: 'inprocess',
        requestedMode: this.requestedMode,
        nativeOk: true,
        anydocVersion: this.#moduleVersion(),
        error: this.fallbackReason,
      }
    } catch (error) {
      return {
        mode: this.activeMode,
        requestedMode: this.requestedMode,
        nativeOk: false,
        anydocVersion: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** @returns {string} */
  #moduleVersion() {
    try {
      return require('@firecrawl/anydoc/package.json').version ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * Record why worker mode is unavailable and stop using it.
   * @param {unknown} error
   */
  #switchToInProcess(error) {
    if (this.activeMode === 'inprocess') return
    this.activeMode = 'inprocess'
    this.fallbackReason = `${error instanceof Error ? error.message : String(error)}; fell back to in-process conversion`
    this.logger.warn(`dsh-anydoc: ${this.fallbackReason}`)
  }

  /**
   * Convert one document. A worker that cannot start falls back to in-process
   * once; a crash or timeout during a conversion is reported, never retried.
   * @param {{ file: string, wantAssets: boolean, maxAssetBytes: number }} request
   * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
   * @returns {Promise<object>}
   */
  async convert(request, { signal, timeoutMs = this.config.timeoutMs } = {}) {
    if (this.disposed) throw new AnyDocFailure('ENGINE_DISPOSED', 'the AnyDoc conversion engine is disposed')
    if (this.activeMode === 'worker' && this.pool !== null) {
      try {
        return await this.pool.run(request, { signal, timeoutMs })
      } catch (error) {
        if (error instanceof AnyDocFailure && error.code === 'WORKER_START_FAILED') {
          this.#switchToInProcess(error)
        } else {
          throw error
        }
      }
    }
    return await this.#convertInProcess(request, { signal, timeoutMs })
  }

  /**
   * @param {{ file: string, wantAssets: boolean, maxAssetBytes: number }} request
   * @param {{ signal?: AbortSignal, timeoutMs: number }} options
   * @returns {Promise<object>}
   */
  async #convertInProcess(request, { signal, timeoutMs }) {
    const anydoc = await this.#loadModule()
    if (signal?.aborted === true) throw new AnyDocFailure('CANCELLED', 'the tool call was cancelled')
    const bytes = await readFile(request.file)
    if (signal?.aborted === true) throw new AnyDocFailure('CANCELLED', 'the tool call was cancelled')
    const work = convertWithAnyDoc(anydoc, { ...request, bytes })

    let timer
    let onAbort
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new AnyDocFailure(
            'TIMEOUT_NOT_CANCELLED',
            `conversion exceeded timeoutMs=${timeoutMs}. In-process mode cannot interrupt the native call, so it may still be running.`,
          ),
        )
      }, timeoutMs)
    })
    const aborted = new Promise((_resolve, reject) => {
      onAbort = () => reject(new AnyDocFailure('CANCELLED', 'the tool call was cancelled'))
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([work, timeout, aborted])
    } finally {
      clearTimeout(timer)
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
      // Never leave an unhandled rejection behind a race that already settled.
      work.catch(() => {})
      aborted.catch(() => {})
    }
  }

  /** Stop every worker process. */
  dispose() {
    this.disposed = true
    this.pool?.dispose()
    this.pool = null
  }
}

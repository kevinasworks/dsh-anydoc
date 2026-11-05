/**
 * Preload that makes any network call fail loudly.
 *
 * Loaded through `NODE_OPTIONS=--import` in the privacy test, so it applies to
 * the conversion worker process as well as the test process.
 */

globalThis.fetch = () => {
  throw new Error('NETWORK_BLOCKED_BY_TEST: dsh-anydoc must convert locally')
}

if (typeof globalThis.WebSocket === 'function') {
  globalThis.WebSocket = class BlockedWebSocket {
    constructor() {
      throw new Error('NETWORK_BLOCKED_BY_TEST: dsh-anydoc must convert locally')
    }
  }
}

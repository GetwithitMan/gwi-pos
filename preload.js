/**
 * Preload script for Node 20 + Next.js 16 compatibility.
 *
 * Next.js 16 checks globalThis.AsyncLocalStorage during module
 * evaluation. Node 20 only exposes it via require('async_hooks').
 * This preload runs via `node -r ./preload.js server.js` so it
 * executes BEFORE any server.js modules are evaluated.
 */
const { AsyncLocalStorage } = require('node:async_hooks')
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage
}

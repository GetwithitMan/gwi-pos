/**
 * Preload script for Node.js + Next.js 16 compatibility.
 *
 * Next.js 16 checks globalThis.AsyncLocalStorage during module
 * evaluation. Node < 22 only exposes it via require('async_hooks').
 * NUC production servers run Node 20 where this polyfill is required.
 * This preload runs via `node -r ./preload.js server.js` so it
 * executes BEFORE any server.js modules are evaluated.
 */
const { AsyncLocalStorage } = require('node:async_hooks')
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage
}

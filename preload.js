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

/**
 * Load .env from both /opt/gwi-pos/.env (master) and the app-local copy.
 * dotenv won't override existing process.env values, so systemd
 * EnvironmentFile still takes precedence when it works.
 */
try {
  require('dotenv').config({ path: '/opt/gwi-pos/.env' })
  require('dotenv').config() // also loads $CWD/.env as fallback
} catch (_) {
  // dotenv not available — rely on systemd EnvironmentFile
}

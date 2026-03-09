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
 * Load .env vars from /opt/gwi-pos/.env into process.env.
 * Uses plain fs (no dotenv dependency) for maximum compatibility.
 * Does not override existing values (systemd EnvironmentFile wins).
 */
try {
  const fs = require('node:fs')
  const path = require('node:path')
  const envPaths = ['/opt/gwi-pos/.env', path.resolve('.env'), path.resolve('.env.local')]
  for (const envPath of envPaths) {
    try {
      const content = fs.readFileSync(envPath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx < 1) continue
        const key = trimmed.slice(0, eqIdx)
        const val = trimmed.slice(eqIdx + 1)
        if (!(key in process.env)) {
          process.env[key] = val
        }
      }
    } catch (_) { /* file doesn't exist */ }
  }
} catch (_) { /* fs not available */ }

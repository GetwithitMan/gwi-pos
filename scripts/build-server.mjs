/**
 * Compile server.ts → server.js for production.
 *
 * In development we use `tsx server.ts` directly, but in production
 * tsx's CJS loader conflicts with Next.js's AsyncLocalStorage setup.
 * esbuild bundles server.ts + its local imports into a single CJS file
 * that runs with plain `node server.js`.
 *
 * CRITICAL: Next.js 16 checks globalThis.AsyncLocalStorage before its own
 * bootstrap sets it up. On Node 20, AsyncLocalStorage is only available via
 * async_hooks, not on globalThis. The banner injects the polyfill BEFORE
 * any require('next') calls that esbuild hoists to the top of the file.
 */
import { build } from 'esbuild'

const asyncLocalStorageBanner = `
// Polyfill: Next.js 16 expects globalThis.AsyncLocalStorage but Node 20
// only exposes it via require('async_hooks'). Must run before require('next').
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
}
`

await build({
  entryPoints: ['server.ts'],
  outfile: 'server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Don't bundle node_modules — they're installed on disk
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: asyncLocalStorageBanner,
  },
})

console.log('✓ server.js compiled for production')

/**
 * Compile ws-server.ts -> ws-server.js for production.
 *
 * Same approach as build-server.mjs: esbuild bundles the standalone
 * WebSocket server + its local imports into a single CJS file that
 * runs with plain `node ws-server.js`.
 *
 * The AsyncLocalStorage banner is included for compatibility with any
 * Next.js modules that may be transitively imported via socket-server.ts.
 */
import { build } from 'esbuild'

const asyncLocalStorageBanner = `
// Polyfill: Next.js 16 expects globalThis.AsyncLocalStorage but Node 20
// only exposes it via require('async_hooks'). Must run before any imports.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
}
`

await build({
  entryPoints: ['ws-server.ts'],
  outfile: 'ws-server.js',
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

console.log('✓ ws-server.js compiled for production')

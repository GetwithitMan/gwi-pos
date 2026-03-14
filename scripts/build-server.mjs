/**
 * Compile server.ts → server.js for production.
 *
 * In development we use `tsx server.ts` directly, but in production
 * tsx's CJS loader conflicts with Next.js's AsyncLocalStorage setup.
 * esbuild bundles server.ts + its local imports into a single CJS file
 * that runs with plain `node server.js`.
 *
 * CRITICAL: Next.js 16 checks globalThis.AsyncLocalStorage before its own
 * bootstrap sets it up. On Node < 22, AsyncLocalStorage is only available via
 * async_hooks, not on globalThis. NUC servers run Node 20 where this is needed.
 * The banner injects the polyfill BEFORE any require('next') calls that esbuild
 * hoists to the top of the file.
 *
 * PRISMA 7: The generated client is TypeScript-only (no .js files). We must
 * resolve @prisma/client imports at BUILD time, not runtime. The plugin below
 * redirects @prisma/client to the generated .ts source, and @prisma/client/*
 * subpaths to the @prisma/client npm package (which has compiled JS runtime).
 */
import { build } from 'esbuild'
import path from 'path'

const asyncLocalStorageBanner = `
// Polyfill: Next.js 16 expects globalThis.AsyncLocalStorage but Node < 22
// only exposes it via require('async_hooks'). NUC servers run Node 20.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
}
// Prisma 7 generated client uses import.meta.url for __dirname in ESM.
// In CJS mode, import.meta is empty, so we polyfill it to prevent crash.
if (typeof globalThis.__dirname === 'undefined') {
  globalThis.__dirname = __dirname;
}
`

// Plugin: Redirect bare @prisma/client to generated TS source,
// but keep @prisma/client/* subpaths (runtime, adapter) as external.
const prismaResolverPlugin = {
  name: 'prisma-client-resolver',
  setup(build) {
    // Bare @prisma/client → generated TypeScript client (bundled)
    build.onResolve({ filter: /^@prisma\/client$/ }, () => ({
      path: path.resolve('src/generated/prisma/client.ts'),
    }))
    // @prisma/client/* subpaths → keep external (runtime JS exists in node_modules)
    build.onResolve({ filter: /^@prisma\/client\// }, (args) => ({
      path: args.path,
      external: true,
    }))
    // @prisma/adapter-pg → keep external
    build.onResolve({ filter: /^@prisma\/adapter-pg/ }, (args) => ({
      path: args.path,
      external: true,
    }))
  },
}

await build({
  entryPoints: ['server.ts'],
  outfile: 'server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Don't bundle node_modules — they're installed on disk
  packages: 'external',
  plugins: [prismaResolverPlugin],
  // Prisma 7 generated client uses import.meta.url for __dirname detection.
  // In CJS format import.meta is empty, causing fileURLToPath(undefined) crash.
  // Replace with a file:// URL pointing to server.js itself.
  define: {
    'import.meta.url': JSON.stringify('file://' + path.resolve('server.js')),
  },
  sourcemap: false,
  logLevel: 'warning',
  banner: {
    js: asyncLocalStorageBanner,
  },
})

console.log('✓ server.js compiled for production')

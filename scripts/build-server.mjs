/**
 * Compile server.ts → server.js for production.
 *
 * In development we use `tsx server.ts` directly, but in production
 * tsx's CJS loader conflicts with Next.js's AsyncLocalStorage setup.
 * esbuild bundles server.ts + its local imports into a single CJS file
 * that runs with plain `node server.js`.
 */
import { build } from 'esbuild'

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
})

console.log('✓ server.js compiled for production')

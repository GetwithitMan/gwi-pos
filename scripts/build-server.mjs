/**
 * Compile server.ts → server.js for production.
 *
 * Outputs CJS (required because Next.js 16 does not have proper ESM
 * exports maps — e.g., `next/headers` fails in strict ESM resolution).
 *
 * preload.js (loaded via `node -r ./preload.js server.js`) handles:
 *   1. AsyncLocalStorage polyfill (Node < 22)
 *   2. .env loading (production NUCs)
 *
 * Prisma 7 compatibility:
 *   The generated client uses `import.meta.url` for __dirname detection.
 *   In CJS, import.meta is empty → crash. We use esbuild `define` to
 *   replace it with a `file://` URL derived from __filename (which CJS
 *   provides natively). This is safe because:
 *   - __filename is accurate in CJS (points to the bundled server.js)
 *   - Only Prisma's generated client reads import.meta.url
 *   - The define is applied at BUILD time, not globally at runtime
 */
import { build } from 'esbuild'
import { existsSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

// Verify generated Prisma client exists before building
const prismaClientPath = path.resolve('src/generated/prisma/client.ts')
if (!existsSync(prismaClientPath)) {
  console.error('✘ Prisma client not found at', prismaClientPath)
  console.error('  Run "npx prisma generate" first.')
  process.exit(1)
}

try {
  await build({
    entryPoints: ['server.ts'],
    outfile: 'server.js',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Don't bundle node_modules — they're installed on disk.
    // Local source (including src/generated/prisma/) IS bundled.
    packages: 'external',
    // Prisma 7: replace import.meta.url with a file:// URL pointing to
    // server.js. In CJS, __filename exists natively but import.meta is
    // empty. Prisma only uses import.meta.url for path.dirname() to find
    // sibling files — pointing to server.js is correct since the generated
    // client is bundled into it.
    define: {
      'import.meta.url': JSON.stringify(pathToFileURL(path.resolve('server.js')).href),
    },
    sourcemap: false,
    logLevel: 'warning',
    banner: {
      js: `
// Node < 22: AsyncLocalStorage is not on globalThis.
// Next.js 16 checks for it during module evaluation.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
}
`,
    },
  })

  console.log('✓ server.js compiled for production')
} catch (err) {
  console.error('✘ Build failed:', err.message)
  process.exit(1)
}

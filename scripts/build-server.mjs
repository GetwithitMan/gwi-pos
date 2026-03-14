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
 *   replace it with a runtime-computed `file://` URL derived from
 *   __filename (which CJS provides natively). This works in the current
 *   setup because:
 *   - __filename is accurate in CJS (points to the bundled server.js)
 *   - In the current codebase, only Prisma's generated client uses
 *     import.meta.url (verified by grep)
 *   - The define maps to a banner variable computed at RUNTIME from
 *     __filename, so it works regardless of deploy path
 */
import { build } from 'esbuild'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Preflight checks — verify ALL required files
// ---------------------------------------------------------------------------
const prismaClientPath = path.resolve('src/generated/prisma/client.ts')

const requiredFiles = [
  { path: 'src/generated/prisma/client.ts', hint: 'Run "npx prisma generate"' },
  { path: 'server.ts', hint: 'Server entrypoint missing' },
  { path: 'preload.js', hint: 'Required for production: node -r ./preload.js server.js' },
]
for (const { path: filePath, hint } of requiredFiles) {
  if (!existsSync(path.resolve(filePath))) {
    console.error(`✘ Required file not found: ${filePath}`)
    console.error(`  ${hint}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Prisma version consistency check
// ---------------------------------------------------------------------------
try {
  const clientContent = readFileSync(prismaClientPath, 'utf8')
  const versionMatch = clientContent.match(/Prisma Client \((\d+\.\d+\.\d+)\)/) ||
                       clientContent.match(/"prisma":\s*"(\d+\.\d+\.\d+)"/)
  if (versionMatch) {
    const generatedVersion = versionMatch[1]
    const pkgJson = JSON.parse(readFileSync('package.json', 'utf8'))
    const installedVersion = pkgJson.dependencies?.['@prisma/client'] || pkgJson.devDependencies?.['@prisma/client']
    if (installedVersion && !installedVersion.includes(generatedVersion)) {
      console.warn(`⚠ Prisma version mismatch: generated ${generatedVersion}, installed ${installedVersion}`)
      console.warn('  Run "npx prisma generate" to regenerate.')
    }
  }
} catch { /* non-fatal */ }

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
    // Prisma 7: replace import.meta.url with __importMetaUrl, a variable
    // set in the banner at RUNTIME from CJS's __filename. This avoids
    // baking a build-time absolute path into the bundle.
    define: {
      'import.meta.url': '__importMetaUrl',
    },
    sourcemap: false,
    logLevel: 'warning',
    banner: {
      js: `
// Defense-in-depth: preload.js also sets this, but the banner ensures
// it's available even if server.js is started without -r ./preload.js
// (e.g., direct node server.js during development or debugging).
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
}
// Prisma 7 CJS shim: import.meta.url → file:// URL of __filename
// Computed at RUNTIME (not build time) so it works regardless of deploy path
var __importMetaUrl = require('url').pathToFileURL(__filename).href;
`,
    },
  })

  // ---------------------------------------------------------------------------
  // Post-build audit — check import.meta.url replacement count
  // ---------------------------------------------------------------------------
  const bundleContent = readFileSync('server.js', 'utf8')
  const metaUrlCount = (bundleContent.match(/__importMetaUrl/g) || []).length
  console.log('✓ server.js compiled for production')
  console.log(`  import.meta.url replacements: ${metaUrlCount}`)
  if (metaUrlCount > 5) {
    console.warn(`  ⚠ ${metaUrlCount} import.meta.url replacements — verify only Prisma uses them`)
  }
} catch (err) {
  console.error('✘ Build failed:', err.message)
  if (err.errors) {
    for (const e of err.errors) {
      console.error(`  ${e.location?.file || ''}:${e.location?.line || ''} — ${e.text}`)
    }
  }
  if (err.stack) {
    console.error(err.stack)
  }
  process.exit(1)
}

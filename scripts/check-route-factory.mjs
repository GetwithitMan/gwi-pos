#!/usr/bin/env node
/**
 * CI Guard: Verify every API route uses the unified route factory.
 *
 * RULE: Every route.ts export must use one of:
 *   apiRoute(...)      — authenticated + tenant-scoped
 *   publicRoute(...)   — intentionally public + tenant-scoped
 *   internalRoute(...) — requires API key
 *   cronRoute(...)     — requires cron secret
 *
 * Legacy patterns that are still accepted during migration:
 *   withVenue(withAuth(...))   — equivalent to apiRoute, will be migrated
 *   withVenue(...)             — equivalent to publicRoute, will be migrated
 *
 * What this script CATCHES:
 *   - Bare `export async function GET(...)` with no wrapper at all
 *   - Routes that import nothing from api-route or with-venue/api-auth-middleware
 *   - Routes that define handlers without any auth/venue wrapping
 *
 * Usage:
 *   node scripts/check-route-factory.mjs          # exits 1 if violations found
 *   node scripts/check-route-factory.mjs --warn   # prints warnings, exits 0
 *   node scripts/check-route-factory.mjs --strict # only accepts new factory pattern
 *
 * The --strict flag rejects withVenue/withAuth and only accepts apiRoute/publicRoute/
 * internalRoute/cronRoute. Use this once migration is complete.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const apiDir = join(projectRoot, 'src', 'app', 'api')
const warnOnly = process.argv.includes('--warn')
const strict = process.argv.includes('--strict')

// ─── Known factory patterns ────────────────────────────────────────────

// New factory patterns (preferred)
const FACTORY_PATTERNS = [
  /\b(apiRoute|publicRoute|internalRoute|cronRoute)\s*\(/,
]

// Legacy patterns (accepted during migration, rejected in --strict mode)
const LEGACY_PATTERNS = [
  /\bwithVenue\s*\(/,
  /\bwithAuth\s*\(/,
]

// Routes that are exempt from the check (e.g., Next.js middleware, special auth routes)
const EXEMPT_PATHS = [
  // Auth routes that handle login — they ARE the auth entry point
  'auth/login',
  'auth/pin',
  'auth/verify-pin',
  'auth/session',
  'auth/logout',
  'auth/cloud-login',
  // Webhook receivers — auth is handled by webhook signature verification
  'webhooks/',
  // Next.js special routes
  'opengraph-image',
]

// HTTP methods that indicate route handler exports
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const BARE_EXPORT_PATTERN = new RegExp(
  `^\\s*export\\s+(async\\s+)?function\\s+(${HTTP_METHODS.join('|')})\\s*\\(`, 'm'
)
const EXPORT_CONST_PATTERN = new RegExp(
  `^\\s*export\\s+const\\s+(${HTTP_METHODS.join('|')})\\s*=`, 'm'
)

// ─── Walk directory ─────────────────────────────────────────────────────

function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkDir(full, files)
    } else if (entry === 'route.ts' || entry === 'route.js') {
      files.push(full)
    }
  }
  return files
}

function isExempt(filePath) {
  const rel = relative(apiDir, filePath).replace(/\\/g, '/')
  return EXEMPT_PATHS.some(exempt => rel.includes(exempt))
}

// ─── Analysis ───────────────────────────────────────────────────────────

const violations = []
const legacyWarnings = []
let totalRoutes = 0
let factoryRoutes = 0
let legacyRoutes = 0

for (const file of walkDir(apiDir)) {
  if (isExempt(file)) continue
  totalRoutes++

  const content = readFileSync(file, 'utf-8')
  const relPath = relative(projectRoot, file)

  // Check if file has any route exports
  const hasBareExport = BARE_EXPORT_PATTERN.test(content)
  const hasConstExport = EXPORT_CONST_PATTERN.test(content)

  if (!hasBareExport && !hasConstExport) {
    // No route exports found — skip (might be a re-export or types file)
    continue
  }

  // Check for new factory pattern
  const hasFactory = FACTORY_PATTERNS.some(p => p.test(content))

  // Check for legacy pattern
  const hasLegacy = LEGACY_PATTERNS.some(p => p.test(content))

  if (hasFactory) {
    factoryRoutes++
    // In strict mode, also flag if legacy patterns are mixed in
    if (strict && hasLegacy) {
      legacyWarnings.push({
        file: relPath,
        reason: 'Mixed factory + legacy patterns (remove withVenue/withAuth imports)',
      })
    }
    continue
  }

  if (hasLegacy) {
    legacyRoutes++
    if (strict) {
      violations.push({
        file: relPath,
        reason: 'Uses legacy withVenue/withAuth pattern — migrate to apiRoute/publicRoute/internalRoute/cronRoute',
      })
    } else {
      legacyWarnings.push({
        file: relPath,
        reason: 'Uses legacy withVenue/withAuth — should migrate to factory pattern',
      })
    }
    continue
  }

  // VIOLATION: bare export with no wrapper at all
  if (hasBareExport) {
    violations.push({
      file: relPath,
      reason: 'Bare `export function` with no auth/venue wrapper — use apiRoute(), publicRoute(), internalRoute(), or cronRoute()',
    })
  } else {
    // Has const export but no recognized wrapper
    // Check if it's using some other unknown wrapper
    violations.push({
      file: relPath,
      reason: 'Route export not wrapped with a recognized factory — use apiRoute(), publicRoute(), internalRoute(), or cronRoute()',
    })
  }
}

// ─── Output ─────────────────────────────────────────────────────────────

console.log(`\nRoute Factory Audit`)
console.log(`${'='.repeat(50)}`)
console.log(`  Total route files:     ${totalRoutes}`)
console.log(`  Using factory:         ${factoryRoutes}`)
console.log(`  Using legacy pattern:  ${legacyRoutes}`)
console.log(`  Violations:            ${violations.length}`)
console.log()

if (legacyWarnings.length > 0 && !strict) {
  console.log(`Legacy routes (migrate when touching these files):`)
  for (const w of legacyWarnings) {
    console.log(`  ${w.file}`)
    console.log(`    ${w.reason}`)
  }
  console.log()
}

if (violations.length === 0) {
  console.log('Route factory check passed.')
  if (legacyWarnings.length > 0) {
    console.log(`(${legacyWarnings.length} legacy routes remain — migrate incrementally)`)
  }
  process.exit(0)
}

console.error(`Route factory violations found (${violations.length}):\n`)
for (const v of violations) {
  console.error(`  ${v.file}`)
  console.error(`    ${v.reason}\n`)
}

console.error('Fix: import { apiRoute } from "@/lib/api-route" and wrap your handler.')
console.error('See src/lib/api-route.ts for usage examples.\n')

if (warnOnly) {
  process.exit(0)
} else {
  process.exit(1)
}

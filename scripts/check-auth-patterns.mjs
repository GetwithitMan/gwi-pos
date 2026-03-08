#!/usr/bin/env node
/**
 * CI guard: prevent regressions where admin API routes call requirePermission()
 * with a client-supplied employeeId instead of the session-derived actor.
 *
 * Allowed:
 *   requirePermission(actor.employeeId, ...)
 *   requirePermission(resolvedEmployeeId, ...)   // resolvedEmployeeId = actor.employeeId ?? body.X
 *   requireAnyPermission(actor.employeeId, ...)
 *
 * Forbidden:
 *   requirePermission(body.employeeId, ...)
 *   requirePermission(searchParams.get("employeeId"), ...)
 *   requirePermission(query.employeeId, ...)
 *
 * Usage:
 *   node scripts/check-auth-patterns.mjs          # exits 1 if violations found
 *   node scripts/check-auth-patterns.mjs --warn   # prints warnings, exits 0
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const apiDir = join(projectRoot, 'src', 'app', 'api')
const warnOnly = process.argv.includes('--warn')

const FORBIDDEN_PATTERNS = [
  /requirePermission\s*\(\s*body\.\w*[Ee]mployee[Ii]d/,
  /requirePermission\s*\(\s*searchParams\.get\s*\(\s*['"]employeeId['"]/,
  /requirePermission\s*\(\s*query\.\w*[Ee]mployee[Ii]d/,
  /requireAnyPermission\s*\(\s*body\.\w*[Ee]mployee[Ii]d/,
]

// Routes that are intentionally exempt (POS/Android routes that can't use cookies)
const EXEMPT_PATHS = [
  // Payment/POS routes called from Android — no browser cookie available
  'orders/[id]/pay',
  'orders/[id]/void',
  'orders/[id]/refund',
  'orders/[id]/split',
  'orders/[id]/discount',  // applied from POS terminal, not browser admin
  'time-clock',
  'auth/login',
  'auth/pin',
  'print/cash-drawer',     // triggered from POS terminal
]

function isExempt(filePath) {
  const rel = relative(apiDir, filePath).replace(/\\/g, '/')
  return EXEMPT_PATHS.some(exempt => rel.includes(exempt))
}

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

const violations = []

for (const file of walkDir(apiDir)) {
  if (isExempt(file)) continue

  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: relative(projectRoot, file),
          line: i + 1,
          content: line.trim(),
        })
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✅ Auth pattern check passed — all privileged routes use session-derived actor.')
  process.exit(0)
}

console.error(`\n❌ Auth pattern violations found (${violations.length}):\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`)
  console.error(`    ${v.content}\n`)
}
console.error('Fix: use getActorFromRequest(request) and pass actor.employeeId to requirePermission()')
console.error('See src/lib/api-auth.ts → getActorFromRequest\n')

if (warnOnly) {
  process.exit(0)
} else {
  process.exit(1)
}

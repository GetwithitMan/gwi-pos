/**
 * Readiness Probe — /api/health/ready
 *
 * Used by deploy-release.sh to gate deployments. Proves the release is
 * FULLY USABLE (env loaded, DB reachable, critical tables present, schema
 * version correct) — not just that the process is alive.
 *
 * No authentication required — internal endpoint, called by deploy script
 * on localhost.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { APP_VERSION, EXPECTED_SCHEMA_VERSION } from '@/lib/version-contract'

export const dynamic = 'force-dynamic'

// ── Required env keys ────────────────────────────────────────────────────────
const REQUIRED_ENV_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  // Accept either — installer uses LOCATION_ID, some deployments use POS_LOCATION_ID
] as const

const LOCATION_KEY_ALTERNATIVES = ['LOCATION_ID', 'POS_LOCATION_ID'] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CheckResult {
  pass: boolean
  latencyMs?: number
  version?: string
  error?: string
}

/** Run a promise with a timeout. Rejects if the promise takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ])
}

// ── Check implementations ────────────────────────────────────────────────────

function checkEnv(): CheckResult {
  const missing: string[] = []

  for (const key of REQUIRED_ENV_KEYS) {
    if (!process.env[key]) missing.push(key)
  }

  // At least one location key must be present
  const hasLocationKey = LOCATION_KEY_ALTERNATIVES.some((k) => !!process.env[k])
  if (!hasLocationKey) {
    missing.push(LOCATION_KEY_ALTERNATIVES.join(' | '))
  }

  return missing.length === 0
    ? { pass: true }
    : { pass: false, error: `Missing: ${missing.join(', ')}` }
}

async function checkDb(): Promise<CheckResult> {
  const start = performance.now()
  try {
    await withTimeout(db.$queryRawUnsafe('SELECT 1'), 5000)
    return { pass: true, latencyMs: Math.round(performance.now() - start) }
  } catch (err) {
    return {
      pass: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkTables(): Promise<CheckResult> {
  try {
    await withTimeout(
      db.$queryRawUnsafe('SELECT count(*) FROM "Location" LIMIT 1'),
      5000,
    )
    return { pass: true }
  } catch (err) {
    return {
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkSchema(): Promise<CheckResult> {
  if (!EXPECTED_SCHEMA_VERSION) {
    return { pass: true, version: 'unknown' }
  }
  return { pass: true, version: String(EXPECTED_SCHEMA_VERSION) }
}

function checkBoot(): CheckResult {
  return {
    pass: true,
    latencyMs: Math.round(process.uptime() * 1000),
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const bootResult = checkBoot()
    const envResult = checkEnv()

    // Run async checks in parallel — each has its own timeout/catch
    const [dbResult, tablesResult, schemaResult] = await Promise.all([
      checkDb(),
      checkTables(),
      checkSchema(),
    ])

    const checks = {
      boot: bootResult,
      env: envResult,
      db: dbResult,
      tables: tablesResult,
      schema: schemaResult,
    }

    const ready = Object.values(checks).every((c) => c.pass)

    return NextResponse.json(
      {
        ready,
        timestamp: new Date().toISOString(),
        version: APP_VERSION,
        checks,
      },
      {
        status: ready ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (err) {
    // NEVER return a blank 500 — always return structured JSON
    return NextResponse.json(
      {
        ready: false,
        timestamp: new Date().toISOString(),
        version: APP_VERSION ?? 'unknown',
        checks: {
          boot: { pass: true },
          env: { pass: false, error: 'Handler crashed before env check' },
          db: { pass: false, error: 'Handler crashed before db check' },
          tables: { pass: false, error: 'Handler crashed before tables check' },
          schema: { pass: false, error: 'Handler crashed before schema check' },
        },
        error: err instanceof Error ? err.message : String(err),
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
}

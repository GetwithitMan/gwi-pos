/**
 * Update Health Check API
 *
 * Returns the current update agent status including version,
 * lock state, and preflight check results.
 *
 * GET /api/health/update
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUpdateAgentStatus, runPreflightChecks } from '@/lib/update-agent'
import { verifySchema } from '@/lib/schema-verify'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth gate: this endpoint reveals version, disk space, PG status, and schema details.
  // On NUC (POS_LOCATION_ID set), allow localhost access for heartbeat.sh.
  // On cloud or if INTERNAL_API_SECRET is set, require Bearer token.
  const secret = process.env.INTERNAL_API_SECRET
  if (secret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  const status = getUpdateAgentStatus()
  const [preflight, schema] = await Promise.all([
    runPreflightChecks(),
    verifySchema(),
  ])

  return NextResponse.json({
    version: status.currentVersion,
    isUpdating: status.isUpdating,
    lockFileExists: status.lockFileExists,
    preflight: {
      passed: preflight.passed,
      checks: preflight.checks,
    },
    schema: {
      passed: schema.passed,
      missing: schema.missing,
      checked: schema.checked,
    },
  })
}

/**
 * Update Health Check API
 *
 * Returns the current update agent status including version,
 * lock state, and preflight check results.
 *
 * GET /api/health/update
 */

import { NextResponse } from 'next/server'
import { getUpdateAgentStatus, runPreflightChecks } from '@/lib/update-agent'
import { verifySchema } from '@/lib/schema-verify'

export const dynamic = 'force-dynamic'

export async function GET() {
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

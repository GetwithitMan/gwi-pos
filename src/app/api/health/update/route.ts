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

export const dynamic = 'force-dynamic'

export async function GET() {
  const status = getUpdateAgentStatus()
  const preflight = await runPreflightChecks()

  return NextResponse.json({
    version: status.currentVersion,
    isUpdating: status.isUpdating,
    lockFileExists: status.lockFileExists,
    preflight: {
      passed: preflight.passed,
      checks: preflight.checks,
    },
  })
}

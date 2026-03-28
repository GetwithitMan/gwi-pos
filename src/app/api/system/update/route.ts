/**
 * System Update Trigger API
 *
 * Called by the sync-agent or heartbeat.sh to initiate a version-targeted update.
 * Runs preflight checks before proceeding. Returns immediately — update runs in background.
 *
 * POST /api/system/update
 * Body: { targetVersion: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeUpdate, getUpdateAgentStatus, reportDeployHealth } from '@/lib/update-agent'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('system-update')

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // REQUIRED: verify internal secret — this endpoint triggers git reset + deploy
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    console.error('[UpdateAPI] INTERNAL_API_SECRET not set — rejecting update request for safety')
    return err('INTERNAL_API_SECRET not configured')
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return err('Unauthorized')
  }

  let body: { targetVersion?: string }
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON body')
  }

  const { targetVersion } = body

  if (!targetVersion || typeof targetVersion !== 'string') {
    return err('targetVersion required')
  }

  // Check if already updating
  const status = getUpdateAgentStatus()
  if (status.isUpdating) {
    return NextResponse.json({
      success: false,
      error: 'Update already in progress',
      currentVersion: status.currentVersion,
    }, { status: 409 })
  }

  // Fire-and-forget: start update in background, return immediately
  void executeUpdate(targetVersion).then(async (result) => {
    if (result.success) {
      console.log(`[UpdateAgent] Update succeeded: ${result.previousVersion} → ${result.targetVersion} (${result.durationMs}ms)`)
    } else {
      console.error(`[UpdateAgent] Update failed: ${result.error}`)
    }

    // Report result back to MC deploy-health endpoint
    try {
      await reportDeployHealth(result)
    } catch {}
  }).catch(err => log.warn({ err }, 'Background task failed'))

  return ok({
    success: true,
    message: `Update to ${targetVersion} initiated`,
    currentVersion: status.currentVersion,
  })
}

/**
 * GET /api/system/update — returns current update status
 */
export async function GET() {
  const status = getUpdateAgentStatus()
  return ok(status)
}

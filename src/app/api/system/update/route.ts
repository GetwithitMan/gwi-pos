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
import { executeUpdate, getUpdateAgentStatus } from '@/lib/update-agent'
import { emitCloudEvent } from '@/lib/cloud-events'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Optional: verify internal secret if configured
  const secret = process.env.INTERNAL_API_SECRET
  if (secret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: { targetVersion?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { targetVersion } = body

  if (!targetVersion || typeof targetVersion !== 'string') {
    return NextResponse.json({ success: false, error: 'targetVersion required' }, { status: 400 })
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

    // Report result back to MC
    try {
      await emitCloudEvent('UPDATE_RESULT', {
        locationId: process.env.POS_LOCATION_ID || process.env.LOCATION_ID || '',
        ...result,
      })
    } catch {}
  }).catch(console.error)

  return NextResponse.json({
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
  return NextResponse.json(status)
}

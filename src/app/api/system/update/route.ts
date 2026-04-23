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
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
import { spawn } from 'child_process'
import { getUpdateAgentStatus } from '@/lib/update-status'
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

  // Fire-and-forget: start update in a detached runner process, return immediately
  const tsxBinary = process.platform === 'win32'
    ? `${process.cwd()}/node_modules/.bin/tsx.cmd`
    : `${process.cwd()}/node_modules/.bin/tsx`
  const runnerPath = `${process.cwd()}/scripts/update-agent-runner.ts`
  const child = spawn(tsxBinary, [runnerPath, targetVersion], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()

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

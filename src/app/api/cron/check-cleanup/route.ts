import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { runCheckCleanup } from '@/lib/check-events/check-cleanup'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/check-cleanup
 *
 * Runs every 5 minutes (registered in vercel.json).
 *
 * Step 1: Release stale leases — terminals that crashed without clean disconnect.
 * Step 2: Abandon stale draft checks — drafts with no active editor for > 30 min.
 * Step 3: Prune processed commands older than 24h.
 *
 * NUCs run the same sweep in-process via the `draftCleanup` worker in server.ts,
 * scoped to their own location. Both paths share `runCheckCleanup`.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const result = await runCheckCleanup()
  return NextResponse.json(result)
}

/**
 * Clear Quarantine — POST /api/internal/deploy/clear-quarantine
 *
 * Calls gwi-node.sh clear-quarantine [releaseId] to remove a
 * specific release from the quarantine (bad-releases) list, or all
 * quarantined releases if no releaseId is provided.
 * Requires INTERNAL_API_SECRET bearer token authentication.
 *
 * Body: { releaseId?: string }
 */

import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

export const dynamic = 'force-dynamic'

/** Resolve gwi-node.sh path, checking known locations in priority order. */
function resolveGwiNode(): string | null {
  const candidates = [
    '/opt/gwi-pos/gwi-node.sh',
    '/usr/local/bin/gwi-node',
    '/opt/gwi-pos/app/public/scripts/gwi-node.sh',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export async function POST(request: Request) {
  // Auth check — require INTERNAL_API_SECRET
  const authHeader = request.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gwiNode = resolveGwiNode()
  if (!gwiNode) {
    return NextResponse.json(
      { error: 'gwi-node.sh not found' },
      { status: 404 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const releaseId = (body as any).releaseId

  // If releaseId provided, validate it
  if (releaseId && (typeof releaseId !== 'string' || !/^[\w.-]+$/.test(releaseId))) {
    return NextResponse.json({ error: 'Invalid releaseId' }, { status: 400 })
  }

  try {
    const cmd = releaseId
      ? `bash "${gwiNode}" clear-quarantine "${releaseId}"`
      : `bash "${gwiNode}" clear-quarantine`

    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 30_000,
    })

    return NextResponse.json({
      success: true,
      clearedRelease: releaseId || 'all',
      output: output.slice(-500),
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message?.slice(0, 500),
        stderr: err.stderr?.slice(0, 500),
      },
      { status: 500 },
    )
  }
}

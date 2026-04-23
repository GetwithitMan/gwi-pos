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
import { spawnSync } from 'child_process'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Auth check — require INTERNAL_API_SECRET
  const authHeader = request.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gwiNode = process.env.GWI_NODE_SH_PATH || '/opt/gwi-pos/gwi-node.sh'

  const body = await request.json().catch(() => ({}))
  const releaseId = (body as any).releaseId

  // If releaseId provided, validate it
  if (releaseId && (typeof releaseId !== 'string' || !/^[\w.-]+$/.test(releaseId))) {
    return NextResponse.json({ error: 'Invalid releaseId' }, { status: 400 })
  }

  try {
    const result = spawnSync(
      'bash',
      releaseId
        ? [gwiNode, 'clear-quarantine', releaseId]
        : [gwiNode, 'clear-quarantine'],
      {
        encoding: 'utf8',
        timeout: 30_000,
      },
    )

    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json(
          { error: 'gwi-node.sh not found' },
          { status: 404 },
        )
      }
      throw result.error
    }

    if (result.status !== 0) {
      throw new Error(result.stderr || `clear-quarantine exited with status ${result.status}`)
    }

    return NextResponse.json({
      success: true,
      clearedRelease: releaseId || 'all',
      output: (result.stdout || '').slice(-500),
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

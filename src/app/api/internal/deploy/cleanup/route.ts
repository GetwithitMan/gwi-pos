/**
 * Deploy Cleanup — POST /api/internal/deploy/cleanup
 *
 * Calls gwi-node.sh cleanup to remove old images and reclaim
 * disk space. Keeps current and previous images intact.
 * Requires INTERNAL_API_SECRET bearer token authentication.
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

  try {
    const result = spawnSync('bash', [gwiNode, 'cleanup'], {
      encoding: 'utf8',
      timeout: 120_000, // 2 minutes
    })

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
      throw new Error(result.stderr || `cleanup exited with status ${result.status}`)
    }

    return NextResponse.json({
      success: true,
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

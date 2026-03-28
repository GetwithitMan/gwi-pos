/**
 * Deploy Rollback — POST /api/internal/deploy/rollback
 *
 * Calls deploy-release.sh --rollback-to <releaseId>.
 * Requires INTERNAL_API_SECRET bearer token authentication.
 *
 * Body: { releaseId: string }
 */

import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

export const dynamic = 'force-dynamic'

const DEPLOY_SCRIPT = '/opt/gwi-pos/deploy-release.sh'

export async function POST(request: Request) {
  // Auth check — require INTERNAL_API_SECRET
  const authHeader = request.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!existsSync(DEPLOY_SCRIPT)) {
    return NextResponse.json(
      { error: 'deploy-release.sh not installed' },
      { status: 404 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const releaseId = (body as any).releaseId

  // Validate releaseId — alphanumeric, dots, hyphens, underscores only
  if (!releaseId || typeof releaseId !== 'string' || !/^[\w.-]+$/.test(releaseId)) {
    return NextResponse.json({ error: 'Invalid releaseId' }, { status: 400 })
  }

  try {
    const output = execSync(
      `bash "${DEPLOY_SCRIPT}" --rollback-to "${releaseId}"`,
      {
        encoding: 'utf8',
        timeout: 300_000, // 5 minutes — rollbacks can take time
      },
    )

    return NextResponse.json({
      success: true,
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

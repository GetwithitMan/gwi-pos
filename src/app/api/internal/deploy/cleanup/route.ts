/**
 * Deploy Cleanup — POST /api/internal/deploy/cleanup
 *
 * Calls deploy-release.sh --cleanup to remove old releases and reclaim
 * disk space. Keeps current and previous releases intact.
 * Requires INTERNAL_API_SECRET bearer token authentication.
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

  try {
    const output = execSync(`bash "${DEPLOY_SCRIPT}" --cleanup`, {
      encoding: 'utf8',
      timeout: 120_000, // 2 minutes
    })

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

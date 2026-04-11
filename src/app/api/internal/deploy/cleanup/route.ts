/**
 * Deploy Cleanup — POST /api/internal/deploy/cleanup
 *
 * Calls gwi-node.sh cleanup to remove old images and reclaim
 * disk space. Keeps current and previous images intact.
 * Requires INTERNAL_API_SECRET bearer token authentication.
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

  try {
    const output = execSync(`bash "${gwiNode}" cleanup`, {
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

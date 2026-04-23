/**
 * Deploy Rollback — POST /api/internal/deploy/rollback
 *
 * Calls gwi-node.sh rollback (LKG semantics — rolls back to the
 * last-known-good image, NOT a caller-specified release).
 * Requires INTERNAL_API_SECRET bearer token authentication.
 *
 * Body: { releaseId?: string }  — releaseId is accepted for audit/logging
 *   but is NOT passed to gwi-node. gwi-node always rolls back to LKG.
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

  // releaseId is accepted for audit trail but NOT passed to gwi-node.
  // gwi-node rollback always uses LKG (last-known-good) semantics.
  const body = await request.json().catch(() => ({}))
  const releaseId = (body as any).releaseId
  if (releaseId) {
    console.log(`[deploy/rollback] Rollback requested (audit releaseId=${releaseId}) — using LKG semantics`)
  }

  try {
    const result = spawnSync('bash', [gwiNode, 'rollback'], {
      encoding: 'utf8',
      timeout: 300_000, // 5 minutes — rollbacks can take time
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
      throw new Error(result.stderr || `rollback exited with status ${result.status}`)
    }

    return NextResponse.json({
      success: true,
      method: 'lkg-rollback',
      auditReleaseId: releaseId || null,
      output: (result.stdout || '').slice(-500),
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        method: 'lkg-rollback',
        auditReleaseId: releaseId || null,
        error: err.message?.slice(0, 500),
        stderr: err.stderr?.slice(0, 500),
      },
      { status: 500 },
    )
  }
}

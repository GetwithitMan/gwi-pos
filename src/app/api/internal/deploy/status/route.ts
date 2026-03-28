/**
 * Deploy Status — GET /api/internal/deploy/status
 *
 * Calls deploy-release.sh --status and parses the output into JSON.
 * Also reads deploy-state.json, quarantine list, and maintenance mode flag.
 *
 * No authentication required — internal endpoint, called by NUC Dashboard
 * on localhost.
 */

import { NextResponse } from 'next/server'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

const DEPLOY_SCRIPT = '/opt/gwi-pos/deploy-release.sh'

export async function GET() {
  try {
    const fs = await import('fs')

    // Check if deploy-release.sh exists
    if (!fs.existsSync(DEPLOY_SCRIPT)) {
      return NextResponse.json(
        { available: false, error: 'deploy-release.sh not installed' },
        { status: 404 },
      )
    }

    const output = execSync(`bash "${DEPLOY_SCRIPT}" --status`, {
      encoding: 'utf8',
      timeout: 10_000,
    })

    // Parse the structured output into JSON
    // deploy-release.sh --status outputs key: value pairs
    const status: Record<string, string> = {}
    for (const line of output.split('\n')) {
      const match = line.match(/^\s*(.+?):\s+(.+)$/)
      if (match) {
        const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
        status[key] = match[2].trim()
      }
    }

    // Also read deploy-state.json directly for structured data
    let deployState = null
    try {
      deployState = JSON.parse(
        fs.readFileSync('/opt/gwi-pos/shared/state/deploy-state.json', 'utf8'),
      )
    } catch {
      // deploy-state.json may not exist yet
    }

    // Read quarantine list
    let quarantine: string[] = []
    try {
      const q = JSON.parse(
        fs.readFileSync('/opt/gwi-pos/shared/state/bad-releases.json', 'utf8'),
      )
      quarantine = Array.isArray(q)
        ? q.map((r: any) => r.releaseId || r)
        : []
    } catch {
      // No quarantine file
    }

    // Check maintenance mode
    const maintenanceMode = fs.existsSync(
      '/opt/gwi-pos/shared/state/deploy-in-progress',
    )

    return NextResponse.json({
      available: true,
      ...status,
      deployState,
      quarantine,
      maintenanceMode,
    })
  } catch (err) {
    return NextResponse.json(
      {
        available: true,
        error:
          err instanceof Error ? err.message : 'Failed to get deploy status',
      },
      { status: 500 },
    )
  }
}

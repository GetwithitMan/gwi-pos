/**
 * Deploy Releases — GET /api/internal/deploy/releases
 *
 * Lists all releases in /opt/gwi-pos/releases/, with metadata about which
 * is current, which is previous, version info, and size.
 *
 * No authentication required — internal endpoint, called by NUC Dashboard
 * on localhost.
 */

import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { existsSync, readdirSync, statSync, readlinkSync, readFileSync } from 'fs'

export const dynamic = 'force-dynamic'

const RELEASES_DIR = '/opt/gwi-pos/releases'
const CURRENT_LINK = '/opt/gwi-pos/current'
const PREVIOUS_LINK = '/opt/gwi-pos/previous'

export async function GET() {
  try {
    if (!existsSync(RELEASES_DIR)) {
      return NextResponse.json({ releases: [] })
    }

    const currentTarget = existsSync(CURRENT_LINK)
      ? readlinkSync(CURRENT_LINK)
      : null
    const previousTarget = existsSync(PREVIOUS_LINK)
      ? readlinkSync(PREVIOUS_LINK)
      : null

    const releases = readdirSync(RELEASES_DIR)
      .filter((d) => statSync(`${RELEASES_DIR}/${d}`).isDirectory())
      .map((d) => {
        const fullPath = `${RELEASES_DIR}/${d}`
        const stat = statSync(fullPath)
        let version = d

        try {
          const pkg = JSON.parse(
            readFileSync(`${fullPath}/package.json`, 'utf8'),
          )
          version = pkg.version || d
        } catch {
          // No package.json in release directory
        }

        // Get directory size (du -sb is Linux; macOS uses -sk)
        let sizeBytes = 0
        try {
          const duOut = execSync(`du -sk "${fullPath}" 2>/dev/null | cut -f1`, {
            encoding: 'utf8',
            timeout: 5_000,
          }).trim()
          sizeBytes = parseInt(duOut, 10) * 1024 // -sk gives KB
        } catch {
          // Size calculation failed
        }

        return {
          releaseId: d,
          version,
          path: fullPath,
          sizeBytes,
          createdAt: stat.birthtime.toISOString(),
          isCurrent: currentTarget?.includes(d) || false,
          isPrevious: previousTarget?.includes(d) || false,
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return NextResponse.json({ releases })
  } catch (err) {
    return NextResponse.json(
      {
        releases: [],
        error: err instanceof Error ? err.message : 'Failed to list releases',
      },
      { status: 500 },
    )
  }
}

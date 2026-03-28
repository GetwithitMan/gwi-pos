/**
 * Deploy Logs — GET /api/internal/deploy/logs
 *
 * Reads structured JSON deploy logs from /opt/gwi-pos/shared/logs/deploys/
 * and returns the most recent entries. Each log file is a JSON object
 * written by deploy-release.sh after each deploy/rollback operation.
 *
 * Query params:
 *   ?limit=20  — number of log entries to return (default 20, max 100)
 *
 * No authentication required — internal endpoint, called by NUC Dashboard
 * on localhost.
 */

import { NextResponse } from 'next/server'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'

export const dynamic = 'force-dynamic'

const LOGS_DIR = '/opt/gwi-pos/shared/logs/deploys'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1),
      100,
    )

    if (!existsSync(LOGS_DIR)) {
      return NextResponse.json({ logs: [], total: 0 })
    }

    // Read all JSON log files, sorted newest first
    const logFiles = readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({
        name: f,
        path: `${LOGS_DIR}/${f}`,
        mtime: statSync(`${LOGS_DIR}/${f}`).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)

    const total = logFiles.length
    const selected = logFiles.slice(0, limit)

    const logs = selected
      .map((f) => {
        try {
          const content = readFileSync(f.path, 'utf8')
          return JSON.parse(content)
        } catch {
          // Malformed or unreadable log file — return minimal info
          return {
            file: f.name,
            error: 'Failed to parse log file',
            timestamp: new Date(f.mtime).toISOString(),
          }
        }
      })

    return NextResponse.json({ logs, total })
  } catch (err) {
    return NextResponse.json(
      {
        logs: [],
        total: 0,
        error: err instanceof Error ? err.message : 'Failed to read deploy logs',
      },
      { status: 500 },
    )
  }
}

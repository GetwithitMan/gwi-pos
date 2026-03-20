import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * GET /api/artifacts/:version/schema.sql
 * GET /api/artifacts/:version/version-contract.json
 * GET /api/artifacts/latest/schema.sql
 * GET /api/artifacts/latest/version-contract.json
 * GET /api/artifacts/latest/manifest.json
 *
 * Serves immutable versioned build artifacts for fleet rollouts.
 * MC pins a rollout to a specific artifact version instead of
 * fetching "whatever POS is serving right now."
 *
 * Auth: x-api-key header (PROVISION_API_KEY) — same as other internal routes.
 *
 * Query params:
 *   file (required): "schema.sql" | "version-contract.json" | "manifest.json"
 *
 * "latest" resolves to the currentVersion from manifest.json.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ version: string }> }
) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { version } = await params
  const file = request.nextUrl.searchParams.get('file')

  if (!file) {
    return NextResponse.json(
      { error: 'Missing "file" query parameter. Use: schema.sql, version-contract.json, or manifest.json' },
      { status: 400 }
    )
  }

  const ALLOWED_FILES = ['schema.sql', 'version-contract.json', 'manifest.json'] as const
  if (!ALLOWED_FILES.includes(file as any)) {
    return NextResponse.json(
      { error: `Invalid file "${file}". Allowed: ${ALLOWED_FILES.join(', ')}` },
      { status: 400 }
    )
  }

  const artifactsDir = path.join(process.cwd(), 'public/artifacts')

  // ── Manifest is always at the root level ──────────────────────────────
  if (file === 'manifest.json') {
    const manifestPath = path.join(artifactsDir, 'manifest.json')
    return serveFile(manifestPath, 'application/json')
  }

  // ── Resolve "latest" to the current version from manifest ─────────────
  let resolvedVersion = version
  if (version === 'latest') {
    const manifestPath = path.join(artifactsDir, 'manifest.json')
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      resolvedVersion = manifest.currentVersion
    } catch {
      return NextResponse.json(
        { error: 'Artifact manifest not found. Build may be incomplete.' },
        { status: 404 }
      )
    }
  }

  // ── Validate version format (prevent path traversal) ──────────────────
  if (!/^[\w.-]+$/.test(resolvedVersion)) {
    return NextResponse.json(
      { error: 'Invalid version format' },
      { status: 400 }
    )
  }

  // ── Map file param to versioned filename ──────────────────────────────
  let filename: string
  let contentType: string
  if (file === 'schema.sql') {
    filename = `schema-${resolvedVersion}.sql`
    contentType = 'application/sql'
  } else {
    filename = `version-contract-${resolvedVersion}.json`
    contentType = 'application/json'
  }

  const filePath = path.join(artifactsDir, filename)

  // ── Integrity check ───────────────────────────────────────────────────
  // If caller supplies ?sha256=..., verify it matches the file content
  const expectedHash = request.nextUrl.searchParams.get('sha256')
  if (expectedHash) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const { createHash } = await import('crypto')
      const actualHash = createHash('sha256').update(content, 'utf-8').digest('hex')
      if (actualHash !== expectedHash) {
        return NextResponse.json(
          {
            error: 'Integrity check failed',
            expected: expectedHash,
            actual: actualHash,
          },
          { status: 409 }
        )
      }
    } catch {
      return NextResponse.json(
        { error: `Artifact not found: ${filename}` },
        { status: 404 }
      )
    }
  }

  return serveFile(filePath, contentType, resolvedVersion !== version ? resolvedVersion : undefined)
}

/** Read a file from disk and return it as a Response */
function serveFile(
  filePath: string,
  contentType: string,
  resolvedVersion?: string
): NextResponse {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      // Immutable: versioned artifacts never change once generated
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
    if (resolvedVersion) {
      headers['X-Resolved-Version'] = resolvedVersion
    }
    return new NextResponse(content, { status: 200, headers })
  } catch {
    return NextResponse.json(
      { error: `Artifact not found: ${path.basename(filePath)}` },
      { status: 404 }
    )
  }
}

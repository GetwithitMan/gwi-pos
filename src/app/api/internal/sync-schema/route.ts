import { NextRequest } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import { buildVenueDirectUrl, venueDbName } from '@/lib/db'

// Allow up to 60s — prisma db push against Neon typically takes 10-20s
export const maxDuration = 60

/**
 * POST /api/internal/sync-schema
 *
 * Pushes the current Prisma schema to a venue's Neon database.
 * Called by Mission Control after deploying a release to a cloud venue.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *
 * Body:
 *   { slug: "fruita-grill" }
 *
 * Response:
 *   { success: true, slug: "fruita-grill", databaseName: "gwi_pos_fruita_grill" }
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Validate slug ─────────────────────────────────────────────────────
  const body = await request.json()
  const slug: string = body.slug

  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return Response.json(
      { error: 'Invalid slug. Use lowercase alphanumeric with hyphens.' },
      { status: 400 }
    )
  }

  // ── Build venue database URL ──────────────────────────────────────────
  // Replaces the database name in DIRECT_URL:
  //   postgresql://user:pass@host/gwi_pos → postgresql://user:pass@host/gwi_pos_fruita_grill
  const directUrl = buildVenueDirectUrl(slug)
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')

  // ── Run prisma db push ────────────────────────────────────────────────
  try {
    const output = execSync(
      `node_modules/.bin/prisma db push --accept-data-loss --skip-generate --schema="${schemaPath}"`,
      {
        env: {
          ...process.env,
          DATABASE_URL: directUrl,
          DIRECT_URL: directUrl,
        },
        stdio: 'pipe',
        timeout: 55000,
      }
    )

    const message = output.toString().trim()
    console.log(`[sync-schema] ${slug}: ${message}`)

    return Response.json({
      success: true,
      slug,
      databaseName: venueDbName(slug),
    })
  } catch (error: unknown) {
    const err = error as { stderr?: Buffer; stdout?: Buffer; message?: string }
    const details = err.stderr?.toString() || err.stdout?.toString() || err.message || 'Unknown error'
    console.error(`[sync-schema] Failed for ${slug}:`, details)
    return Response.json(
      { error: 'Schema sync failed', details },
      { status: 500 }
    )
  }
}

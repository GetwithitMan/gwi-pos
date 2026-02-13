import { NextRequest } from 'next/server'
import { getDbForVenue, venueDbName } from '@/lib/db'

/**
 * GET /api/internal/venue-health?slug=joes-bar
 *
 * Quick health check for a venue's database.
 * Verifies the Neon database exists and is reachable.
 *
 * Called by Mission Control after provisioning to confirm
 * the venue is live, or on-demand for diagnostics.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret)
 *
 * Response:
 *   { ok: true, slug, database, tables: 139, latencyMs: 12 }
 *   { ok: false, slug, error: "..." }
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return Response.json(
      { ok: false, error: 'Invalid or missing slug parameter' },
      { status: 400 }
    )
  }

  const dbName = venueDbName(slug)

  try {
    const start = Date.now()
    const venueDb = getDbForVenue(slug)

    // Quick connectivity check — count tables in the schema
    const tables = await venueDb.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`
    )
    const latencyMs = Date.now() - start
    const tableCount = Number(tables[0]?.count ?? 0)

    return Response.json({
      ok: true,
      slug,
      database: dbName,
      tables: tableCount,
      latencyMs,
    })
  } catch (error) {
    return Response.json({
      ok: false,
      slug,
      database: dbName,
      error: error instanceof Error ? error.message : 'Connection failed',
    }, { status: 503 })
  }
}

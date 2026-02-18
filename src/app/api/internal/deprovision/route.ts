import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/internal/deprovision
 *
 * Drops a venue's Neon database. Called by Mission Control when
 * a location is permanently deleted.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *
 * Body:
 *   { databaseName: "gwi_pos_joes_bar", slug: "joes-bar" }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { databaseName } = body as { databaseName: string; slug?: string }

  if (!databaseName || !/^gwi_pos_[a-z0-9_]+$/.test(databaseName)) {
    return Response.json(
      { error: 'Invalid database name' },
      { status: 400 }
    )
  }

  // Safety: never drop the master database
  if (databaseName === 'gwi_pos' || databaseName === 'neondb') {
    return Response.json(
      { error: 'Cannot drop master database' },
      { status: 400 }
    )
  }

  try {
    // Check if database exists
    const existing = await db.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = $1`,
      databaseName
    )

    if (existing.length === 0) {
      return Response.json({ success: true, message: 'Database does not exist' })
    }

    // Terminate active connections before dropping
    await db.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      databaseName
    )

    // Drop the database
    await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`)
    if (process.env.NODE_ENV !== 'production') console.log(`[Deprovision] Dropped database: ${databaseName}`)

    return Response.json({ success: true, databaseName })
  } catch (error) {
    console.error('[Deprovision] Failed to drop database:', error)
    return Response.json(
      { error: 'Failed to drop database', details: String(error) },
      { status: 500 }
    )
  }
})

import { NextRequest } from 'next/server'
import { db, masterClient } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok, unauthorized } from '@/lib/api-response'

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
    return unauthorized('Unauthorized')
  }

  const body = await request.json()
  const { databaseName } = body as { databaseName: string; slug?: string }

  if (!databaseName || !/^gwi_pos_[a-z0-9_]+$/.test(databaseName)) {
    return err('Invalid database name')
  }

  if (databaseName.includes('\n') || databaseName.includes('\r')) {
    return err('Invalid database name')
  }

  // Length cap: PostgreSQL max identifier is 63 chars
  if (databaseName.length > 63) {
    return err('Database name exceeds maximum length')
  }

  // Safety: never drop the master database
  if (databaseName === 'gwi_pos' || databaseName === 'neondb') {
    return err('Cannot drop master database')
  }

  try {
    // Mark venue as inactive in cron registry before dropping DB
    const slug = body.slug as string | undefined
    if (slug) {
      try {
        await masterClient.$executeRawUnsafe(
          `UPDATE "_cron_venue_registry" SET "is_active" = false, "updated_at" = NOW() WHERE "slug" = $1`,
          slug,
        )
        console.log(`[Deprovision] Marked venue ${slug} as inactive in cron registry`)
      } catch (registryErr) {
        // Non-fatal: registry table may not exist yet
        console.warn(`[Deprovision] Failed to deactivate ${slug} in cron registry:`, registryErr)
      }
    }

    // Check if database exists (parameterized query against pg_database)
    const existing = await db.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = $1`,
      databaseName
    )

    if (existing.length === 0) {
      return ok({ success: true, message: 'Database does not exist' })
    }

    // Secondary validation: confirm the returned name matches exactly.
    // This guards against any edge case where the parameterized query
    // returns an unexpected row before we use string interpolation in DROP.
    if (existing[0].datname !== databaseName) {
      console.error(`[Deprovision] pg_database name mismatch: expected=${databaseName}, got=${existing[0].datname}`)
      return err('Database name verification failed', 500)
    }

    // Terminate active connections before dropping
    await db.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      databaseName
    )

    // Drop the database
    await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`)
    if (process.env.NODE_ENV !== 'production') console.log(`[Deprovision] Dropped database: ${databaseName}`)

    return ok({ success: true })
  } catch (error) {
    console.error('[Deprovision] Failed to drop database:', error)
    return err('Failed to drop database', 500)
  }
})

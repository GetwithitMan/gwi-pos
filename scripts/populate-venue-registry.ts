/**
 * One-time script to populate the _cron_venue_registry table with existing venues.
 *
 * Usage: dotenv -e .env.local -- tsx scripts/populate-venue-registry.ts
 *
 * Requires:
 *   DATABASE_URL - POS master database (where the registry lives)
 *   MC_DATABASE_URL - Mission Control database (source of venue list)
 *                     OR pass venue slugs as arguments: tsx scripts/populate-venue-registry.ts slug1 slug2 slug3
 */

import { Client } from 'pg'

interface VenueRecord {
  slug: string
  databaseName: string
}

async function getVenuesFromArgs(args: string[]): Promise<VenueRecord[]> {
  // When slugs are passed as CLI args, derive database_name from convention: gwi_pos_<slug>
  return args.map((slug) => ({
    slug,
    databaseName: `gwi_pos_${slug}`,
  }))
}

async function getVenuesFromMC(): Promise<VenueRecord[]> {
  const mcUrl = process.env.MC_DATABASE_URL
  if (!mcUrl) {
    return []
  }

  console.log('Connecting to Mission Control database...')
  const mc = new Client({ connectionString: mcUrl })
  await mc.connect()

  try {
    const result = await mc.query<{ slug: string; databaseName: string }>(
      `SELECT slug, "databaseName" FROM "CloudLocation" WHERE "isActive" = true AND "provisioningStatus" IN ('LIVE', 'SYNC_READY', 'NUC_REGISTERED')`
    )
    console.log(`Found ${result.rows.length} active venue(s) in Mission Control`)
    return result.rows.map((row) => ({
      slug: row.slug,
      databaseName: row.databaseName,
    }))
  } finally {
    await mc.end()
  }
}

async function main() {
  const cliArgs = process.argv.slice(2)

  // Determine venue list source
  let venues: VenueRecord[]

  if (cliArgs.length > 0) {
    console.log(`Using ${cliArgs.length} venue slug(s) from CLI arguments`)
    venues = await getVenuesFromArgs(cliArgs)
  } else if (process.env.MC_DATABASE_URL) {
    venues = await getVenuesFromMC()
  } else {
    console.error(
      `Usage:
  dotenv -e .env.local -- tsx scripts/populate-venue-registry.ts [slug1 slug2 ...]

Either:
  - Pass venue slugs as arguments (database_name will be derived as gwi_pos_<slug>)
  - Set MC_DATABASE_URL env var to read venues from Mission Control database

Requires DATABASE_URL to be set (POS master database).`
    )
    process.exit(1)
  }

  if (venues.length === 0) {
    console.log('No venues found. Nothing to do.')
    return
  }

  // Connect to POS master database
  const masterUrl = process.env.DATABASE_URL
  if (!masterUrl) {
    console.error('ERROR: DATABASE_URL is not set. This should point to the POS master database.')
    process.exit(1)
  }

  console.log('Connecting to POS master database...')
  const master = new Client({ connectionString: masterUrl })
  await master.connect()

  try {
    // Verify the registry table exists
    const tableCheck = await master.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '_cron_venue_registry'
      ) AS "exists"`
    )

    if (!tableCheck.rows[0]?.exists) {
      console.error(
        'ERROR: _cron_venue_registry table does not exist. Run migration 084 first:\n  node scripts/nuc-pre-migrate.js'
      )
      process.exit(1)
    }

    let inserted = 0
    let updated = 0
    let failed = 0

    for (const venue of venues) {
      try {
        const result = await master.query(
          `INSERT INTO "_cron_venue_registry" (slug, database_name, is_active, updated_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (slug) DO UPDATE SET is_active = true, database_name = $2, updated_at = NOW()
           RETURNING (xmax = 0) AS is_insert`,
          [venue.slug, venue.databaseName]
        )

        const isInsert = result.rows[0]?.is_insert
        if (isInsert) {
          inserted++
          console.log(`  + INSERT  ${venue.slug} (${venue.databaseName})`)
        } else {
          updated++
          console.log(`  ~ UPDATE  ${venue.slug} (${venue.databaseName})`)
        }
      } catch (err) {
        failed++
        console.error(`  ! FAILED  ${venue.slug}: ${err instanceof Error ? err.message : err}`)
      }
    }

    console.log('\n--- Summary ---')
    console.log(`  Total venues:  ${venues.length}`)
    console.log(`  Inserted:      ${inserted}`)
    console.log(`  Updated:       ${updated}`)
    if (failed > 0) {
      console.log(`  Failed:        ${failed}`)
    }
    console.log('Done.')
  } finally {
    await master.end()
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

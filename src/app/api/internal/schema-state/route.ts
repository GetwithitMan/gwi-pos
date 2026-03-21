import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/system-config'
import { ensureSchemaStateTable, writeSchemaState, readSchemaState } from '@/lib/venue-schema-state'
import { EXPECTED_SCHEMA_VERSION, EXPECTED_SEED_VERSION, APP_VERSION } from '@/lib/version-contract'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/internal/schema-state
 *
 * Write _venue_schema_state for a venue database. This is the ONLY external
 * entry point for writing schema state — MC calls this instead of writing
 * directly to the venue DB. POS owns the _venue_schema_state contract.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY
 *   x-venue-slug: venue slug (for multi-tenant routing)
 *
 * Body:
 *   { schemaVersion, seedVersion, provisionerVersion, provisionedBy }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== config.provisionApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    schemaVersion?: string
    seedVersion?: string
    provisionerVersion?: string
    provisionedBy?: string
    mode?: 'pipeline' | 'repair'
  }

  const mode = body.mode || 'pipeline'

  if (mode === 'pipeline') {
    // Strict: all fields required — hides caller bugs if omitted
    if (!body.schemaVersion || !body.seedVersion || !body.provisionerVersion || !body.provisionedBy) {
      return NextResponse.json(
        { error: 'Pipeline mode requires schemaVersion, seedVersion, provisionerVersion, and provisionedBy' },
        { status: 400 }
      )
    }
  }

  // Use provided values, or fall back to POS's own version contract (repair mode only)
  const schemaVersion = body.schemaVersion || EXPECTED_SCHEMA_VERSION
  const seedVersion = body.seedVersion || EXPECTED_SEED_VERSION
  const provisionerVersion = body.provisionerVersion || '1'
  const provisionedBy = body.provisionedBy || 'repair'

  try {
    const { db } = await import('@/lib/db')

    await ensureSchemaStateTable(db)
    await writeSchemaState(db, {
      schemaVersion,
      seedVersion,
      provisionerVersion,
      provisionedAt: new Date(),
      provisionedBy,
      appVersion: APP_VERSION,
    })

    // Read back to confirm
    const state = await readSchemaState(db)

    return NextResponse.json({
      success: true,
      state,
    })
  } catch (error) {
    console.error('[schema-state] Write failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to write schema state' },
      { status: 500 }
    )
  }
})

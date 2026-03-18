/**
 * GATE 1: Quarantine Blocking Mode Validation
 *
 * Run against staging database after setting SYNC_QUARANTINE_MODE=blocking
 *
 * Usage: dotenv -e .env.local -- tsx scripts/validation/gate1-quarantine-blocking.ts
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  console.log('=== GATE 1: Quarantine Blocking Mode ===\n')

  // Check quarantine mode
  const mode = process.env.SYNC_QUARANTINE_MODE || 'log-only'
  console.log(`SYNC_QUARANTINE_MODE: ${mode}`)
  if (mode !== 'blocking') {
    console.error('❌ FAIL: SYNC_QUARANTINE_MODE must be "blocking" for this test')
    console.log('   Set SYNC_QUARANTINE_MODE=blocking in .env and restart')
    process.exit(1)
  }
  console.log('✓ Mode is blocking\n')

  // Check conflict count in last 48 hours
  const conflicts = await db.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM "SyncConflict" WHERE "detectedAt" > NOW() - INTERVAL '48 hours'`
  )
  const conflictCount = Number(conflicts[0].count)
  console.log(`Conflicts in last 48h: ${conflictCount}`)

  // Check by model
  const byModel = await db.$queryRawUnsafe<Array<{ model: string; count: bigint; resolved: bigint }>>(
    `SELECT model, COUNT(*) as count,
       COUNT(*) FILTER (WHERE "resolvedAt" IS NOT NULL) as resolved
     FROM "SyncConflict"
     WHERE "detectedAt" > NOW() - INTERVAL '48 hours'
     GROUP BY model`
  )
  if (byModel.length > 0) {
    console.log('\nConflicts by model:')
    for (const row of byModel) {
      console.log(`  ${row.model}: ${Number(row.count)} total, ${Number(row.resolved)} resolved`)
    }
  } else {
    console.log('  (no conflicts detected — clean run)')
  }

  // Check watermarks
  const watermarks = await db.$queryRawUnsafe<Array<{
    locationId: string
    lastAcknowledgedDownstreamAt: Date
    updatedAt: Date
  }>>(
    `SELECT "locationId", "lastAcknowledgedDownstreamAt", "updatedAt"
     FROM "SyncWatermark" ORDER BY "updatedAt" DESC LIMIT 5`
  )
  console.log(`\nWatermarks (last 5):`)
  if (watermarks.length === 0) {
    console.warn('⚠️  No watermarks found — sync may not have run yet')
  }
  for (const wm of watermarks) {
    const age = Date.now() - new Date(wm.updatedAt).getTime()
    const ageMin = Math.round(age / 60000)
    console.log(`  ${wm.locationId}: last ack ${new Date(wm.lastAcknowledgedDownstreamAt).toISOString()}, updated ${ageMin}m ago`)
    if (ageMin > 30) {
      console.warn(`  ⚠️  Watermark stale (>${ageMin}m) — check if sync worker is running`)
    }
  }

  // Summary
  console.log('\n--- GATE 1 RESULTS ---')
  console.log(`✓ Quarantine mode: blocking`)
  console.log(`${conflictCount === 0 ? '✓' : '⚠️'} Conflicts: ${conflictCount}`)
  console.log(`${watermarks.length > 0 ? '✓' : '⚠️'} Watermarks: ${watermarks.length} venues tracked`)

  if (conflictCount === 0 && watermarks.length > 0) {
    console.log('\n✅ GATE 1: PASS — No false positives, watermarks advancing')
  } else if (conflictCount > 0) {
    console.log('\n⚠️  GATE 1: REVIEW — Conflicts detected, verify they are real')
  } else {
    console.log('\n⚠️  GATE 1: INCOMPLETE — Need more sync cycles to validate')
  }

  await db.$disconnect()
}

main().catch(console.error)

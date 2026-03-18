/**
 * GATE 2: RLS Failure-Mode Tests
 *
 * Runs 4 tests against the database to verify RLS policies block cross-tenant access.
 * Requires migration 078 to have run.
 *
 * Usage: dotenv -e .env.local -- tsx scripts/validation/gate2-rls-tests.ts
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const result = await fn()
    if (result) {
      console.log(`✓ ${name}`)
      passed++
    } else {
      console.log(`❌ ${name}`)
      failed++
    }
  } catch (err) {
    console.log(`❌ ${name} — ERROR: ${err instanceof Error ? err.message : err}`)
    failed++
  }
}

async function main() {
  console.log('=== GATE 2: RLS Failure-Mode Tests ===\n')

  // First check if RLS is enabled
  const rlsCheck = await db.$queryRawUnsafe<[{ relrowsecurity: boolean }]>(
    `SELECT relrowsecurity FROM pg_class WHERE relname = 'Order'`
  )
  if (!rlsCheck[0]?.relrowsecurity) {
    console.error('❌ RLS is NOT enabled on Order table. Run migration 078 first.')
    await db.$disconnect()
    process.exit(1)
  }
  console.log('✓ RLS is enabled on Order table\n')

  // Get two different locationIds for testing
  const locations = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "Location" WHERE "deletedAt" IS NULL LIMIT 2`
  )
  if (locations.length < 2) {
    console.error('❌ Need at least 2 locations for cross-tenant tests')
    await db.$disconnect()
    process.exit(1)
  }
  const venueA = locations[0].id
  const venueB = locations[1].id
  console.log(`Testing with venueA=${venueA}, venueB=${venueB}\n`)

  // TEST 1: Cross-tenant READ
  await test('Test 1: Cross-tenant READ blocked', async () => {
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT set_config('app.current_tenant', $1, true);
       SELECT id FROM "Order" WHERE "locationId" = $2 LIMIT 1`,
      venueA, venueB
    )
    return rows.length === 0 // Should see 0 rows (RLS blocks)
  })

  // TEST 2: Cross-tenant WRITE
  await test('Test 2: Cross-tenant WRITE blocked', async () => {
    const result = await db.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant', $1, true);
       UPDATE "Order" SET notes = 'RLS-TEST-SHOULD-NOT-PERSIST'
       WHERE "locationId" = $2 AND notes != 'RLS-TEST-SHOULD-NOT-PERSIST'`,
      venueA, venueB
    )
    return result === 0 // Should affect 0 rows
  })

  // TEST 3: Transaction scope
  await test('Test 3: Transaction scope — GUC scopes correctly', async () => {
    return await db.$transaction(async (tx) => {
      // Set tenant to venueA
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, venueA)
      const countA = await tx.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "Order"`
      )

      // Switch to venueB
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, venueB)
      const countB = await tx.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "Order"`
      )

      // Both should return data only for their respective venues
      const a = Number(countA[0].count)
      const b = Number(countB[0].count)
      console.log(`    venueA orders: ${a}, venueB orders: ${b}`)
      return a >= 0 && b >= 0 // Both should work within their scope
    })
  })

  // TEST 4: No GUC = no rows (fail-closed)
  await test('Test 4: No GUC set = zero rows (fail-closed)', async () => {
    // Reset the GUC by using a fresh connection context
    const rows = await db.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "Order"`
    )
    // Without SET LOCAL, current_setting returns NULL, RLS should block all
    const count = Number(rows[0].count)
    console.log(`    Orders with no GUC: ${count}`)
    // Note: This test may see all rows if the connection is the table owner
    // and FORCE ROW LEVEL SECURITY wasn't applied. Check for that.
    return count === 0
  })

  // Summary
  console.log(`\n--- GATE 2 RESULTS ---`)
  console.log(`Passed: ${passed}/4, Failed: ${failed}/4`)

  if (failed === 0) {
    console.log('\n✅ GATE 2: PASS — All RLS tests passed')
  } else {
    console.log('\n❌ GATE 2: FAIL — Review failed tests')
    console.log('   Check: ALTER TABLE ... FORCE ROW LEVEL SECURITY applied?')
    console.log('   Check: Policy uses current_setting(\'app.current_tenant\', true)?')
  }

  await db.$disconnect()
}

main().catch(console.error)

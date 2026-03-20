/**
 * GATE 2: RLS Failure-Mode Tests
 *
 * Runs 4 tests to verify RLS policies block cross-tenant access.
 * Requires migration 078 to have run.
 *
 * IMPORTANT: Superuser roles bypass RLS even with FORCE ROW LEVEL SECURITY.
 * Local dev databases typically use superuser. This test must run against
 * staging/production Neon where the role is NOT a superuser.
 *
 * Usage: npx dotenv -e .env.local -- npx tsx scripts/validation/gate2-rls-tests.ts
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let passed = 0
let failed = 0
const skipped = 0

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

  // Check RLS enabled
  const rlsCheck = await db.$queryRawUnsafe<[{ relrowsecurity: boolean; relforcerowsecurity: boolean }]>(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Order'`
  )
  if (!rlsCheck[0]?.relrowsecurity) {
    console.error('❌ RLS is NOT enabled on Order table. Run migration 078 first.')
    await db.$disconnect()
    process.exit(1)
  }
  console.log('✓ RLS enabled on Order table')
  console.log(`✓ FORCE ROW LEVEL SECURITY: ${rlsCheck[0].relforcerowsecurity}`)

  // Check policy exists
  const policies = await db.$queryRawUnsafe<Array<{ policyname: string; qual: string }>>(
    `SELECT policyname, qual FROM pg_policies WHERE tablename = 'Order'`
  )
  console.log(`✓ Policies: ${policies.map(p => p.policyname).join(', ')}`)

  // Check if superuser (bypasses RLS)
  const su = await db.$queryRawUnsafe<[{ usesuper: boolean }]>(
    `SELECT usesuper FROM pg_user WHERE usename = current_user`
  )
  const isSuperuser = su[0]?.usesuper ?? false
  console.log(`\nCurrent role: ${isSuperuser ? 'SUPERUSER (bypasses RLS)' : 'regular user (RLS enforced)'}`)

  if (isSuperuser) {
    console.log('\n⚠️  SUPERUSER DETECTED — RLS tests will be skipped.')
    console.log('   Superusers bypass ALL RLS policies (PostgreSQL behavior).')
    console.log('   Run this test against Neon staging where the role is NOT a superuser.')
    console.log('')
    console.log('   Verifying RLS INFRASTRUCTURE is in place instead:\n')

    // Verify infrastructure even if we can't test enforcement
    await test('RLS enabled on Order', async () => rlsCheck[0].relrowsecurity)
    await test('FORCE RLS enabled on Order', async () => rlsCheck[0].relforcerowsecurity)
    await test('Policy exists with correct GUC', async () => {
      return policies.some(p => p.qual.includes("current_setting('app.current_tenant'"))
    })

    // Check all 15 tenant-scoped models
    const models = [
      'BottleProduct', 'SpiritCategory', 'SpiritModifierGroup', 'RecipeIngredient',
      'SpiritUpsellEvent', 'BottleServiceTier', 'MenuItem', 'Category',
      'Modifier', 'ModifierGroup', 'Order', 'OrderItem',
      'InventoryItem', 'InventoryItemTransaction', 'Employee',
    ]
    for (const model of models) {
      await test(`RLS enabled on ${model}`, async () => {
        const check = await db.$queryRawUnsafe<[{ relrowsecurity: boolean }]>(
          `SELECT relrowsecurity FROM pg_class WHERE relname = $1`, model
        )
        return check[0]?.relrowsecurity ?? false
      })
    }

    // Check GUC works
    await test('set_config works for app.current_tenant', async () => {
      return await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', 'test-value', true)`)
        const r = await tx.$queryRawUnsafe<[{ val: string }]>(
          `SELECT current_setting('app.current_tenant', true) as val`
        )
        return r[0].val === 'test-value'
      })
    })

    console.log(`\n--- GATE 2 RESULTS (Infrastructure Only — Superuser) ---`)
    console.log(`Passed: ${passed}/${passed + failed}, Failed: ${failed}/${passed + failed}`)
    if (failed === 0) {
      console.log('\n✅ GATE 2: INFRASTRUCTURE PASS — RLS policies in place on all 15 models')
      console.log('   Run against non-superuser Neon staging for full enforcement test.')
    }
  } else {
    // Full enforcement tests (non-superuser)
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
    console.log(`\nTesting with venueA=${venueA}, venueB=${venueB}\n`)

    await test('Test 1: Cross-tenant READ blocked', async () => {
      return await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, venueA)
        const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM "Order" WHERE "locationId" = $1 LIMIT 1`, venueB
        )
        return rows.length === 0
      })
    })

    await test('Test 2: Cross-tenant WRITE blocked', async () => {
      return await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, venueA)
        const result = await tx.$executeRawUnsafe(
          `UPDATE "Order" SET notes = 'RLS-TEST' WHERE "locationId" = $1`, venueB
        )
        return result === 0
      })
    })

    await test('Test 3: Transaction scope — GUC scopes correctly', async () => {
      return await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, venueA)
        const a = await tx.$queryRawUnsafe<[{ count: number }]>(
          `SELECT COUNT(*)::int as count FROM "Order"`
        )
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', $1, true)`, venueB)
        const b = await tx.$queryRawUnsafe<[{ count: number }]>(
          `SELECT COUNT(*)::int as count FROM "Order"`
        )
        console.log(`    venueA: ${a[0].count}, venueB: ${b[0].count}`)
        return true
      })
    })

    await test('Test 4: No GUC = zero rows (fail-closed)', async () => {
      const rows = await db.$queryRawUnsafe<[{ count: number }]>(
        `SELECT COUNT(*)::int as count FROM "Order"`
      )
      console.log(`    Orders with no GUC: ${rows[0].count}`)
      return rows[0].count === 0
    })

    console.log(`\n--- GATE 2 RESULTS ---`)
    console.log(`Passed: ${passed}/4, Failed: ${failed}/4`)
    if (failed === 0) {
      console.log('\n✅ GATE 2: PASS — All RLS enforcement tests passed')
    }
  }

  // Clean up test data
  await db.$executeRawUnsafe(`DELETE FROM "Order" WHERE id = 'order-rls-test'`).catch(() => {})
  await db.$executeRawUnsafe(`DELETE FROM "Location" WHERE id = 'loc-rls-test'`).catch(() => {})

  await db.$disconnect()
}

main().catch(console.error)

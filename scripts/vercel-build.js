#!/usr/bin/env node
/**
 * Vercel Build Script
 *
 * Runs pre-push migrations, applies Prisma migrations to PostgreSQL (Neon), and builds the app.
 * Both dev and prod use the same PostgreSQL engine.
 */
const { execSync } = require('child_process')

/**
 * Run pre-push SQL migrations for columns that can't be added as NOT NULL
 * to tables with existing rows. Adds columns as nullable, backfills from
 * related data, then sets NOT NULL — so prisma db push sees them as matching.
 */
async function runPrePushMigrations() {
  const { neon } = require('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL)

  console.log('[vercel-build] Running pre-push migrations...')

  // --- OrderOwnershipEntry.locationId ---
  const [ooeCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'OrderOwnershipEntry' AND column_name = 'locationId'
  `
  if (!ooeCol) {
    console.log('[vercel-build]   Adding locationId to OrderOwnershipEntry...')
    await sql`ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "locationId" TEXT`
    await sql`
      UPDATE "OrderOwnershipEntry" ooe
      SET "locationId" = oo."locationId"
      FROM "OrderOwnership" oo
      WHERE ooe."orderOwnershipId" = oo.id AND ooe."locationId" IS NULL
    `
    // Fallback: any remaining nulls get first location
    await sql`
      UPDATE "OrderOwnershipEntry"
      SET "locationId" = (SELECT id FROM "Location" LIMIT 1)
      WHERE "locationId" IS NULL
    `
    await sql`ALTER TABLE "OrderOwnershipEntry" ALTER COLUMN "locationId" SET NOT NULL`
    console.log('[vercel-build]   Done — OrderOwnershipEntry.locationId backfilled')
  }

  // --- cloud_event_queue.locationId ---
  const [ceqCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'cloud_event_queue' AND column_name = 'locationId'
  `
  if (!ceqCol) {
    console.log('[vercel-build]   Adding locationId to cloud_event_queue...')
    await sql`ALTER TABLE "cloud_event_queue" ADD COLUMN "locationId" TEXT`
    // Backfill from first location (venueId exists but isn't a FK to Location)
    await sql`
      UPDATE "cloud_event_queue"
      SET "locationId" = (SELECT id FROM "Location" LIMIT 1)
      WHERE "locationId" IS NULL
    `
    await sql`ALTER TABLE "cloud_event_queue" ALTER COLUMN "locationId" SET NOT NULL`
    console.log('[vercel-build]   Done — cloud_event_queue.locationId backfilled')
  }

  // --- OrderOwnershipEntry.deletedAt (nullable, just needs to exist) ---
  const [ooeDelCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'OrderOwnershipEntry' AND column_name = 'deletedAt'
  `
  if (!ooeDelCol) {
    console.log('[vercel-build]   Adding deletedAt to OrderOwnershipEntry...')
    await sql`ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "deletedAt" TIMESTAMPTZ`
    console.log('[vercel-build]   Done — OrderOwnershipEntry.deletedAt added')
  }

  // --- ModifierTemplate.locationId ---
  const [mtCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ModifierTemplate' AND column_name = 'locationId'
  `
  if (!mtCol) {
    console.log('[vercel-build]   Adding locationId to ModifierTemplate...')
    await sql`ALTER TABLE "ModifierTemplate" ADD COLUMN "locationId" TEXT`
    // Backfill from parent ModifierGroupTemplate's locationId
    await sql`
      UPDATE "ModifierTemplate" mt
      SET "locationId" = mgt."locationId"
      FROM "ModifierGroupTemplate" mgt
      WHERE mt."templateId" = mgt.id AND mt."locationId" IS NULL
    `
    // Fallback: any remaining nulls get first location
    await sql`
      UPDATE "ModifierTemplate"
      SET "locationId" = (SELECT id FROM "Location" LIMIT 1)
      WHERE "locationId" IS NULL
    `
    await sql`ALTER TABLE "ModifierTemplate" ALTER COLUMN "locationId" SET NOT NULL`
    console.log('[vercel-build]   Done — ModifierTemplate.locationId backfilled')
  }

  // --- ModifierTemplate.deletedAt (nullable, just needs to exist) ---
  const [mtDelCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ModifierTemplate' AND column_name = 'deletedAt'
  `
  if (!mtDelCol) {
    console.log('[vercel-build]   Adding deletedAt to ModifierTemplate...')
    await sql`ALTER TABLE "ModifierTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ`
    console.log('[vercel-build]   Done — ModifierTemplate.deletedAt added')
  }

  console.log('[vercel-build] Pre-push migrations complete')
}

async function main() {
  // Generate Prisma client
  console.log('[vercel-build] Running prisma generate...')
  execSync('npx prisma generate', { stdio: 'inherit' })

  // Run pre-push migrations before db push
  await runPrePushMigrations()

  // Sync schema to Neon PostgreSQL (additive only — fails on destructive changes)
  console.log('[vercel-build] Running prisma db push...')
  execSync('npx prisma db push', { stdio: 'inherit' })

  // Build Next.js
  console.log('[vercel-build] Running next build...')
  execSync('npx next build', { stdio: 'inherit' })

  console.log('[vercel-build] Build complete!')
}

main().catch((err) => {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
})

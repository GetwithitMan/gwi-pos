/**
 * Migration 105 — Drop stale unique constraint on ModifierGroup(locationId, name)
 *
 * This constraint prevented multiple modifier groups with the same name at a
 * location. Now that groups are per-item (via menuItemId), two items should be
 * able to have identically named groups (e.g., "Meat Temps" on both a steak
 * and a burger). Drop the unique and keep the plain index.
 */

const { indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[105]'

  // The constraint could be named several ways depending on how it was created.
  // Check for common Prisma/Postgres naming patterns.
  const possibleNames = [
    'ModifierGroup_locationId_name_key',
    'ModifierGroup_locationId_name_unique',
    'modifier_group_location_id_name_key',
  ]

  for (const name of possibleNames) {
    if (await indexExists(prisma, name)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ModifierGroup" DROP CONSTRAINT "${name}"`)
      console.log(`${PREFIX} Dropped unique constraint: ${name}`)

      // Add a plain index for query performance (if not already present)
      const plainIdx = 'ModifierGroup_locationId_name_idx'
      if (!(await indexExists(prisma, plainIdx))) {
        await prisma.$executeRawUnsafe(`CREATE INDEX "${plainIdx}" ON "ModifierGroup" ("locationId", "name")`)
        console.log(`${PREFIX} Created non-unique index: ${plainIdx}`)
      }

      console.log(`${PREFIX} Migration 105 complete`)
      return
    }
  }

  // Try a generic approach — query pg_constraint directly
  const constraints = await prisma.$queryRawUnsafe(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"ModifierGroup"'::regclass
      AND contype = 'u'
      AND array_to_string(conkey, ',') IN (
        SELECT string_agg(attnum::text, ',' ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = '"ModifierGroup"'::regclass
          AND attname IN ('locationId', 'name')
      )
    LIMIT 1
  `)

  if (constraints.length > 0) {
    const conname = constraints[0].conname
    await prisma.$executeRawUnsafe(`ALTER TABLE "ModifierGroup" DROP CONSTRAINT "${conname}"`)
    console.log(`${PREFIX} Dropped unique constraint: ${conname}`)

    const plainIdx = 'ModifierGroup_locationId_name_idx'
    if (!(await indexExists(prisma, plainIdx))) {
      await prisma.$executeRawUnsafe(`CREATE INDEX "${plainIdx}" ON "ModifierGroup" ("locationId", "name")`)
      console.log(`${PREFIX} Created non-unique index: ${plainIdx}`)
    }
  } else {
    console.log(`${PREFIX} No unique constraint found on ModifierGroup(locationId, name) — skipping`)
  }

  console.log(`${PREFIX} Migration 105 complete`)
}

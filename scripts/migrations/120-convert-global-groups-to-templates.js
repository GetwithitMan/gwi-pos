/**
 * Migration 120: Convert Global ModifierGroups to ModifierGroupTemplates
 *
 * Finds all non-spirit global (menuItemId IS NULL) ModifierGroups and converts
 * them into ModifierGroupTemplate + ModifierTemplate records. The original
 * global groups are soft-deleted after conversion.
 *
 * Idempotent: safe to run multiple times. Skips groups that already have a
 * matching template by (locationId, name). Each group is wrapped in its own
 * try/catch so one failure doesn't stop the migration.
 *
 * Dry-run: pass --dry-run on CLI to preview without making changes.
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[120-convert-global-groups-to-templates]'
  const dryRun = process.argv.includes('--dry-run')

  if (dryRun) {
    console.log(`${PREFIX}   *** DRY RUN MODE — no changes will be made ***`)
  }

  // Guard: required tables must exist
  const mgtExists = await tableExists(prisma, 'ModifierGroupTemplate')
  const mgExists = await tableExists(prisma, 'ModifierGroup')
  const mtExists = await tableExists(prisma, 'ModifierTemplate')
  const modExists = await tableExists(prisma, 'Modifier')
  if (!mgtExists || !mgExists || !mtExists || !modExists) {
    console.log(`${PREFIX}   Skipping — required tables not found (ModifierGroupTemplate: ${mgtExists}, ModifierGroup: ${mgExists}, ModifierTemplate: ${mtExists}, Modifier: ${modExists})`)
    return
  }

  // ── 1. Find all candidate global groups ──
  const globalGroups = await prisma.$queryRawUnsafe(`
    SELECT
      mg."id",
      mg."locationId",
      mg."name",
      mg."minSelections",
      mg."maxSelections",
      mg."isRequired",
      mg."allowStacking",
      mg."modifierTypes",
      mg."sortOrder",
      mg."isSpiritGroup"
    FROM "ModifierGroup" mg
    WHERE mg."menuItemId" IS NULL
      AND mg."deletedAt" IS NULL
  `)

  // ── 2. Partition into spirit vs non-spirit ──
  const spiritGroups = globalGroups.filter(g => g.isSpiritGroup === true)
  const candidates = globalGroups.filter(g => g.isSpiritGroup !== true)

  console.log(`${PREFIX}   Found ${globalGroups.length} global groups total`)
  console.log(`${PREFIX}   Spirit groups skipped: ${spiritGroups.length}`)
  console.log(`${PREFIX}   Non-spirit candidates: ${candidates.length}`)

  if (candidates.length === 0) {
    console.log(`${PREFIX}   Nothing to migrate`)
    return
  }

  // ── 3. Load existing templates for dedup ──
  const existingTemplates = await prisma.$queryRawUnsafe(`
    SELECT "locationId", "name"
    FROM "ModifierGroupTemplate"
    WHERE "deletedAt" IS NULL
  `)
  const templateKeySet = new Set(
    existingTemplates.map(t => `${t.locationId}::${t.name}`)
  )

  // ── 4. Pre-scan for dry-run stats ──
  let totalToCreate = 0
  let totalSkipped = 0
  let totalMissingIngredients = 0
  let totalWithChildGroups = 0

  for (const group of candidates) {
    const key = `${group.locationId}::${group.name}`
    const migratedKey = `${group.locationId}::${group.name} (Migrated)`

    if (templateKeySet.has(key) || templateKeySet.has(migratedKey)) {
      totalSkipped++
      continue
    }
    totalToCreate++

    // Check for modifiers with missing ingredients
    const modsWithIngredient = await prisma.$queryRawUnsafe(`
      SELECT m."ingredientId"
      FROM "Modifier" m
      WHERE m."modifierGroupId" = $1
        AND m."deletedAt" IS NULL
        AND m."ingredientId" IS NOT NULL
    `, group.id)

    for (const mod of modsWithIngredient) {
      const ingExists = await prisma.$queryRawUnsafe(`
        SELECT 1 FROM "Ingredient" WHERE "id" = $1 LIMIT 1
      `, mod.ingredientId)
      if (ingExists.length === 0) {
        totalMissingIngredients++
      }
    }

    // Check for modifiers with child modifier groups
    const childGroupMods = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM "Modifier"
      WHERE "modifierGroupId" = $1
        AND "deletedAt" IS NULL
        AND "childModifierGroupId" IS NOT NULL
      LIMIT 1
    `, group.id)
    if (childGroupMods.length > 0) {
      totalWithChildGroups++
    }
  }

  console.log(`${PREFIX}   Templates to create: ${totalToCreate}`)
  console.log(`${PREFIX}   Skipped (already migrated): ${totalSkipped}`)
  console.log(`${PREFIX}   Groups with missing ingredients: ${totalMissingIngredients}`)
  console.log(`${PREFIX}   Groups with nested child groups: ${totalWithChildGroups}`)

  if (dryRun) {
    console.log(`${PREFIX}   *** DRY RUN COMPLETE — no changes made ***`)
    return
  }

  // ── 5. Convert each group ──
  let converted = 0
  let skipped = 0
  let failed = 0

  for (const group of candidates) {
    try {
      // Re-check for existing template (idempotent guard)
      const existing = await prisma.$queryRawUnsafe(`
        SELECT 1 FROM "ModifierGroupTemplate"
        WHERE "locationId" = $1 AND "name" = $2 AND "deletedAt" IS NULL
        LIMIT 1
      `, group.locationId, group.name)

      let templateName = group.name

      if (existing.length > 0) {
        // Try with ' (Migrated)' suffix
        const suffixedName = `${group.name} (Migrated)`
        const existingSuffixed = await prisma.$queryRawUnsafe(`
          SELECT 1 FROM "ModifierGroupTemplate"
          WHERE "locationId" = $1 AND "name" = $2 AND "deletedAt" IS NULL
          LIMIT 1
        `, group.locationId, suffixedName)

        if (existingSuffixed.length > 0) {
          // Both names taken — skip entirely
          skipped++
          continue
        }

        templateName = suffixedName
      }

      // ── 5a. Create the ModifierGroupTemplate ──
      const modifierTypes = group.modifierTypes != null
        ? (typeof group.modifierTypes === 'string' ? group.modifierTypes : JSON.stringify(group.modifierTypes))
        : '["universal"]'

      const templateRows = await prisma.$queryRawUnsafe(`
        INSERT INTO "ModifierGroupTemplate" (
          "id", "locationId", "name", "description",
          "minSelections", "maxSelections", "isRequired", "allowStacking",
          "modifierTypes", "sortOrder", "isActive",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, NULL,
          $3, $4, $5, $6,
          $7::jsonb, $8, true,
          NOW(), NOW()
        )
        RETURNING "id"
      `,
        group.locationId,
        templateName,
        group.minSelections,
        group.maxSelections,
        group.isRequired,
        group.allowStacking,
        modifierTypes,
        group.sortOrder
      )

      const templateId = templateRows[0].id

      // ── 5b. Get all active modifiers in this group ──
      const modifiers = await prisma.$queryRawUnsafe(`
        SELECT
          m."id",
          m."name",
          m."displayName",
          m."price",
          m."allowNo",
          m."allowLite",
          m."allowOnSide",
          m."allowExtra",
          m."extraPrice",
          m."sortOrder",
          m."isDefault",
          m."ingredientId",
          m."inventoryDeductionAmount",
          m."inventoryDeductionUnit",
          m."showOnPOS",
          m."showOnline"
        FROM "Modifier" m
        WHERE m."modifierGroupId" = $1
          AND m."deletedAt" IS NULL
        ORDER BY m."sortOrder" ASC
      `, group.id)

      // ── 5c. Create ModifierTemplate for each modifier ──
      let modTemplatesCreated = 0

      for (const mod of modifiers) {
        // Look up ingredient name if ingredientId is set
        let ingredientName = null
        if (mod.ingredientId) {
          const ingRows = await prisma.$queryRawUnsafe(`
            SELECT "name" FROM "Ingredient"
            WHERE "id" = $1
            LIMIT 1
          `, mod.ingredientId)
          if (ingRows.length > 0) {
            ingredientName = ingRows[0].name
          }
        }

        await prisma.$executeRawUnsafe(`
          INSERT INTO "ModifierTemplate" (
            "id", "locationId", "templateId",
            "name", "displayName", "price",
            "allowNo", "allowLite", "allowOnSide", "allowExtra", "extraPrice",
            "sortOrder", "isDefault",
            "ingredientId", "ingredientName",
            "inventoryDeductionAmount", "inventoryDeductionUnit",
            "showOnPOS", "showOnline",
            "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2,
            $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12,
            $13, $14,
            $15, $16,
            $17, $18,
            NOW(), NOW()
          )
        `,
          group.locationId,
          templateId,
          mod.name,
          mod.displayName,
          mod.price,
          mod.allowNo,
          mod.allowLite,
          mod.allowOnSide,
          mod.allowExtra,
          mod.extraPrice,
          mod.sortOrder,
          mod.isDefault,
          mod.ingredientId,
          ingredientName,
          mod.inventoryDeductionAmount,
          mod.inventoryDeductionUnit,
          mod.showOnPOS,
          mod.showOnline
        )

        modTemplatesCreated++
      }

      // ── 5d. Verify modifier counts match ──
      const verifyCount = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS cnt
        FROM "ModifierTemplate"
        WHERE "templateId" = $1 AND "deletedAt" IS NULL
      `, templateId)

      const actualCount = verifyCount[0].cnt
      if (actualCount !== modifiers.length) {
        console.warn(`${PREFIX}   WARNING: Group "${group.name}" (${group.id}) — expected ${modifiers.length} modifier templates, got ${actualCount}`)
      }

      // ── 5e. Soft-delete the original global ModifierGroup ──
      await prisma.$executeRawUnsafe(`
        UPDATE "ModifierGroup"
        SET "deletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = $1
      `, group.id)

      // ── 5f. Soft-delete all its Modifier records ──
      await prisma.$executeRawUnsafe(`
        UPDATE "Modifier"
        SET "deletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "modifierGroupId" = $1
          AND "deletedAt" IS NULL
      `, group.id)

      converted++
      console.log(`${PREFIX}   Converted: "${group.name}" → template "${templateName}" (${modTemplatesCreated} modifiers)`)

    } catch (err) {
      failed++
      console.error(`${PREFIX}   FAILED group "${group.name}" (${group.id}):`, err.message)
    }
  }

  console.log(`${PREFIX}   Migration complete — converted: ${converted}, skipped: ${skipped}, failed: ${failed}`)
}

module.exports = { up }

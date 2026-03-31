// Migration 119: Template Schema Enhancements
// Adds fields to ModifierGroupTemplate, ModifierTemplate, and ModifierGroup
// to support the unified template system (replacing dual food modifier flows).

async function up(prisma) {
  // Helper: check if column exists
  async function columnExists(table, column) {
    const result = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
      LIMIT 1
    `, table, column)
    return result.length > 0
  }

  // ── ModifierGroupTemplate additions ──

  if (!(await columnExists('ModifierGroupTemplate', 'allowStacking'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroupTemplate"
      ADD COLUMN "allowStacking" BOOLEAN NOT NULL DEFAULT false
    `)
    console.log('  Added ModifierGroupTemplate.allowStacking')
  }

  if (!(await columnExists('ModifierGroupTemplate', 'modifierTypes'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroupTemplate"
      ADD COLUMN "modifierTypes" JSONB NOT NULL DEFAULT '["food"]'
    `)
    console.log('  Added ModifierGroupTemplate.modifierTypes')
  }

  // ── ModifierTemplate additions ──

  if (!(await columnExists('ModifierTemplate', 'displayName'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "displayName" TEXT
    `)
    console.log('  Added ModifierTemplate.displayName')
  }

  if (!(await columnExists('ModifierTemplate', 'ingredientId'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "ingredientId" TEXT
    `)
    console.log('  Added ModifierTemplate.ingredientId')
  }

  if (!(await columnExists('ModifierTemplate', 'ingredientName'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "ingredientName" TEXT
    `)
    console.log('  Added ModifierTemplate.ingredientName')
  }

  if (!(await columnExists('ModifierTemplate', 'inventoryDeductionAmount'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "inventoryDeductionAmount" DECIMAL(10, 4)
    `)
    console.log('  Added ModifierTemplate.inventoryDeductionAmount')
  }

  if (!(await columnExists('ModifierTemplate', 'inventoryDeductionUnit'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "inventoryDeductionUnit" TEXT
    `)
    console.log('  Added ModifierTemplate.inventoryDeductionUnit')
  }

  if (!(await columnExists('ModifierTemplate', 'showOnPOS'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "showOnPOS" BOOLEAN NOT NULL DEFAULT true
    `)
    console.log('  Added ModifierTemplate.showOnPOS')
  }

  if (!(await columnExists('ModifierTemplate', 'showOnline'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierTemplate"
      ADD COLUMN "showOnline" BOOLEAN NOT NULL DEFAULT true
    `)
    console.log('  Added ModifierTemplate.showOnline')
  }

  // ── ModifierGroup additions (audit metadata) ──

  if (!(await columnExists('ModifierGroup', 'sourceTemplateId'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup"
      ADD COLUMN "sourceTemplateId" TEXT
    `)
    console.log('  Added ModifierGroup.sourceTemplateId')
  }

  if (!(await columnExists('ModifierGroup', 'sourceTemplateName'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup"
      ADD COLUMN "sourceTemplateName" TEXT
    `)
    console.log('  Added ModifierGroup.sourceTemplateName')
  }

  console.log('Migration 119: Template schema enhancements complete')
}

module.exports = { up }


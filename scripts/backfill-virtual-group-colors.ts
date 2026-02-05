// scripts/backfill-virtual-group-colors.ts
// Backfill colors for existing virtual groups that don't have them

import { PrismaClient } from '@prisma/client'
import { getVirtualGroupColor } from '../src/lib/virtual-group-colors'

const prisma = new PrismaClient()

async function backfillVirtualGroupColors() {
  console.log('🔍 Checking for virtual groups without colors...\n')

  // Find all unique virtualGroupIds
  const tables = await prisma.table.findMany({
    where: {
      virtualGroupId: { not: null },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      virtualGroupId: true,
      virtualGroupColor: true,
      virtualGroupPrimary: true,
    },
  })

  // Group by virtualGroupId
  const groupsMap = new Map<string, typeof tables>()
  for (const table of tables) {
    if (table.virtualGroupId) {
      if (!groupsMap.has(table.virtualGroupId)) {
        groupsMap.set(table.virtualGroupId, [])
      }
      groupsMap.get(table.virtualGroupId)!.push(table)
    }
  }

  console.log(`Found ${groupsMap.size} virtual groups\n`)

  let updatedCount = 0
  let skippedCount = 0

  for (const [virtualGroupId, groupTables] of groupsMap) {
    const primaryTable = groupTables.find(t => t.virtualGroupPrimary)
    const hasColor = groupTables.some(t => t.virtualGroupColor)

    if (hasColor) {
      console.log(`✅ Group ${virtualGroupId}: Already has color (${groupTables[0].virtualGroupColor})`)
      skippedCount++
      continue
    }

    // Generate color for this group
    const color = getVirtualGroupColor(virtualGroupId)
    console.log(`🎨 Group ${virtualGroupId}: Assigning color ${color}`)
    console.log(`   Tables: ${groupTables.map(t => t.name).join(', ')}`)

    // Update all tables in this group
    await prisma.table.updateMany({
      where: {
        virtualGroupId,
      },
      data: {
        virtualGroupColor: color,
      },
    })

    updatedCount++
    console.log(`   ✓ Updated ${groupTables.length} tables\n`)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`✅ Backfill complete!`)
  console.log(`   Updated: ${updatedCount} groups`)
  console.log(`   Skipped: ${skippedCount} groups (already had colors)`)
  console.log('='.repeat(60))
}

backfillVirtualGroupColors()
  .catch(error => {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

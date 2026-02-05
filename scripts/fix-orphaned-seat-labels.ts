import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function fixOrphanedSeatLabels() {
  console.log('🔍 Scanning for orphaned virtual seat labels...\n')

  // Find all seats with potential virtual labels (contains hyphen)
  // whose table is NOT in a virtual group
  const orphanedSeats = await db.seat.findMany({
    where: {
      deletedAt: null,
      label: { contains: '-' },
      table: {
        virtualGroupId: null,
        deletedAt: null,
      },
    },
    include: {
      table: {
        select: { id: true, name: true, virtualGroupId: true }
      }
    }
  })

  console.log(`Found ${orphanedSeats.length} seats with hyphenated labels on non-grouped tables\n`)

  if (orphanedSeats.length === 0) {
    console.log('✅ No orphaned labels found!')
    return
  }

  // Group by table for reporting
  const byTable = orphanedSeats.reduce((acc, seat) => {
    const tableName = seat.table.name
    if (!acc[tableName]) acc[tableName] = []
    acc[tableName].push(seat)
    return acc
  }, {} as Record<string, typeof orphanedSeats>)

  console.log('Orphaned seats by table:')
  for (const [tableName, seats] of Object.entries(byTable)) {
    console.log(`  ${tableName}: ${seats.map(s => `"${s.label}" → "${s.seatNumber}"`).join(', ')}`)
  }
  console.log('')

  // Fix each seat
  let fixed = 0
  let errors = 0

  for (const seat of orphanedSeats) {
    try {
      await db.seat.update({
        where: { id: seat.id },
        data: { label: String(seat.seatNumber) }
      })
      fixed++
    } catch (err) {
      console.error(`❌ Failed to fix seat ${seat.id}: ${err}`)
      errors++
    }
  }

  console.log(`\n✅ Fixed ${fixed} seats`)
  if (errors > 0) console.log(`❌ ${errors} errors`)
}

fixOrphanedSeatLabels()
  .catch(console.error)
  .finally(() => db.$disconnect())

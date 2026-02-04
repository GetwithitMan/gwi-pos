import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Get a combined table
  const combined = await prisma.table.findFirst({
    where: {
      combinedTableIds: { not: { equals: null } },
      deletedAt: null
    },
    select: {
      id: true,
      name: true,
      combinedTableIds: true,
      posX: true,
      posY: true,
      width: true,
      height: true
    }
  })

  if (!combined) {
    console.log('No combined tables found')
    return
  }

  console.log('Combined table:', combined.name)
  console.log('Position:', combined.posX, combined.posY, 'Size:', combined.width, combined.height)
  console.log('Combined IDs:', combined.combinedTableIds)

  // Get all tables in group
  const allIds = [combined.id, ...(combined.combinedTableIds as string[] || [])]

  // Get child tables
  const childTables = await prisma.table.findMany({
    where: { id: { in: allIds }, deletedAt: null },
    select: { id: true, name: true, posX: true, posY: true, width: true, height: true }
  })

  console.log('\nTables in group:')
  childTables.forEach(t => {
    console.log('  ' + t.name + ': pos=(' + t.posX + ', ' + t.posY + '), size=' + t.width + 'x' + t.height)
  })

  // Get seats for all tables
  const seats = await prisma.seat.findMany({
    where: { tableId: { in: allIds }, isActive: true, deletedAt: null },
    select: {
      id: true,
      tableId: true,
      label: true,
      seatNumber: true,
      relativeX: true,
      relativeY: true
    },
    orderBy: { seatNumber: 'asc' }
  })

  console.log('\nSeats found:', seats.length)
  seats.forEach(s => {
    const label = s.label || String(s.seatNumber)
    const tableShort = s.tableId.slice(-6)
    console.log('  Seat ' + label + ': table=' + tableShort + ', relPos=(' + s.relativeX + ', ' + s.relativeY + ')')
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())

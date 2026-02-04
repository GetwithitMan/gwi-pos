/**
 * Test script to verify perimeter seat distribution logic
 * Run: npx tsx scripts/test-perimeter.ts
 */

import { distributeSeatsOnPerimeter, getGroupBoundingBox } from '../src/lib/table-geometry'

// Simulate two tables stacked vertically (like Table 15 + Table 16)
const groupRects = [
  {
    id: 'table-top',
    posX: 284,
    posY: 200, // Top table
    width: 80,
    height: 80,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 'table-bottom',
    posX: 284,
    posY: 280, // Bottom table (flush with top)
    width: 80,
    height: 80,
    combinedWithId: null,
    combinedTableIds: null,
  },
]

console.log('=== Perimeter Distribution Test ===\n')

// Print table info
console.log('Tables:')
groupRects.forEach(t => {
  const cx = t.posX + t.width / 2
  const cy = t.posY + t.height / 2
  console.log(`  ${t.id}: pos=(${t.posX}, ${t.posY}), center=(${cx}, ${cy}), size=${t.width}x${t.height}`)
})

// Get bounding box
const bounds = getGroupBoundingBox(groupRects)
console.log('\nBounding box:', bounds)
console.log(`  Combined perimeter: X=${bounds?.minX}-${bounds?.maxX}, Y=${bounds?.minY}-${bounds?.maxY}`)

// Distribute 8 seats (4 per table)
const seatCount = 8
const positions = distributeSeatsOnPerimeter(groupRects, seatCount)

console.log(`\nSeat positions (${positions.length} seats):`)
positions.forEach((pos, i) => {
  // Determine which table this seat should render relative to
  // In reality, seats stay with their original table, but for visualization:
  const worldX = Math.round(pos.x)
  const worldY = Math.round(pos.y)

  // Determine which side of the perimeter
  let side = ''
  if (bounds) {
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const dx = worldX - centerX
    const dy = worldY - centerY

    if (Math.abs(dx) > Math.abs(dy)) {
      side = dx > 0 ? 'RIGHT' : 'LEFT'
    } else {
      side = dy > 0 ? 'BOTTOM' : 'TOP'
    }
  }

  console.log(`  Seat ${i + 1}: world=(${worldX}, ${worldY}) - ${side}`)
})

// Calculate what relative positions would be for each table
console.log('\nRelative positions (if assigning to tables):')
const tableTop = groupRects[0]
const tableBottom = groupRects[1]
const topCenterX = tableTop.posX + tableTop.width / 2
const topCenterY = tableTop.posY + tableTop.height / 2
const bottomCenterX = tableBottom.posX + tableBottom.width / 2
const bottomCenterY = tableBottom.posY + tableBottom.height / 2

positions.forEach((pos, i) => {
  // Assign first 4 seats to top table, last 4 to bottom (simplified)
  const isTopTable = i < 4
  const cx = isTopTable ? topCenterX : bottomCenterX
  const cy = isTopTable ? topCenterY : bottomCenterY
  const relX = Math.round(pos.x - cx)
  const relY = Math.round(pos.y - cy)
  const tableName = isTopTable ? 'table-top' : 'table-bottom'

  console.log(`  Seat ${i + 1} (${tableName}): relative=(${relX}, ${relY})`)
})

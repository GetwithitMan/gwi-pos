/**
 * Test script to verify perimeter tracing for L-shaped table groups
 * Run: npx tsx scripts/test-perimeter-lshape.ts
 */

import { distributeSeatsOnPerimeter, getGroupBoundingBox } from '../src/lib/table-geometry'

// Simulate an L-shape:
//   [T1][T2]
//   [T3]
const groupRects = [
  {
    id: 'table-1',
    posX: 100,
    posY: 100,
    width: 80,
    height: 80,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 'table-2',
    posX: 180, // Right of T1
    posY: 100,
    width: 80,
    height: 80,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 'table-3',
    posX: 100, // Below T1
    posY: 180,
    width: 80,
    height: 80,
    combinedWithId: null,
    combinedTableIds: null,
  },
]

console.log('=== L-Shape Perimeter Test ===\n')
console.log('Layout:')
console.log('  [T1][T2]')
console.log('  [T3]')
console.log('')

// Print table info
console.log('Tables:')
groupRects.forEach(t => {
  console.log(`  ${t.id}: pos=(${t.posX}, ${t.posY}), size=${t.width}x${t.height}`)
})

// Get bounding box
const bounds = getGroupBoundingBox(groupRects)
console.log('\nBounding box:', bounds)

// Distribute 12 seats (4 per table)
const seatCount = 12
const positions = distributeSeatsOnPerimeter(groupRects, seatCount)

console.log(`\nSeat positions (${positions.length} seats):`)
positions.forEach((pos, i) => {
  const worldX = Math.round(pos.x)
  const worldY = Math.round(pos.y)

  // Determine which side
  let side = ''
  if (bounds) {
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2

    // More precise side detection for L-shape
    if (worldY < bounds.minY + 20) side = 'TOP'
    else if (worldY > bounds.maxY - 20) side = 'BOTTOM'
    else if (worldX > bounds.maxX - 20) side = 'RIGHT'
    else if (worldX < bounds.minX + 20) side = 'LEFT'
    else side = 'INNER' // The inside corner of the L
  }

  console.log(`  Seat ${String(i + 1).padStart(2)}: world=(${worldX}, ${worldY}) - ${side}`)
})

console.log('\n✓ Seats should go continuously around the L-shape perimeter')
console.log('✓ No seats should be in the "pocket" (where T2 and T3 don\'t meet)')

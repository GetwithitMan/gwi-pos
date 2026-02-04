/**
 * Test script for staggered/misaligned tables like the user's scenario
 * Run: npx tsx scripts/test-perimeter-staggered.ts
 */

import { distributeSeatsOnPerimeter, getGroupBoundingBox } from '../src/lib/table-geometry'

// Simulate the user's staggered tables:
// t1 at (200, 100), t2 at (310, 120), t4 at (420, 160)
// These are NOT flush - they have Y offsets
const groupRects = [
  {
    id: 't1',
    posX: 200,
    posY: 100,
    width: 110,
    height: 110,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 't2',
    posX: 310,
    posY: 120,
    width: 110,
    height: 110,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 't4',
    posX: 420,
    posY: 160,
    width: 110,
    height: 110,
    combinedWithId: null,
    combinedTableIds: null,
  },
]

console.log('=== Staggered Tables Perimeter Test ===\n')
console.log('Layout (not flush - staggered Y positions):')
console.log('  t1 at y=100')
console.log('    t2 at y=120 (20px lower)')
console.log('      t4 at y=160 (40px lower)')
console.log('')

// Print table info
console.log('Tables:')
groupRects.forEach(t => {
  console.log(`  ${t.id}: pos=(${t.posX}, ${t.posY}), size=${t.width}x${t.height}`)
  console.log(`       edges: top y=${t.posY}, bottom y=${t.posY + t.height}, left x=${t.posX}, right x=${t.posX + t.width}`)
})

// Get bounding box
const bounds = getGroupBoundingBox(groupRects)
console.log('\nBounding box:', bounds)

// Distribute 12 seats (4 per table)
const seatCount = 12
const positions = distributeSeatsOnPerimeter(groupRects, seatCount)

console.log(`\n=== Seat positions (${positions.length} seats) ===`)
if (positions.length > 0) {
  positions.forEach((pos, i) => {
    console.log(`  Seat ${String(i + 1).padStart(2)}: (${Math.round(pos.x)}, ${Math.round(pos.y)})`)
  })

  // Check if seats are all on same Y (stacked on top)
  const yValues = positions.map(p => Math.round(p.y))
  const uniqueYs = [...new Set(yValues)]
  console.log('\nUnique Y values:', uniqueYs.length)
  if (uniqueYs.length === 1) {
    console.log('⚠️  WARNING: All seats have same Y - they are stacked horizontally!')
  } else {
    console.log('✓ Seats have varying Y values - distributed around perimeter')
  }
}

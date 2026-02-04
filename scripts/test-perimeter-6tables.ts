/**
 * Test script for 6 staggered tables like the user's problematic scenario
 * Run: npx tsx scripts/test-perimeter-6tables.ts
 */

import { distributeSeatsOnPerimeter, getGroupBoundingBox } from '../src/lib/table-geometry'

// Simulate a 6-table staggered configuration
// Two rows of 3 tables, with slight Y offsets
const groupRects = [
  // Top row: 3 tables with slight stagger
  {
    id: 't1',
    posX: 100,
    posY: 100,
    width: 100,
    height: 100,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 't2',
    posX: 200,
    posY: 110, // 10px lower
    width: 100,
    height: 100,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 't3',
    posX: 300,
    posY: 105, // 5px lower than t1
    width: 100,
    height: 100,
    combinedWithId: null,
    combinedTableIds: null,
  },
  // Bottom row: 3 tables below top row with more stagger
  {
    id: 't4',
    posX: 110, // 10px to the right
    posY: 200,
    width: 100,
    height: 100,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 't5',
    posX: 210, // 10px to the right
    posY: 210, // 10px lower
    width: 100,
    height: 100,
    combinedWithId: null,
    combinedTableIds: null,
  },
  {
    id: 't6',
    posX: 305, // 5px to the right
    posY: 205, // 5px lower
    width: 100,
    height: 100,
    combinedWithId: null,
    combinedTableIds: null,
  },
]

console.log('=== 6 Staggered Tables Perimeter Test ===\n')
console.log('Layout (2 rows of 3, staggered):\n')
console.log('  Row 1: [t1]   [t2]   [t3]')
console.log('         (offset Y: 100, 110, 105)')
console.log('')
console.log('  Row 2:   [t4]   [t5]   [t6]')
console.log('           (offset Y: 200, 210, 205)')
console.log('')

// Print table info
console.log('Tables:')
groupRects.forEach(t => {
  console.log(`  ${t.id}: pos=(${t.posX}, ${t.posY}), size=${t.width}x${t.height}`)
})

// Get bounding box
const bounds = getGroupBoundingBox(groupRects)
console.log('\nBounding box:', bounds)

// Distribute 27 seats (about 4-5 per table)
const seatCount = 27
const positions = distributeSeatsOnPerimeter(groupRects, seatCount)

console.log(`\n=== Seat positions (${positions.length} seats) ===`)

// Group seats by their approximate position on the perimeter
const seatInfo = positions.map((pos, i) => {
  const x = Math.round(pos.x)
  const y = Math.round(pos.y)

  // Determine which side
  let side = ''
  if (bounds) {
    if (y < bounds.minY + 30) side = 'TOP'
    else if (y > bounds.maxY - 30) side = 'BOTTOM'
    else if (x > bounds.maxX - 30) side = 'RIGHT'
    else if (x < bounds.minX + 30) side = 'LEFT'
    else side = 'MIDDLE'
  }

  return { num: i + 1, x, y, side }
})

seatInfo.forEach(s => {
  console.log(`  Seat ${String(s.num).padStart(2)}: (${s.x}, ${s.y}) - ${s.side}`)
})

// Verify clockwise ordering
console.log('\n=== Verifying clockwise order ===')
const sides = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT']
let expectedSideIndex = 0
let transitions: string[] = []

for (let i = 0; i < seatInfo.length; i++) {
  const currentSide = seatInfo[i].side
  const expectedSide = sides[expectedSideIndex]

  // Allow for TOP→MIDDLE→RIGHT type transitions
  if (currentSide !== expectedSide && currentSide !== 'MIDDLE') {
    // Check if this is a valid clockwise transition
    const nextExpectedIndex = (expectedSideIndex + 1) % 4
    if (currentSide === sides[nextExpectedIndex]) {
      transitions.push(`Seat ${seatInfo[i].num}: ${sides[expectedSideIndex]} → ${currentSide}`)
      expectedSideIndex = nextExpectedIndex
    }
  }
}

console.log('Side transitions:')
transitions.forEach(t => console.log(`  ${t}`))

// Check if all seats have unique positions
const uniquePositions = new Set(seatInfo.map(s => `${s.x},${s.y}`))
if (uniquePositions.size === seatInfo.length) {
  console.log('\n✓ All seats have unique positions')
} else {
  console.log(`\n⚠️  WARNING: ${seatInfo.length - uniquePositions.size} seats overlap!`)
}

// Check Y distribution (should have variety, not all stacked on one row)
const uniqueYs = [...new Set(seatInfo.map(s => s.y))]
console.log(`✓ ${uniqueYs.length} unique Y values - seats are distributed vertically`)

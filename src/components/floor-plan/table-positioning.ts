/**
 * Table Positioning Utilities
 * Handles magnetic attachment, collision detection, and auto-shift logic
 */

// Minimum gap between tables (px)
const TABLE_GAP = 12

export type AttachSide = 'left' | 'right' | 'top' | 'bottom'

export interface TableRect {
  id: string
  posX: number
  posY: number
  width: number
  height: number
}

/**
 * Determine which side to attach based on drop position relative to target center
 * Normalizes by table dimensions so wide tables can still attach on top/bottom
 */
export function calculateAttachSide(
  dropX: number,
  dropY: number,
  target: TableRect
): AttachSide {
  const targetCenterX = target.posX + target.width / 2
  const targetCenterY = target.posY + target.height / 2

  const dx = dropX - targetCenterX
  const dy = dropY - targetCenterY

  // Normalize by table dimensions to make top/bottom attachment easier for wide tables
  // This creates equal-sized zones relative to the table's aspect ratio
  const normalizedDx = Math.abs(dx) / (target.width / 2)
  const normalizedDy = Math.abs(dy) / (target.height / 2)

  if (normalizedDx > normalizedDy) {
    // Horizontal attachment
    return dx > 0 ? 'right' : 'left'
  } else {
    // Vertical attachment
    return dy > 0 ? 'bottom' : 'top'
  }
}

/**
 * Calculate the position for a table when attaching to a side
 * Aligns edges flush (not centered) for clean magnetic attachment
 */
export function calculateAttachPosition(
  source: TableRect,
  target: TableRect,
  side: AttachSide
): { posX: number; posY: number } {
  switch (side) {
    case 'right':
      return {
        posX: target.posX + target.width + TABLE_GAP,
        posY: target.posY, // Align top edges
      }
    case 'left':
      return {
        posX: target.posX - source.width - TABLE_GAP,
        posY: target.posY, // Align top edges
      }
    case 'bottom':
      return {
        posX: target.posX, // Align left edges
        posY: target.posY + target.height + TABLE_GAP,
      }
    case 'top':
      return {
        posX: target.posX, // Align left edges
        posY: target.posY - source.height - TABLE_GAP,
      }
  }
}

/**
 * Check if two rectangles overlap (with gap consideration)
 */
export function tablesOverlap(a: TableRect, b: TableRect, gap: number = 0): boolean {
  return !(
    a.posX + a.width + gap <= b.posX ||
    b.posX + b.width + gap <= a.posX ||
    a.posY + a.height + gap <= b.posY ||
    b.posY + b.height + gap <= a.posY
  )
}

/**
 * Find all tables that collide with a given table
 */
export function findCollidingTables(
  table: TableRect,
  allTables: TableRect[],
  excludeIds: string[] = []
): TableRect[] {
  return allTables.filter(
    (t) =>
      t.id !== table.id &&
      !excludeIds.includes(t.id) &&
      tablesOverlap(table, t, TABLE_GAP)
  )
}

/**
 * Find a non-overlapping position for a table
 * Tries original position first, then shifts in small increments
 */
export function findNonOverlappingPosition(
  table: TableRect,
  allTables: TableRect[],
  excludeIds: string[] = [],
  maxShift: number = 200
): { posX: number; posY: number } {
  const otherTables = allTables.filter(
    (t) => t.id !== table.id && !excludeIds.includes(t.id)
  )

  // Check if original position is fine
  if (!otherTables.some((t) => tablesOverlap(table, t, TABLE_GAP))) {
    return { posX: table.posX, posY: table.posY }
  }

  // Try shifting in a spiral pattern
  const shiftIncrement = 20
  for (let distance = shiftIncrement; distance <= maxShift; distance += shiftIncrement) {
    // Try each direction
    const directions = [
      { dx: distance, dy: 0 },      // right
      { dx: -distance, dy: 0 },     // left
      { dx: 0, dy: distance },      // down
      { dx: 0, dy: -distance },     // up
      { dx: distance, dy: distance },    // diagonal
      { dx: -distance, dy: distance },
      { dx: distance, dy: -distance },
      { dx: -distance, dy: -distance },
    ]

    for (const { dx, dy } of directions) {
      const testRect: TableRect = {
        ...table,
        posX: table.posX + dx,
        posY: table.posY + dy,
      }

      // Ensure position is valid (not negative)
      if (testRect.posX < 0 || testRect.posY < 0) continue

      if (!otherTables.some((t) => tablesOverlap(testRect, t, TABLE_GAP))) {
        return { posX: testRect.posX, posY: testRect.posY }
      }
    }
  }

  // If no position found, return original (shouldn't happen often)
  return { posX: table.posX, posY: table.posY }
}

/**
 * Shift colliding tables to make room for a new table placement
 * Returns a map of tableId -> new position
 */
export function shiftCollidingTables(
  newTable: TableRect,
  allTables: TableRect[],
  excludeIds: string[] = [],
  maxIterations: number = 5
): Map<string, { posX: number; posY: number }> {
  const shifts = new Map<string, { posX: number; posY: number }>()
  const processed = new Set<string>([...excludeIds, newTable.id])

  let tablesToCheck = [newTable]
  let iteration = 0

  while (tablesToCheck.length > 0 && iteration < maxIterations) {
    iteration++
    const nextBatch: TableRect[] = []

    for (const checkTable of tablesToCheck) {
      const collisions = findCollidingTables(checkTable, allTables, [...processed])

      for (const collision of collisions) {
        // Calculate push direction (away from the checking table)
        const dx = collision.posX + collision.width / 2 - (checkTable.posX + checkTable.width / 2)
        const dy = collision.posY + collision.height / 2 - (checkTable.posY + checkTable.height / 2)

        // Normalize and apply minimum shift
        const distance = Math.sqrt(dx * dx + dy * dy) || 1
        const shiftAmount = TABLE_GAP + 10 // Shift enough to create gap

        const shiftX = (dx / distance) * shiftAmount
        const shiftY = (dy / distance) * shiftAmount

        const newPos = {
          posX: Math.max(0, Math.round(collision.posX + shiftX)),
          posY: Math.max(0, Math.round(collision.posY + shiftY)),
        }

        shifts.set(collision.id, newPos)
        processed.add(collision.id)

        // Add to next batch to check for cascading collisions
        nextBatch.push({
          ...collision,
          posX: newPos.posX,
          posY: newPos.posY,
        })
      }
    }

    tablesToCheck = nextBatch
  }

  return shifts
}

export interface SeatPosition {
  seatNumber: number
  x: number  // Absolute position
  y: number
  angle: number  // Rotation angle for the seat indicator
}

// Seat patterns for partial coverage
export type SeatPattern =
  | 'all_around'    // Default - seats on all sides
  | 'front_only'    // Bar/counter style - seats on one side
  | 'back_only'     // Rare - seats behind
  | 'three_sides'   // Against wall - no seats on one side
  | 'two_sides'     // Corner booth - seats on two adjacent sides
  | 'inside'        // Booth interior - seats inside the table

// Arc configuration for seat distribution
export interface SeatArc {
  startAngle: number  // 0 = top, 90 = right, 180 = bottom, 270 = left
  endAngle: number
}

// Get arc configuration for a seat pattern
function getArcForPattern(pattern: SeatPattern): SeatArc {
  switch (pattern) {
    case 'front_only':
      return { startAngle: 135, endAngle: 225 } // Bottom side only
    case 'back_only':
      return { startAngle: 315, endAngle: 45 } // Top side only
    case 'three_sides':
      return { startAngle: 45, endAngle: 315 } // All except top (against wall)
    case 'two_sides':
      return { startAngle: 90, endAngle: 270 } // Right and bottom (corner)
    case 'inside':
    case 'all_around':
    default:
      return { startAngle: 0, endAngle: 360 }
  }
}

/**
 * Calculate seat positions around a table edge
 * Supports different patterns: all_around, front_only, three_sides, etc.
 */
export function calculateSeatPositions(
  table: {
    posX: number
    posY: number
    width: number
    height: number
    shape: string
  },
  seatCount: number,
  pattern: SeatPattern = 'all_around'
): SeatPosition[] {
  const positions: SeatPosition[] = []

  if (seatCount === 0) return positions

  const centerX = table.posX + table.width / 2
  const centerY = table.posY + table.height / 2
  const padding = 20 // Distance from table edge

  if (pattern === 'inside') {
    // Booth-style: seats distributed inside the table
    const innerPadding = 15
    const availableWidth = table.width - innerPadding * 2
    const spacing = seatCount > 1 ? availableWidth / (seatCount - 1) : 0

    for (let i = 0; i < seatCount; i++) {
      positions.push({
        seatNumber: i + 1,
        x: table.posX + innerPadding + (seatCount > 1 ? i * spacing : availableWidth / 2),
        y: table.posY + table.height * 0.35, // Upper portion of booth
        angle: 180, // Facing down/out
      })
    }
    return positions
  }

  if (table.shape === 'circle') {
    // Circle tables: seats distributed evenly around circumference within arc
    const arc = getArcForPattern(pattern)
    const radius = Math.max(table.width, table.height) / 2 + padding

    const startRad = (arc.startAngle * Math.PI) / 180
    const endRad = (arc.endAngle * Math.PI) / 180
    const arcLength = arc.endAngle > arc.startAngle
      ? endRad - startRad
      : (2 * Math.PI) - startRad + endRad

    const angleStep = seatCount > 1 ? arcLength / (seatCount - 1) : 0

    for (let i = 0; i < seatCount; i++) {
      const angle = startRad + i * angleStep - Math.PI / 2 // Offset so 0 = top
      positions.push({
        seatNumber: i + 1,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        angle: (angle * 180) / Math.PI + 90, // Point toward center
      })
    }
    return positions
  }

  // Rectangle/square tables: distribute seats around perimeter based on pattern
  const arc = getArcForPattern(pattern)

  // Calculate which sides are included in the arc
  const includedSides: Array<'top' | 'right' | 'bottom' | 'left'> = []
  const sideRanges = [
    { side: 'top' as const, start: 315, end: 45 },
    { side: 'right' as const, start: 45, end: 135 },
    { side: 'bottom' as const, start: 135, end: 225 },
    { side: 'left' as const, start: 225, end: 315 },
  ]

  for (const { side, start, end } of sideRanges) {
    // Check if this side overlaps with the arc
    const arcStart = arc.startAngle
    const arcEnd = arc.endAngle === 360 ? 360 : arc.endAngle

    // Handle wrap-around
    const sideInArc = arcEnd >= arcStart
      ? (start < arcEnd && end > arcStart) || (start < arcEnd && start >= arcStart) || (end > arcStart && end <= arcEnd)
      : (start >= arcStart || start < arcEnd) || (end > arcStart || end <= arcEnd)

    if (sideInArc || arc.endAngle === 360) {
      includedSides.push(side)
    }
  }

  // If no sides included, default to all
  if (includedSides.length === 0) {
    includedSides.push('top', 'right', 'bottom', 'left')
  }

  // Calculate perimeter of included sides
  let totalPerimeter = 0
  for (const side of includedSides) {
    totalPerimeter += (side === 'top' || side === 'bottom') ? table.width : table.height
  }

  // Distribute seats evenly along included perimeter
  const spacing = totalPerimeter / seatCount
  let currentDistance = spacing / 2 // Start offset

  for (let i = 0; i < seatCount; i++) {
    let distanceAccum = 0
    let x = 0, y = 0, angle = 0

    for (const side of includedSides) {
      const sideLength = (side === 'top' || side === 'bottom') ? table.width : table.height
      const nextAccum = distanceAccum + sideLength

      if (currentDistance <= nextAccum) {
        const posOnSide = currentDistance - distanceAccum

        switch (side) {
          case 'top':
            x = table.posX + posOnSide
            y = table.posY - padding
            angle = 0
            break
          case 'right':
            x = table.posX + table.width + padding
            y = table.posY + posOnSide
            angle = 90
            break
          case 'bottom':
            x = table.posX + table.width - posOnSide
            y = table.posY + table.height + padding
            angle = 180
            break
          case 'left':
            x = table.posX - padding
            y = table.posY + table.height - posOnSide
            angle = 270
            break
        }
        break
      }
      distanceAccum = nextAccum
    }

    positions.push({ seatNumber: i + 1, x, y, angle })
    currentDistance += spacing
    if (currentDistance > totalPerimeter) {
      currentDistance -= totalPerimeter
    }
  }

  return positions
}


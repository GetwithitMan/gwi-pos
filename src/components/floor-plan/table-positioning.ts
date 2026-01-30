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

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal attachment
    return dx > 0 ? 'right' : 'left'
  } else {
    // Vertical attachment
    return dy > 0 ? 'bottom' : 'top'
  }
}

/**
 * Calculate the position for a table when attaching to a side
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
        posY: target.posY + (target.height - source.height) / 2, // Center vertically
      }
    case 'left':
      return {
        posX: target.posX - source.width - TABLE_GAP,
        posY: target.posY + (target.height - source.height) / 2,
      }
    case 'bottom':
      return {
        posX: target.posX + (target.width - source.width) / 2, // Center horizontally
        posY: target.posY + target.height + TABLE_GAP,
      }
    case 'top':
      return {
        posX: target.posX + (target.width - source.width) / 2,
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

/**
 * Calculate seat positions around a table edge
 * For regular tables: seats distributed around the perimeter
 * For booths: seats along the inner curved edge
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
  isBooth: boolean = false
): SeatPosition[] {
  const positions: SeatPosition[] = []

  if (seatCount === 0) return positions

  const centerX = table.posX + table.width / 2
  const centerY = table.posY + table.height / 2

  if (isBooth) {
    // Booths: seats distributed along the inner back edge (horizontal line inside)
    const padding = 15
    const availableWidth = table.width - padding * 2
    const spacing = seatCount > 1 ? availableWidth / (seatCount - 1) : 0

    for (let i = 0; i < seatCount; i++) {
      positions.push({
        seatNumber: i + 1,
        x: table.posX + padding + (seatCount > 1 ? i * spacing : availableWidth / 2),
        y: table.posY + table.height * 0.3, // Upper portion of booth
        angle: 0,
      })
    }
  } else if (table.shape === 'circle') {
    // Circle tables: seats distributed evenly around circumference
    const radius = Math.max(table.width, table.height) / 2 + 18 // Outside edge
    const angleStep = (2 * Math.PI) / seatCount

    for (let i = 0; i < seatCount; i++) {
      const angle = angleStep * i - Math.PI / 2 // Start at top
      positions.push({
        seatNumber: i + 1,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        angle: (angle * 180) / Math.PI + 90, // Point toward center
      })
    }
  } else {
    // Rectangle/square tables: seats distributed around perimeter
    // Prioritize sides based on table orientation
    const padding = 18

    if (seatCount <= 4) {
      // 1-4 seats: one per side, starting top
      const sidePositions = [
        { x: centerX, y: table.posY - padding, angle: 0 },                    // top
        { x: table.posX + table.width + padding, y: centerY, angle: 90 },     // right
        { x: centerX, y: table.posY + table.height + padding, angle: 180 },   // bottom
        { x: table.posX - padding, y: centerY, angle: 270 },                  // left
      ]

      for (let i = 0; i < seatCount; i++) {
        positions.push({
          seatNumber: i + 1,
          ...sidePositions[i],
        })
      }
    } else {
      // 5+ seats: distribute evenly around perimeter
      const perimeter = 2 * (table.width + table.height)
      const spacing = perimeter / seatCount

      for (let i = 0; i < seatCount; i++) {
        const distance = i * spacing
        let x: number, y: number, angle: number

        if (distance < table.width / 2) {
          // Top edge, left of center
          x = centerX - (table.width / 2 - distance)
          y = table.posY - padding
          angle = 0
        } else if (distance < table.width / 2 + table.height) {
          // Right edge
          x = table.posX + table.width + padding
          y = table.posY + (distance - table.width / 2)
          angle = 90
        } else if (distance < table.width * 1.5 + table.height) {
          // Bottom edge
          x = table.posX + table.width - (distance - table.width / 2 - table.height)
          y = table.posY + table.height + padding
          angle = 180
        } else {
          // Left edge
          x = table.posX - padding
          y = table.posY + table.height - (distance - table.width * 1.5 - table.height)
          angle = 270
        }

        positions.push({ seatNumber: i + 1, x, y, angle })
      }
    }
  }

  return positions
}

/**
 * Calculate seat positions for a combined table group
 * Distributes seats around the combined bounding box
 */
export function calculateCombinedSeatPositions(
  tables: Array<{
    posX: number
    posY: number
    width: number
    height: number
    capacity: number
  }>
): SeatPosition[] {
  if (tables.length === 0) return []

  // Calculate combined bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let totalCapacity = 0

  for (const t of tables) {
    minX = Math.min(minX, t.posX)
    minY = Math.min(minY, t.posY)
    maxX = Math.max(maxX, t.posX + t.width)
    maxY = Math.max(maxY, t.posY + t.height)
    totalCapacity += t.capacity
  }

  // Create a virtual combined table
  const combinedTable = {
    posX: minX,
    posY: minY,
    width: maxX - minX,
    height: maxY - minY,
    shape: 'rectangle',
  }

  return calculateSeatPositions(combinedTable, totalCapacity, false)
}

/**
 * Get the bounding box that contains all combined tables
 */
export function getCombinedBoundingBox(tables: TableRect[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} {
  if (tables.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }

  const minX = Math.min(...tables.map((t) => t.posX))
  const minY = Math.min(...tables.map((t) => t.posY))
  const maxX = Math.max(...tables.map((t) => t.posX + t.width))
  const maxY = Math.max(...tables.map((t) => t.posY + t.height))

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

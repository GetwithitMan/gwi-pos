/**
 * Table Geometry Utilities for Combined Table Groups
 *
 * Provides helpers for:
 * - Finding exposed edges of tables in combined groups
 * - Building SVG perimeter paths for non-rectangular shapes (T, L, U)
 * - Distributing seats along the true perimeter
 * - Allowing table placement in "pockets" of combined shapes
 * - Magnetic snapping for edge-to-edge docking
 */

export type Point = { x: number; y: number }

/** Snap distance in pixels - how close before magnetic snap activates */
const SNAP_DISTANCE = 15

/** Grid size for coordinate normalization - prevents floating point errors */
const GRID_SIZE = 4

/**
 * Normalize a coordinate to the nearest grid point.
 * This prevents floating point errors that can cause false collisions
 * (e.g., 100.0001 !== 100 causing edges to not align properly).
 *
 * IMPORTANT: Guards against null/undefined/NaN to prevent "wild" table movements
 * where tables fly to 0,0 during split or state transitions.
 *
 * @param coord - The coordinate to normalize (handles null/undefined/NaN safely)
 * @param gridSize - Grid size (default 4px)
 * @returns Normalized coordinate snapped to grid, or safe fallback (100) if invalid
 */
export function normalizeCoord(coord: number | undefined | null, gridSize: number = GRID_SIZE): number {
  // Guard: if coord is missing or invalid, return a safe fallback
  // This prevents tables from flying to 0,0 during split/combine transitions
  if (coord === undefined || coord === null || isNaN(coord)) {
    console.warn('[normalizeCoord] Invalid coordinate received, using safe fallback:', coord)
    return 100 // Safe margin from edge
  }
  return Math.round(coord / gridSize) * gridSize
}

export type Edge = {
  start: Point
  end: Point
  side: 'top' | 'right' | 'bottom' | 'left'
  tableId: string
}

export interface TableRect {
  id: string
  posX: number
  posY: number
  width: number
  height: number
  combinedWithId?: string | null
  combinedTableIds?: string[] | null
}

/**
 * Returns only the edges of a table that are NOT covered by another table in the same group.
 * This allows us to trace the true perimeter of T, L, U shaped combined tables.
 *
 * IMPORTANT: This function handles THREE cases:
 * 1. Overlap Check - Midpoint inside another rect = interior edge (hide it)
 * 2. Flush Adjacency Check - Flush + overlapping span = shared outer edge (hide it)
 * 3. T-Bone Guard - Tiny edges (<40px) from rounding/small overlaps = visual noise (hide it)
 *
 * @param targetTable - The table to find exposed edges for
 * @param allGroupTables - All tables in the combined group
 * @returns Array of exposed edges in local coordinates
 */
export function getExposedEdges(
  targetTable: TableRect,
  allGroupTables: TableRect[]
): Edge[] {
  // Early return for single table (no other tables to check against)
  if (allGroupTables.length === 0) return []

  console.log(`[getExposedEdges] Checking table ${targetTable.id} at (${targetTable.posX}, ${targetTable.posY}) size ${targetTable.width}x${targetTable.height}`)
  console.log(`[getExposedEdges] Against ${allGroupTables.length} tables in group`)

  const localEdges: Omit<Edge, 'tableId'>[] = [
    { start: { x: 0, y: 0 }, end: { x: targetTable.width, y: 0 }, side: 'top' },
    { start: { x: targetTable.width, y: 0 }, end: { x: targetTable.width, y: targetTable.height }, side: 'right' },
    { start: { x: targetTable.width, y: targetTable.height }, end: { x: 0, y: targetTable.height }, side: 'bottom' },
    { start: { x: 0, y: targetTable.height }, end: { x: 0, y: 0 }, side: 'left' },
  ]

  const result = localEdges
    .map(edge => ({ ...edge, tableId: targetTable.id }))
    .filter(edge => {
      const midX = targetTable.posX + (edge.start.x + edge.end.x) / 2
      const midY = targetTable.posY + (edge.start.y + edge.end.y) / 2

      // 1) Hide edges whose midpoint is inside another table
      // Buffer of 0.5px handles floating point edge cases
      const isInside = allGroupTables.some(other => {
        if (other.id === targetTable.id) return false
        const buffer = 0.5
        return (
          midX >= other.posX - buffer &&
          midX <= other.posX + other.width + buffer &&
          midY >= other.posY - buffer &&
          midY <= other.posY + other.height + buffer
        )
      })
      if (isInside) {
        console.log(`[getExposedEdges] ${edge.side} edge REJECTED (midpoint inside another table)`)
        return false
      }

      // 2) Hide edges that are perfectly flush with another table
      let isFlush = false
      const targetRight = targetTable.posX + targetTable.width
      const targetBottom = targetTable.posY + targetTable.height

      for (const other of allGroupTables) {
        if (other.id === targetTable.id) continue

        const otherRight = other.posX + other.width
        const otherBottom = other.posY + other.height

        switch (edge.side) {
          case 'top': {
            const sameY = targetTable.posY === otherBottom
            const overlap = targetTable.posX < otherRight && targetRight > other.posX
            if (sameY && overlap) isFlush = true
            break
          }
          case 'bottom': {
            const sameY = targetBottom === other.posY
            const overlap = targetTable.posX < otherRight && targetRight > other.posX
            if (sameY && overlap) isFlush = true
            break
          }
          case 'left': {
            const sameX = targetTable.posX === otherRight
            const overlap = targetTable.posY < otherBottom && targetBottom > other.posY
            if (sameX && overlap) isFlush = true
            break
          }
          case 'right': {
            const sameX = targetRight === other.posX
            const overlap = targetTable.posY < otherBottom && targetBottom > other.posY
            if (sameX && overlap) isFlush = true
            break
          }
        }

        if (isFlush) break
      }

      if (isFlush) {
        console.log(`[getExposedEdges] ${edge.side} edge REJECTED (flush with another table)`)
        return false
      }

      // 3) Ignore tiny edges that can cause visual noise in complex shapes
      // These often appear at small overlaps/rounding; dropping them keeps the perimeter clean
      const length = Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y)
      if (length < 40) {
        console.log(`[getExposedEdges] ${edge.side} edge REJECTED (too short: ${length}px)`)
        return false
      }

      console.log(`[getExposedEdges] ${edge.side} edge KEPT (length: ${length}px)`)
      return true
    })

  console.log(`[getExposedEdges] Result: ${result.length} exposed edges for table ${targetTable.id}`)
  return result
}

/**
 * Builds a single SVG path string from all exposed edges of the group.
 * This creates the visual outline for T, L, U shaped combined tables.
 *
 * @param groupTables - All tables in the combined group
 * @returns SVG path data string
 */
export function buildGroupPerimeterPath(groupTables: TableRect[]): string {
  if (groupTables.length === 0) return ''

  const segments: string[] = []

  groupTables.forEach(table => {
    const edges = getExposedEdges(table, groupTables)
    edges.forEach(edge => {
      const x1 = table.posX + edge.start.x
      const y1 = table.posY + edge.start.y
      const x2 = table.posX + edge.end.x
      const y2 = table.posY + edge.end.y
      segments.push(`M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`)
    })
  })

  return segments.join(' ')
}

/**
 * Builds a closed polygon path for the combined group perimeter.
 * This is used for filling the shape with a background color.
 *
 * @param groupTables - All tables in the combined group
 * @returns SVG path data string for a closed polygon
 */
export function buildGroupPerimeterPolygon(groupTables: TableRect[]): string {
  if (groupTables.length === 0) return ''
  if (groupTables.length === 1) {
    // Single table - simple rectangle
    const t = groupTables[0]
    return `M${t.posX},${t.posY} L${t.posX + t.width},${t.posY} L${t.posX + t.width},${t.posY + t.height} L${t.posX},${t.posY + t.height} Z`
  }

  // For multiple tables, collect all corner points and try to build a polygon
  // This is a simplified approach - for complex shapes we fall back to the segment approach
  const allEdges: { x1: number; y1: number; x2: number; y2: number }[] = []

  groupTables.forEach(table => {
    const edges = getExposedEdges(table, groupTables)
    edges.forEach(edge => {
      allEdges.push({
        x1: table.posX + edge.start.x,
        y1: table.posY + edge.start.y,
        x2: table.posX + edge.end.x,
        y2: table.posY + edge.end.y,
      })
    })
  })

  if (allEdges.length === 0) return ''

  // Build path from connected edges
  const pathParts: string[] = []
  const used = new Set<number>()
  let currentEdge = allEdges[0]
  used.add(0)
  pathParts.push(`M${currentEdge.x1.toFixed(1)},${currentEdge.y1.toFixed(1)}`)
  pathParts.push(`L${currentEdge.x2.toFixed(1)},${currentEdge.y2.toFixed(1)}`)

  // Try to connect edges
  for (let i = 0; i < allEdges.length - 1; i++) {
    const endX = currentEdge.x2
    const endY = currentEdge.y2

    // Find next edge that starts where this one ends
    let foundNext = false
    for (let j = 0; j < allEdges.length; j++) {
      if (used.has(j)) continue
      const next = allEdges[j]
      const dist = Math.hypot(next.x1 - endX, next.y1 - endY)
      if (dist < 2) {
        // Close enough to be connected
        pathParts.push(`L${next.x2.toFixed(1)},${next.y2.toFixed(1)}`)
        currentEdge = next
        used.add(j)
        foundNext = true
        break
      }
    }

    if (!foundNext) break
  }

  pathParts.push('Z')
  return pathParts.join(' ')
}

interface WorldEdge {
  start: Point
  end: Point
  length: number
  tableId: string
  side: 'top' | 'right' | 'bottom' | 'left'  // Which side of the table this edge is on
}

/**
 * Distributes N points evenly along the total exposed perimeter length.
 * Used for positioning seats around the true edge of combined table groups.
 *
 * IMPORTANT: This function traces a CONNECTED PATH around the perimeter,
 * starting from the top-left corner and following edges as they connect.
 * This ensures seats are numbered 1, 2, 3... going continuously around
 * the shape without jumping across tables.
 *
 * @param groupTables - All tables in the combined group
 * @param seatCount - Number of seats to distribute
 * @returns Array of world coordinate positions for seats (in continuous order around perimeter)
 */
export function distributeSeatsOnPerimeter(
  groupTables: TableRect[],
  seatCount: number
): Point[] {
  if (seatCount < 1 || groupTables.length === 0) return []

  // Get bounding box for finding top-left start point
  const bounds = getGroupBoundingBox(groupTables)
  if (!bounds) return []
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  // Collect all exposed edges in world coordinates
  const worldEdges: WorldEdge[] = []

  groupTables.forEach(table => {
    const edges = getExposedEdges(table, groupTables)
    edges.forEach(e => {
      const sx = table.posX + e.start.x
      const sy = table.posY + e.start.y
      const ex = table.posX + e.end.x
      const ey = table.posY + e.end.y
      const len = Math.hypot(ex - sx, ey - sy)
      if (len > 0.1) {
        worldEdges.push({
          start: { x: sx, y: sy },
          end: { x: ex, y: ey },
          length: len,
          tableId: table.id,
          side: e.side,  // Pass through the side info for correct normal calculation
        })
      }
    })
  })

  if (worldEdges.length === 0) return []

  // Build a connected path by tracing edges
  // Start from the top-left most point and follow connected edges clockwise
  const orderedEdges = traceConnectedPerimeter(worldEdges, bounds)

  console.log('[distributeSeatsOnPerimeter] Traced path with', orderedEdges.length, 'edges')
  console.log('[distributeSeatsOnPerimeter] Path order:', orderedEdges.map(e =>
    `(${Math.round(e.start.x)},${Math.round(e.start.y)})->(${Math.round(e.end.x)},${Math.round(e.end.y)})`
  ))

  const totalLength = orderedEdges.reduce((sum, e) => sum + e.length, 0)
  if (totalLength < 1) return []

  // Offset from edge (seats sit slightly outside the perimeter)
  const seatOffset = 25

  // Calculate spacing between seats
  const spacing = totalLength / seatCount
  const positions: Point[] = []
  let distanceTravelled = spacing / 2 // Start half-spacing in for even distribution

  console.log('[distributeSeatsOnPerimeter] Distribution:', {
    totalPerimeter: Math.round(totalLength),
    seatCount,
    spacing: Math.round(spacing),
    startOffset: Math.round(spacing / 2),
    edgeLengths: orderedEdges.map(e => Math.round(e.length)),
  })

  // Walk along the connected path and place seats at regular intervals
  for (let edgeIndex = 0; edgeIndex < orderedEdges.length; edgeIndex++) {
    const edge = orderedEdges[edgeIndex]
    const edgeLength = edge.length
    const dx = edge.end.x - edge.start.x
    const dy = edge.end.y - edge.start.y

    // Determine outward normal based on which side of the table this edge is on
    // This is more reliable than center-based calculation for complex/staggered shapes
    let normalX = 0
    let normalY = 0

    switch (edge.side) {
      case 'top':
        // Top edge: seats go above (negative Y)
        normalX = 0
        normalY = -1
        break
      case 'bottom':
        // Bottom edge: seats go below (positive Y)
        normalX = 0
        normalY = 1
        break
      case 'left':
        // Left edge: seats go to the left (negative X)
        normalX = -1
        normalY = 0
        break
      case 'right':
        // Right edge: seats go to the right (positive X)
        normalX = 1
        normalY = 0
        break
    }

    const seatsOnThisEdge: number[] = []
    while (distanceTravelled < edgeLength + 0.001 && positions.length < seatCount) {
      const t = distanceTravelled / edgeLength
      // Position on edge
      const px = edge.start.x + dx * t
      const py = edge.start.y + dy * t
      // Offset outward from edge
      positions.push({
        x: px + normalX * seatOffset,
        y: py + normalY * seatOffset,
      })
      seatsOnThisEdge.push(positions.length)
      distanceTravelled += spacing
    }

    console.log(`[distributeSeatsOnPerimeter] Edge ${edgeIndex}: length=${Math.round(edgeLength)}, seats=[${seatsOnThisEdge.join(',')}], distAfter=${Math.round(distanceTravelled)}`)

    distanceTravelled -= edgeLength
  }

  // Safety: fill remaining positions if we somehow have fewer
  while (positions.length < seatCount) {
    const last = positions[positions.length - 1] || { x: 0, y: 0 }
    positions.push(last)
  }

  return positions.slice(0, seatCount)
}

/**
 * Traces a connected path around the perimeter in clockwise order.
 * Uses angle-based sorting from the centroid, starting from the top-left corner.
 *
 * Algorithm:
 * 1. Calculate centroid of all edges
 * 2. For each edge midpoint, calculate angle from centroid
 * 3. Find the edge closest to top-left corner
 * 4. Sort edges starting from that edge's angle, going clockwise
 * 5. This produces a natural clockwise ordering starting from top-left
 */
function traceConnectedPerimeter(
  edges: WorldEdge[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): WorldEdge[] {
  if (edges.length === 0) return []
  if (edges.length === 1) return edges

  // Calculate the centroid of the combined shape
  const centroidX = (bounds.minX + bounds.maxX) / 2
  const centroidY = (bounds.minY + bounds.maxY) / 2

  console.log('[traceConnectedPerimeter] Centroid:', `(${Math.round(centroidX)}, ${Math.round(centroidY)})`)
  console.log('[traceConnectedPerimeter] Bounds: top-left=(', bounds.minX, ',', bounds.minY, ')')

  // For each edge, calculate its midpoint and angle from centroid
  // We need to orient edges so they go in clockwise order around the perimeter
  const orientedEdges: WorldEdge[] = edges.map(e => {
    const midX = (e.start.x + e.end.x) / 2
    const midY = (e.start.y + e.end.y) / 2

    // Determine if edge needs to be reversed for clockwise traversal
    // For clockwise traversal, the edge should have the "outside" on the right
    // We can check this by seeing if going start→end, the centroid is on the left

    // Vector from edge start to end
    const edgeDx = e.end.x - e.start.x
    const edgeDy = e.end.y - e.start.y

    // Vector from edge start to centroid
    const toCenterDx = centroidX - e.start.x
    const toCenterDy = centroidY - e.start.y

    // Cross product: positive means centroid is on left (correct for clockwise)
    // negative means centroid is on right (need to reverse)
    const cross = edgeDx * toCenterDy - edgeDy * toCenterDx

    if (cross < 0) {
      // Reverse the edge direction for clockwise traversal
      return {
        ...e,
        start: e.end,
        end: e.start,
      }
    }
    return e
  })

  // Calculate angle from centroid to each edge's midpoint
  // Angle 0 = straight up (negative Y), increasing clockwise
  const edgesWithAngles = orientedEdges.map(e => {
    const midX = (e.start.x + e.end.x) / 2
    const midY = (e.start.y + e.end.y) / 2

    const dx = midX - centroidX
    const dy = midY - centroidY

    // Convert to clockwise angle from top (0 = top, PI/2 = right, PI = bottom, 3PI/2 = left)
    let angle = Math.atan2(dx, -dy)
    if (angle < 0) angle += 2 * Math.PI

    return { edge: e, angle, midX, midY }
  })

  // Find the starting angle: the angle to the top-left corner of the bounding box
  const topLeftDx = bounds.minX - centroidX
  const topLeftDy = bounds.minY - centroidY
  let startAngle = Math.atan2(topLeftDx, -topLeftDy)
  if (startAngle < 0) startAngle += 2 * Math.PI

  console.log('[traceConnectedPerimeter] Start angle (to top-left):', Math.round(startAngle * 180 / Math.PI), '°')

  // Adjust all angles relative to startAngle so we start from top-left
  const adjustedEdges = edgesWithAngles.map(e => {
    let adjustedAngle = e.angle - startAngle
    if (adjustedAngle < 0) adjustedAngle += 2 * Math.PI
    return { ...e, adjustedAngle }
  })

  // Sort by adjusted angle (now 0 = top-left, going clockwise)
  adjustedEdges.sort((a, b) => a.adjustedAngle - b.adjustedAngle)

  console.log('[traceConnectedPerimeter] Sorted edges (from top-left, clockwise):')
  adjustedEdges.forEach(({ edge, angle, adjustedAngle, midX, midY }, i) => {
    const degrees = Math.round(angle * 180 / Math.PI)
    const adjDegrees = Math.round(adjustedAngle * 180 / Math.PI)
    console.log(`  ${i}: adj=${adjDegrees}° (raw=${degrees}°) mid=(${Math.round(midX)},${Math.round(midY)}) ${edge.side} side`)
  })

  const orderedPath = adjustedEdges.map(({ edge }) => edge)

  console.log('[traceConnectedPerimeter] Final path length:', orderedPath.length, 'of', edges.length, 'edges')
  return orderedPath
}

/**
 * Returns all tables that belong to the same combined group as the given table.
 * Includes both the primary table and all secondary (linked) tables.
 *
 * @param target - The table to find group members for
 * @param allTables - All tables to search
 * @returns Array of all tables in the combined group
 */
export function getCombinedGroupTables<T extends TableRect>(
  target: T,
  allTables: T[]
): T[] {
  // If not part of a combined group, return just this table
  if (!target.combinedWithId && (!target.combinedTableIds || target.combinedTableIds.length === 0)) {
    return [target]
  }

  // Find the primary table ID
  const primaryId = target.combinedWithId || target.id

  // Find all tables that are part of this group
  return allTables.filter(t =>
    t.id === primaryId || t.combinedWithId === primaryId
  )
}

/**
 * Check if a table can be placed at a position without overlapping other tables.
 * This checks individual table rectangles, NOT combined group bounding boxes,
 * allowing placement in "pockets" of T, L, U shaped groups.
 *
 * IMPORTANT: Uses <= and >= which allows tables to sit perfectly flush
 * against each other without triggering a collision. This is essential for
 * magnetic snap docking to create T, L, U shapes.
 *
 * @param movingTable - The table being placed
 * @param newX - New X position
 * @param newY - New Y position
 * @param allTables - All tables to check against
 * @returns true if placement is valid (no overlap)
 */
export function canPlaceTableAt<T extends TableRect>(
  movingTable: T,
  newX: number,
  newY: number,
  allTables: T[]
): boolean {
  const movingRect = {
    left: newX,
    right: newX + movingTable.width,
    top: newY,
    bottom: newY + movingTable.height,
  }

  // Create a set of IDs to ignore (self + any combined group members)
  // This prevents collision detection between tables in the same combined group
  const excludedIds = new Set<string>([movingTable.id])
  if (movingTable.combinedTableIds) {
    movingTable.combinedTableIds.forEach(id => excludedIds.add(id))
  }
  if (movingTable.combinedWithId) {
    excludedIds.add(movingTable.combinedWithId)
  }

  console.log('[canPlaceTableAt] Checking placement:', {
    tableId: movingTable.id,
    pos: `(${newX}, ${newY})`,
    size: `${movingTable.width}x${movingTable.height}`,
    excludedIds: [...excludedIds],
  })

  // Check against each individual table, NOT group bounding boxes
  const hasCollision = allTables.some(other => {
    // Skip collision check for self or group partners
    if (excludedIds.has(other.id)) return false

    const otherRect = {
      left: other.posX,
      right: other.posX + other.width,
      top: other.posY,
      bottom: other.posY + other.height,
    }

    // AABB Overlap Test: Tables touching (flush edges) are NOT collisions.
    // Only returns true if tables actually INTERSECT (overlap by > 0 pixels)
    const collides = !(
      movingRect.right <= otherRect.left ||   // Moving table is to the left
      movingRect.left >= otherRect.right ||   // Moving table is to the right
      movingRect.bottom <= otherRect.top ||   // Moving table is above
      movingRect.top >= otherRect.bottom      // Moving table is below
    )

    if (collides) {
      console.log('[canPlaceTableAt] COLLISION with:', {
        otherId: other.id,
        movingRect,
        otherRect,
        gaps: {
          rightToLeft: movingRect.right - otherRect.left,
          leftToRight: otherRect.right - movingRect.left,
          bottomToTop: movingRect.bottom - otherRect.top,
          topToBottom: otherRect.bottom - movingRect.top,
        }
      })
    }

    return collides
  })

  console.log('[canPlaceTableAt] Result:', hasCollision ? 'BLOCKED' : 'OK')
  return !hasCollision
}

/**
 * Calculate the bounding box of a group of tables
 */
export function getGroupBoundingBox(groupTables: TableRect[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} | null {
  if (groupTables.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  groupTables.forEach(t => {
    minX = Math.min(minX, t.posX)
    minY = Math.min(minY, t.posY)
    maxX = Math.max(maxX, t.posX + t.width)
    maxY = Math.max(maxY, t.posY + t.height)
  })

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Get the center point of a combined group
 */
export function getGroupCenter(groupTables: TableRect[]): Point {
  const bounds = getGroupBoundingBox(groupTables)
  if (!bounds) return { x: 0, y: 0 }

  return {
    x: bounds.minX + bounds.width / 2,
    y: bounds.minY + bounds.height / 2,
  }
}

/**
 * Calculate realistic seat capacity based on exposed perimeter length.
 * This prevents the "8 seats" problem when combining two 4-top tables side-by-side,
 * as the shared internal edges are excluded from the perimeter calculation.
 *
 * @param groupTables - All tables in the combined group
 * @param seatWidth - Width per seat in pixels (default 65px based on typical table visuals)
 * @returns Calculated capacity based on exposed perimeter
 */
export function calculatePerimeterCapacity(
  groupTables: TableRect[],
  seatWidth: number = 65
): number {
  if (groupTables.length === 0) return 0

  // For a single table, just return a basic estimate
  if (groupTables.length === 1) {
    const t = groupTables[0]
    const perimeter = 2 * (t.width + t.height)
    return Math.floor(perimeter / seatWidth)
  }

  // Calculate total exposed perimeter length (excludes internal/flush edges)
  let totalExposedLength = 0
  groupTables.forEach(t => {
    const edges = getExposedEdges(t, groupTables)
    edges.forEach(e => {
      totalExposedLength += Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y)
    })
  })

  // Calculate capacity from perimeter
  // This naturally gives ~6 seats for two 4-tops side-by-side (shared edges excluded)
  return Math.floor(totalExposedLength / seatWidth)
}

/**
 * Magnetic snap result with snap info
 */
export interface MagneticSnapResult {
  x: number
  y: number
  snappedHorizontally: boolean
  snappedVertically: boolean
  snapTargetId?: string
}

/**
 * Calculate magnetic snap position for edge-to-edge docking.
 * Allows tables to snap flush against each other for T, L, U shapes.
 *
 * @param draggingTable - The table being dragged with proposed new position
 * @param otherTables - All other tables to potentially snap to
 * @param snapDistance - Optional custom snap distance (default 15px)
 * @returns Snapped position and snap info
 */
export function calculateMagneticSnap(
  draggingTable: { id: string; x: number; y: number; width: number; height: number },
  otherTables: TableRect[],
  snapDistance: number = SNAP_DISTANCE
): MagneticSnapResult {
  // GRID-AWARE SNAPPING: Find ALL candidate snap positions, then pick the best one
  // Priority: positions that snap to 2 tables > 1 table (completes grids)

  interface SnapCandidate {
    x: number
    y: number
    hSnap: boolean  // snapped horizontally
    vSnap: boolean  // snapped vertically
    hTableId?: string
    vTableId?: string
    score: number   // higher = better (2 snaps > 1 snap)
  }

  const candidates: SnapCandidate[] = []

  // Start with the raw position as baseline
  const baseCandidate: SnapCandidate = {
    x: draggingTable.x,
    y: draggingTable.y,
    hSnap: false,
    vSnap: false,
    score: 0
  }

  // Collect all possible vertical snap positions (TOP/BOTTOM edge alignments)
  const verticalSnaps: { y: number; tableId: string; type: 'top-to-bottom' | 'bottom-to-top' }[] = []

  // Collect all possible horizontal snap positions (LEFT/RIGHT edge alignments)
  const horizontalSnaps: { x: number; tableId: string; type: 'left-to-right' | 'right-to-left' }[] = []

  for (const other of otherTables) {
    if (other.id === draggingTable.id) continue

    const otherRight = other.posX + other.width
    const otherBottom = other.posY + other.height

    // Vertical snaps (require some horizontal proximity - use larger range for detection)
    const proximityRange = snapDistance * 5  // Search wider for candidates (75px)
    const hasHorizontalProximity =
      draggingTable.x < otherRight + proximityRange &&
      draggingTable.x + draggingTable.width > other.posX - proximityRange

    if (hasHorizontalProximity) {
      // TOP to other's BOTTOM (places table below other)
      const topToBottomGap = Math.abs(draggingTable.y - otherBottom)
      if (topToBottomGap < proximityRange) {
        verticalSnaps.push({ y: otherBottom, tableId: other.id, type: 'top-to-bottom' })
      }

      // BOTTOM to other's TOP (places table above other)
      const bottomToTopGap = Math.abs(draggingTable.y + draggingTable.height - other.posY)
      if (bottomToTopGap < proximityRange) {
        verticalSnaps.push({ y: other.posY - draggingTable.height, tableId: other.id, type: 'bottom-to-top' })
      }
    }

    // Horizontal snaps (require some vertical proximity)
    const hasVerticalProximity =
      draggingTable.y < otherBottom + proximityRange &&
      draggingTable.y + draggingTable.height > other.posY - proximityRange

    if (hasVerticalProximity) {
      // LEFT to other's RIGHT (places table to right of other)
      const leftToRightGap = Math.abs(draggingTable.x - otherRight)
      if (leftToRightGap < proximityRange) {
        horizontalSnaps.push({ x: otherRight, tableId: other.id, type: 'left-to-right' })
      }

      // RIGHT to other's LEFT (places table to left of other)
      const rightToLeftGap = Math.abs(draggingTable.x + draggingTable.width - other.posX)
      if (rightToLeftGap < proximityRange) {
        horizontalSnaps.push({ x: other.posX - draggingTable.width, tableId: other.id, type: 'right-to-left' })
      }
    }
  }

  // Generate all combinations of vertical and horizontal snaps
  // This finds positions where the table snaps to TWO tables (grid corner positions)
  for (const vSnap of verticalSnaps) {
    for (const hSnap of horizontalSnaps) {
      // Check if this combination is valid (tables at snapped position should actually be adjacent)
      const testX = hSnap.x
      const testY = vSnap.y

      // Verify the vertical snap table is actually horizontally aligned at this position
      const vTable = otherTables.find(t => t.id === vSnap.tableId)
      const hTable = otherTables.find(t => t.id === hSnap.tableId)

      if (vTable && hTable) {
        const hasHOverlapAtY = testX < vTable.posX + vTable.width && testX + draggingTable.width > vTable.posX
        const hasVOverlapAtX = testY < hTable.posY + hTable.height && testY + draggingTable.height > hTable.posY

        if (hasHOverlapAtY && hasVOverlapAtX) {
          // Valid grid corner position - snaps to both tables
          // Use generous threshold for 2-snap (grid completion) - this is a high-value snap
          const distFromOriginal = Math.hypot(testX - draggingTable.x, testY - draggingTable.y)
          const gridSnapThreshold = snapDistance * 5  // 75px - be generous for grid completion
          if (distFromOriginal < gridSnapThreshold) {
            candidates.push({
              x: testX,
              y: testY,
              hSnap: true,
              vSnap: true,
              hTableId: hSnap.tableId,
              vTableId: vSnap.tableId,
              score: 200 - distFromOriginal  // 2-snap gets base score of 200, ensuring it wins
            })
          }
        }
      }
    }
  }

  // Also add single-snap candidates (when no 2-snap is available)
  for (const vSnap of verticalSnaps) {
    const testY = vSnap.y
    const vTable = otherTables.find(t => t.id === vSnap.tableId)
    if (vTable) {
      const hasHOverlap = draggingTable.x < vTable.posX + vTable.width &&
                          draggingTable.x + draggingTable.width > vTable.posX
      if (hasHOverlap) {
        const distFromOriginal = Math.abs(testY - draggingTable.y)
        if (distFromOriginal < snapDistance) {
          candidates.push({
            x: draggingTable.x,
            y: testY,
            hSnap: false,
            vSnap: true,
            vTableId: vSnap.tableId,
            score: 50 - distFromOriginal  // Single snap scores lower than double
          })
        }
      }
    }
  }

  for (const hSnap of horizontalSnaps) {
    const testX = hSnap.x
    const hTable = otherTables.find(t => t.id === hSnap.tableId)
    if (hTable) {
      const hasVOverlap = draggingTable.y < hTable.posY + hTable.height &&
                          draggingTable.y + draggingTable.height > hTable.posY
      if (hasVOverlap) {
        const distFromOriginal = Math.abs(testX - draggingTable.x)
        if (distFromOriginal < snapDistance) {
          candidates.push({
            x: testX,
            y: draggingTable.y,
            hSnap: true,
            vSnap: false,
            hTableId: hSnap.tableId,
            score: 50 - distFromOriginal
          })
        }
      }
    }
  }

  // Add baseline (no snap)
  candidates.push(baseCandidate)

  // Sort by score (highest first) and pick the best
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  // Debug logging for troubleshooting
  console.log('[MagneticSnap] Input:', {
    table: `(${Math.round(draggingTable.x)}, ${Math.round(draggingTable.y)}) ${draggingTable.width}x${draggingTable.height}`,
    otherTables: otherTables.length,
    vSnaps: verticalSnaps.length,
    hSnaps: horizontalSnaps.length,
    candidates: candidates.length,
  })
  if (candidates.length > 1) {
    console.log('[MagneticSnap] Top candidates:', candidates.slice(0, 5).map(c => ({
      pos: `(${Math.round(c.x)}, ${Math.round(c.y)})`,
      snaps: `h:${c.hSnap} v:${c.vSnap}`,
      score: Math.round(c.score)
    })))
  }
  if (best.score > 0) {
    console.log('[MagneticSnap] Selected:', {
      pos: `(${Math.round(best.x)}, ${Math.round(best.y)})`,
      snaps: `h:${best.hSnap} v:${best.vSnap}`,
      score: Math.round(best.score)
    })
  }

  return {
    x: best.x,
    y: best.y,
    snappedHorizontally: best.hSnap,
    snappedVertically: best.vSnap,
    snapTargetId: best.hTableId || best.vTableId,
  }
}


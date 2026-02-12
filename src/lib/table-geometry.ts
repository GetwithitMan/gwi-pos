/**
 * Table Geometry Utilities
 *
 * Provides helpers for:
 * - Coordinate normalization (prevents floating point errors)
 * - Table overlap / collision detection
 * - Magnetic snapping for edge-to-edge docking
 * - Bounding box calculation for sets of tables
 */

export type Point = { x: number; y: number }

export interface TableRect {
  id: string
  posX: number
  posY: number
  width: number
  height: number
}

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
  // This prevents tables from flying to 0,0 during state transitions
  if (coord === undefined || coord === null || isNaN(coord)) {
    console.warn('[normalizeCoord] Invalid coordinate received, using safe fallback:', coord)
    return 100 // Safe margin from edge
  }
  return Math.round(coord / gridSize) * gridSize
}

/**
 * Check if a table can be placed at a position without overlapping other tables.
 * This checks individual table rectangles for overlap.
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

  // Check against each individual table
  const hasCollision = allTables.some(other => {
    // Skip collision check for self
    if (other.id === movingTable.id) return false

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

    return collides
  })

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

  return {
    x: best.x,
    y: best.y,
    snappedHorizontally: best.hSnap,
    snappedVertically: best.vSnap,
    snapTargetId: best.hTableId || best.vTableId,
  }
}

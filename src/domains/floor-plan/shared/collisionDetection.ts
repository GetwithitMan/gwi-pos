/**
 * GWI POS - Floor Plan Domain
 * Collision Detection Module
 *
 * Pure collision detection functions for table placement validation.
 * Prevents tables from overlapping with fixtures (walls, bar counters, etc.)
 *
 * Coordinate System: All positions are in FEET
 * Tables use center-based positioning (x, y is center point)
 * Walls use geometry with start/end points
 * Other fixtures use posX/posY with width/height
 */

import type { Point } from './types'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Table bounding box
 */
export interface TableBounds {
  x: number // Center X in feet
  y: number // Center Y in feet
  width: number // Width in feet
  height: number // Height in feet
  rotation?: number // Degrees (optional, for rotated tables)
}

/**
 * Fixture bounds (from FloorPlanElement)
 */
export interface FixtureBounds {
  id: string
  type: 'wall' | 'rectangle' | 'circle'
  visualType: string
  // For rectangles
  x?: number
  y?: number
  width?: number
  height?: number
  // For circles (pillars, planters)
  centerX?: number
  centerY?: number
  radius?: number
  // For walls (lines)
  geometry?: {
    start: { x: number; y: number }
    end: { x: number; y: number }
  }
  thickness?: number
}

/**
 * Collision result
 */
export interface CollisionResult {
  collides: boolean
  collidingFixtures: string[] // IDs of fixtures that collide
  suggestedPosition?: { x: number; y: number } // Optional snap position
}

// =============================================================================
// COLLISION DETECTION ALGORITHMS
// =============================================================================

/**
 * Rectangle-Rectangle collision (AABB - Axis-Aligned Bounding Box)
 * Used for tables vs bar counters, kitchens, stages, etc.
 */
export function rectRectCollision(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  // Convert center-based coords to corner-based for easier math
  const r1Left = rect1.x - rect1.width / 2
  const r1Right = rect1.x + rect1.width / 2
  const r1Top = rect1.y - rect1.height / 2
  const r1Bottom = rect1.y + rect1.height / 2

  const r2Left = rect2.x - rect2.width / 2
  const r2Right = rect2.x + rect2.width / 2
  const r2Top = rect2.y - rect2.height / 2
  const r2Bottom = rect2.y + rect2.height / 2

  // Check if rectangles overlap
  return !(
    r1Right < r2Left ||
    r1Left > r2Right ||
    r1Bottom < r2Top ||
    r1Top > r2Bottom
  )
}

/**
 * Circle-Rectangle collision
 * Used for tables vs circular pillars, planters
 */
export function circleRectCollision(
  circle: { x: number; y: number; radius: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  // Find closest point on rectangle to circle center
  const rectLeft = rect.x - rect.width / 2
  const rectRight = rect.x + rect.width / 2
  const rectTop = rect.y - rect.height / 2
  const rectBottom = rect.y + rect.height / 2

  const closestX = Math.max(rectLeft, Math.min(circle.x, rectRight))
  const closestY = Math.max(rectTop, Math.min(circle.y, rectBottom))

  // Calculate distance from circle center to closest point
  const distX = circle.x - closestX
  const distY = circle.y - closestY
  const distSquared = distX * distX + distY * distY

  return distSquared < circle.radius * circle.radius
}

/**
 * Line-Rectangle collision (for walls)
 * Treats wall as a thick line (capsule shape)
 */
export function lineRectCollision(
  line: { start: Point; end: Point; thickness: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const { start, end, thickness } = line
  const halfThickness = thickness / 2

  // Convert rect to corners
  const rectLeft = rect.x - rect.width / 2
  const rectRight = rect.x + rect.width / 2
  const rectTop = rect.y - rect.height / 2
  const rectBottom = rect.y + rect.height / 2

  // Check if any corner of the rectangle is within thickness of the line segment
  const corners = [
    { x: rectLeft, y: rectTop },
    { x: rectRight, y: rectTop },
    { x: rectLeft, y: rectBottom },
    { x: rectRight, y: rectBottom },
  ]

  for (const corner of corners) {
    const dist = pointToLineDistance(corner, start, end)
    if (dist < halfThickness) return true
  }

  // Also check if line segment intersects the rectangle
  // (covers case where line passes through but corners are outside)
  if (lineSegmentIntersectsRect(start, end, rectLeft, rectRight, rectTop, rectBottom)) {
    return true
  }

  return false
}

/**
 * Calculate distance from a point to a line segment
 */
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const { x: px, y: py } = point
  const { x: x1, y: y1 } = lineStart
  const { x: x2, y: y2 } = lineEnd

  // Vector from line start to end
  const dx = x2 - x1
  const dy = y2 - y1

  // If line is actually a point
  if (dx === 0 && dy === 0) {
    return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1))
  }

  // Calculate projection parameter t (0 = start, 1 = end, clamped to segment)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))

  // Find closest point on line segment
  const closestX = x1 + t * dx
  const closestY = y1 + t * dy

  // Return distance
  return Math.sqrt((px - closestX) * (px - closestX) + (py - closestY) * (py - closestY))
}

/**
 * Check if a line segment intersects a rectangle
 */
function lineSegmentIntersectsRect(
  start: Point,
  end: Point,
  left: number,
  right: number,
  top: number,
  bottom: number
): boolean {
  // Check if line segment intersects any of the four rectangle edges
  const edges = [
    { p1: { x: left, y: top }, p2: { x: right, y: top } }, // Top edge
    { p1: { x: right, y: top }, p2: { x: right, y: bottom } }, // Right edge
    { p1: { x: left, y: bottom }, p2: { x: right, y: bottom } }, // Bottom edge
    { p1: { x: left, y: top }, p2: { x: left, y: bottom } }, // Left edge
  ]

  for (const edge of edges) {
    if (lineSegmentsIntersect(start, end, edge.p1, edge.p2)) {
      return true
    }
  }

  // Also check if either endpoint is inside the rectangle
  if (
    (start.x >= left && start.x <= right && start.y >= top && start.y <= bottom) ||
    (end.x >= left && end.x <= right && end.y >= top && end.y <= bottom)
  ) {
    return true
  }

  return false
}

/**
 * Check if two line segments intersect
 */
function lineSegmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const ccw = (a: Point, b: Point, c: Point) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
  }

  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
}

// =============================================================================
// HIGH-LEVEL COLLISION CHECKING
// =============================================================================

/**
 * Check if a table collides with a single fixture
 */
export function checkTableFixtureCollision(
  table: TableBounds,
  fixture: FixtureBounds
): boolean {
  // Route to correct collision algorithm based on fixture type
  switch (fixture.type) {
    case 'rectangle':
      if (fixture.x !== undefined && fixture.y !== undefined && fixture.width && fixture.height) {
        return rectRectCollision(table, {
          x: fixture.x,
          y: fixture.y,
          width: fixture.width,
          height: fixture.height,
        })
      }
      break

    case 'circle':
      if (fixture.centerX !== undefined && fixture.centerY !== undefined && fixture.radius) {
        return circleRectCollision(
          {
            x: fixture.centerX,
            y: fixture.centerY,
            radius: fixture.radius,
          },
          table
        )
      }
      break

    case 'wall':
      if (fixture.geometry?.start && fixture.geometry?.end) {
        return lineRectCollision(
          {
            start: fixture.geometry.start,
            end: fixture.geometry.end,
            thickness: fixture.thickness || 0.5,
          },
          table
        )
      }
      break

    default:
      console.warn(`Unknown fixture type: ${fixture.type}`)
  }

  return false
}

/**
 * Check if a table collides with ANY fixture in an array
 * Returns collision result with list of colliding fixture IDs
 */
export function checkTableAllFixturesCollision(
  table: TableBounds,
  fixtures: FixtureBounds[]
): CollisionResult {
  const collidingFixtures: string[] = []

  for (const fixture of fixtures) {
    if (checkTableFixtureCollision(table, fixture)) {
      collidingFixtures.push(fixture.id)
    }
  }

  return {
    collides: collidingFixtures.length > 0,
    collidingFixtures,
  }
}

/**
 * Find nearest valid position for a table (optional snap feature)
 * This is a simplified implementation - could be enhanced with grid search
 */
export function findNearestValidPosition(
  table: TableBounds,
  fixtures: FixtureBounds[],
  maxSearchRadius: number = 5 // feet
): { x: number; y: number } | null {
  // Try positions in a spiral pattern outward from current position
  const step = 0.5 // feet
  const maxSteps = Math.floor(maxSearchRadius / step)

  for (let radius = 1; radius <= maxSteps; radius++) {
    const testPositions = [
      { x: table.x + radius * step, y: table.y }, // Right
      { x: table.x - radius * step, y: table.y }, // Left
      { x: table.x, y: table.y + radius * step }, // Down
      { x: table.x, y: table.y - radius * step }, // Up
      { x: table.x + radius * step, y: table.y + radius * step }, // Bottom-right
      { x: table.x - radius * step, y: table.y + radius * step }, // Bottom-left
      { x: table.x + radius * step, y: table.y - radius * step }, // Top-right
      { x: table.x - radius * step, y: table.y - radius * step }, // Top-left
    ]

    for (const pos of testPositions) {
      const testTable = { ...table, x: pos.x, y: pos.y }
      const result = checkTableAllFixturesCollision(testTable, fixtures)
      if (!result.collides) {
        return pos
      }
    }
  }

  return null
}

// =============================================================================
// EXPORT DEFAULT
// =============================================================================

export default {
  rectRectCollision,
  circleRectCollision,
  lineRectCollision,
  checkTableFixtureCollision,
  checkTableAllFixturesCollision,
  findNearestValidPosition,
}

/**
 * GWI POS - Floor Plan Domain
 * Perimeter Seat Renumbering for Virtual Table Groups
 *
 * Traces the outer perimeter of combined tables clockwise from upper-left,
 * assigning sequential seat numbers 1, 2, 3...
 */

import type { Point } from '../shared/types';

export interface SeatWithPosition {
  id: string;
  tableId: string;
  seatNumber: number;
  label: string;
  // Absolute position on canvas (table center + seat relative offset)
  absoluteX: number;
  absoluteY: number;
}

export interface TableForPerimeter {
  id: string;
  name: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  seats: Array<{
    id: string;
    seatNumber: number;
    label: string;
    relativeX: number;
    relativeY: number;
  }>;
}

export interface PerimeterSeatResult {
  seatId: string;
  tableId: string;
  tableName: string;
  originalNumber: number;
  perimeterNumber: number; // 1, 2, 3... around combined group
  originalLabel: string;
  perimeterLabel: string; // Just the number as string
}

/**
 * Calculate the combined bounding box of all tables
 */
function getCombinedBounds(tables: TableForPerimeter[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const table of tables) {
    minX = Math.min(minX, table.posX);
    minY = Math.min(minY, table.posY);
    maxX = Math.max(maxX, table.posX + table.width);
    maxY = Math.max(maxY, table.posY + table.height);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Convert relative seat positions to absolute canvas positions
 */
function getAbsoluteSeats(tables: TableForPerimeter[]): SeatWithPosition[] {
  const seats: SeatWithPosition[] = [];

  for (const table of tables) {
    const tableCenterX = table.posX + table.width / 2;
    const tableCenterY = table.posY + table.height / 2;

    for (const seat of table.seats) {
      seats.push({
        id: seat.id,
        tableId: table.id,
        seatNumber: seat.seatNumber,
        label: seat.label,
        absoluteX: tableCenterX + seat.relativeX,
        absoluteY: tableCenterY + seat.relativeY,
      });
    }
  }

  return seats;
}

/**
 * Calculate angle from center point, normalized to start from upper-left (NW)
 * and go clockwise.
 *
 * Standard atan2: 0° = East, increases counter-clockwise
 * We want: 0° = upper-left (NW), increases clockwise
 */
function getClockwiseAngleFromUpperLeft(
  seatX: number,
  seatY: number,
  centerX: number,
  centerY: number
): number {
  // Standard angle (0 = East, counter-clockwise positive)
  const standardAngle = Math.atan2(seatY - centerY, seatX - centerX);

  // Convert to degrees
  let degrees = standardAngle * (180 / Math.PI);

  // Rotate so 0° is at upper-left (-135° in standard)
  // and make clockwise positive
  degrees = degrees + 135;

  // Normalize to 0-360
  if (degrees < 0) degrees += 360;
  if (degrees >= 360) degrees -= 360;

  return degrees;
}

/**
 * Main function: Calculate perimeter seat numbers for a virtual group
 *
 * @param tables - Array of tables with positions and seats
 * @returns Array of seat results with perimeter numbers, ordered clockwise from upper-left
 */
export function calculatePerimeterSeats(
  tables: TableForPerimeter[]
): PerimeterSeatResult[] {
  if (tables.length === 0) return [];

  // Get combined bounds
  const bounds = getCombinedBounds(tables);

  // Convert to absolute positions
  const absoluteSeats = getAbsoluteSeats(tables);

  if (absoluteSeats.length === 0) return [];

  // Calculate clockwise angle for each seat from upper-left
  const seatsWithAngles = absoluteSeats.map((seat) => ({
    ...seat,
    angle: getClockwiseAngleFromUpperLeft(
      seat.absoluteX,
      seat.absoluteY,
      bounds.centerX,
      bounds.centerY
    ),
  }));

  // Sort by angle (clockwise from upper-left)
  seatsWithAngles.sort((a, b) => a.angle - b.angle);

  // Find table name by ID (for results)
  const tableNameMap = new Map(tables.map((t) => [t.id, t.name]));

  // Assign perimeter numbers
  return seatsWithAngles.map((seat, index) => ({
    seatId: seat.id,
    tableId: seat.tableId,
    tableName: tableNameMap.get(seat.tableId) || 'Unknown',
    originalNumber: seat.seatNumber,
    perimeterNumber: index + 1,
    originalLabel: seat.label,
    perimeterLabel: String(index + 1),
  }));
}

/**
 * Get perimeter seat count for a group of tables
 */
export function getPerimeterSeatCount(tables: TableForPerimeter[]): number {
  return tables.reduce((sum, t) => sum + t.seats.length, 0);
}

/**
 * Get display summary for a virtual group
 * e.g., "Tables 5 & 6 • Party of 12"
 */
export function getGroupDisplayName(tables: TableForPerimeter[]): string {
  const tableNames = tables.map((t) => t.name);
  const seatCount = getPerimeterSeatCount(tables);

  if (tableNames.length === 0) return '';
  if (tableNames.length === 1) return `${tableNames[0]} • ${seatCount} seats`;
  if (tableNames.length === 2) {
    return `${tableNames[0]} & ${tableNames[1]} • Party of ${seatCount}`;
  }

  // 3+ tables: "Tables 5, 6 & 7 • Party of 18"
  const allButLast = tableNames.slice(0, -1);
  const last = tableNames[tableNames.length - 1];
  return `${allButLast.join(', ')} & ${last} • Party of ${seatCount}`;
}

/**
 * Create a lookup map from seatId to perimeterNumber
 * Useful for quick lookups during rendering
 */
export function createPerimeterLookup(
  results: PerimeterSeatResult[]
): Map<string, number> {
  return new Map(results.map((r) => [r.seatId, r.perimeterNumber]));
}

/**
 * Determine which seats are "inner" seats (between snapped tables)
 * These should be hidden when tables are combined.
 *
 * A seat is "inner" if:
 * 1. It's positioned in the direction of another table (facing inward)
 * 2. The other table is close enough that the seat would overlap
 *
 * When tables snap edge-to-edge, seats on the touching edges would
 * visually overlap or be sandwiched between tables.
 *
 * @returns Set of seat IDs that should be hidden
 */
export function getInnerSeats(tables: TableForPerimeter[]): Set<string> {
  if (tables.length < 2) return new Set();

  const innerSeatIds = new Set<string>();

  // Seat visual size (we render seats at 24px diameter)
  const SEAT_SIZE = 24;
  // How far seats typically extend from table edge
  const SEAT_EXTENSION = 20;
  // Total zone around table edge where seats from adjacent table would overlap
  const OVERLAP_ZONE = SEAT_SIZE + SEAT_EXTENSION;

  for (const table of tables) {
    const tableCenterX = table.posX + table.width / 2;
    const tableCenterY = table.posY + table.height / 2;

    // Get table edges
    const tableLeft = table.posX;
    const tableRight = table.posX + table.width;
    const tableTop = table.posY;
    const tableBottom = table.posY + table.height;

    for (const seat of table.seats) {
      // Calculate absolute seat position (center of the seat circle)
      const seatAbsX = tableCenterX + seat.relativeX;
      const seatAbsY = tableCenterY + seat.relativeY;

      // Determine which edge this seat is on (based on relative position)
      const isOnRight = seat.relativeX > table.width / 4;
      const isOnLeft = seat.relativeX < -table.width / 4;
      const isOnBottom = seat.relativeY > table.height / 4;
      const isOnTop = seat.relativeY < -table.height / 4;

      // Check if any other table is adjacent on the same edge
      for (const otherTable of tables) {
        if (otherTable.id === table.id) continue;

        const otherLeft = otherTable.posX;
        const otherRight = otherTable.posX + otherTable.width;
        const otherTop = otherTable.posY;
        const otherBottom = otherTable.posY + otherTable.height;

        // Check vertical overlap (for horizontal adjacency)
        const hasVerticalOverlap =
          tableTop < otherBottom + OVERLAP_ZONE &&
          tableBottom > otherTop - OVERLAP_ZONE;

        // Check horizontal overlap (for vertical adjacency)
        const hasHorizontalOverlap =
          tableLeft < otherRight + OVERLAP_ZONE &&
          tableRight > otherLeft - OVERLAP_ZONE;

        // Seat on right edge, other table is to the right
        if (isOnRight && hasVerticalOverlap) {
          const gapToRight = otherLeft - tableRight;
          if (gapToRight >= -5 && gapToRight <= OVERLAP_ZONE) {
            innerSeatIds.add(seat.id);
            break;
          }
        }

        // Seat on left edge, other table is to the left
        if (isOnLeft && hasVerticalOverlap) {
          const gapToLeft = tableLeft - otherRight;
          if (gapToLeft >= -5 && gapToLeft <= OVERLAP_ZONE) {
            innerSeatIds.add(seat.id);
            break;
          }
        }

        // Seat on bottom edge, other table is below
        if (isOnBottom && hasHorizontalOverlap) {
          const gapToBottom = otherTop - tableBottom;
          if (gapToBottom >= -5 && gapToBottom <= OVERLAP_ZONE) {
            innerSeatIds.add(seat.id);
            break;
          }
        }

        // Seat on top edge, other table is above
        if (isOnTop && hasHorizontalOverlap) {
          const gapToTop = tableTop - otherBottom;
          if (gapToTop >= -5 && gapToTop <= OVERLAP_ZONE) {
            innerSeatIds.add(seat.id);
            break;
          }
        }
      }
    }
  }

  return innerSeatIds;
}

/**
 * Create a combined lookup that includes perimeter number AND visibility
 * Returns a map of seatId to { perimeterNumber, isVisible }
 */
export function createEnhancedPerimeterLookup(
  tables: TableForPerimeter[]
): Map<string, { perimeterNumber: number; isVisible: boolean }> {
  const perimeterResults = calculatePerimeterSeats(tables);
  const innerSeats = getInnerSeats(tables);

  const lookup = new Map<string, { perimeterNumber: number; isVisible: boolean }>();

  for (const result of perimeterResults) {
    lookup.set(result.seatId, {
      perimeterNumber: result.perimeterNumber,
      isVisible: !innerSeats.has(result.seatId),
    });
  }

  return lookup;
}

/**
 * Virtual seat position for rendering around combined table group
 */
export interface VirtualSeatPosition {
  id: string;  // Generated ID like "virtual-seat-1"
  perimeterNumber: number;
  absoluteX: number;
  absoluteY: number;
  // Original seat info (for orders)
  originalSeatId: string;
  originalTableId: string;
  originalSeatNumber: number;
}

/**
 * Represents an edge segment of a table that may or may not be exposed (outer edge)
 */
interface EdgeSegment {
  tableId: string;
  edge: 'top' | 'right' | 'bottom' | 'left';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  length: number;
  isOuter: boolean;  // true if this edge is not touching another table
}

/**
 * Check if two line segments overlap significantly (more than a small threshold)
 */
function edgesOverlap(
  seg1Start: number, seg1End: number,
  seg2Start: number, seg2End: number,
  threshold: number = 10
): boolean {
  const overlapStart = Math.max(seg1Start, seg2Start);
  const overlapEnd = Math.min(seg1End, seg2End);
  return (overlapEnd - overlapStart) > threshold;
}

/**
 * Determine which edges of each table are "outer" (not touching another table)
 */
function classifyTableEdges(tables: TableForPerimeter[]): EdgeSegment[] {
  const allEdges: EdgeSegment[] = [];
  const TOUCH_THRESHOLD = 5; // Tables within 5px are considered touching

  for (const table of tables) {
    const left = table.posX;
    const right = table.posX + table.width;
    const top = table.posY;
    const bottom = table.posY + table.height;

    // Create edge segments for all four sides
    const edges: EdgeSegment[] = [
      { tableId: table.id, edge: 'top', startX: left, startY: top, endX: right, endY: top, length: table.width, isOuter: true },
      { tableId: table.id, edge: 'right', startX: right, startY: top, endX: right, endY: bottom, length: table.height, isOuter: true },
      { tableId: table.id, edge: 'bottom', startX: right, startY: bottom, endX: left, endY: bottom, length: table.width, isOuter: true },
      { tableId: table.id, edge: 'left', startX: left, startY: bottom, endX: left, endY: top, length: table.height, isOuter: true },
    ];

    // Check each edge against other tables to see if it's inner (touching)
    for (const edge of edges) {
      for (const otherTable of tables) {
        if (otherTable.id === table.id) continue;

        const otherLeft = otherTable.posX;
        const otherRight = otherTable.posX + otherTable.width;
        const otherTop = otherTable.posY;
        const otherBottom = otherTable.posY + otherTable.height;

        // Check if this edge is touching the other table
        if (edge.edge === 'top') {
          // Top edge touches if other table's bottom is at our top, and they overlap horizontally
          if (Math.abs(otherBottom - top) <= TOUCH_THRESHOLD) {
            if (edgesOverlap(left, right, otherLeft, otherRight)) {
              edge.isOuter = false;
              break;
            }
          }
        } else if (edge.edge === 'bottom') {
          // Bottom edge touches if other table's top is at our bottom
          if (Math.abs(otherTop - bottom) <= TOUCH_THRESHOLD) {
            if (edgesOverlap(left, right, otherLeft, otherRight)) {
              edge.isOuter = false;
              break;
            }
          }
        } else if (edge.edge === 'left') {
          // Left edge touches if other table's right is at our left
          if (Math.abs(otherRight - left) <= TOUCH_THRESHOLD) {
            if (edgesOverlap(top, bottom, otherTop, otherBottom)) {
              edge.isOuter = false;
              break;
            }
          }
        } else if (edge.edge === 'right') {
          // Right edge touches if other table's left is at our right
          if (Math.abs(otherLeft - right) <= TOUCH_THRESHOLD) {
            if (edgesOverlap(top, bottom, otherTop, otherBottom)) {
              edge.isOuter = false;
              break;
            }
          }
        }
      }
    }

    allEdges.push(...edges);
  }

  return allEdges;
}

/**
 * Generate virtual seat positions around the actual combined shape.
 * Places seats only along outer edges (not where tables touch each other).
 *
 * @param tables - Array of tables with their visual positions (already snapped)
 * @param seatDistance - How far from the table edge to place seats (default 18px)
 * @returns Array of virtual seat positions with absolute coordinates
 */
export function generateVirtualSeatPositions(
  tables: TableForPerimeter[],
  seatDistance: number = 18
): VirtualSeatPosition[] {
  if (tables.length === 0) return [];

  // Get total seat count from all tables
  const totalSeats = tables.reduce((sum, t) => sum + t.seats.length, 0);
  if (totalSeats === 0) return [];

  // Classify which edges are outer vs inner
  const allEdges = classifyTableEdges(tables);
  const outerEdges = allEdges.filter(e => e.isOuter);

  // Calculate total outer perimeter length
  const totalOuterPerimeter = outerEdges.reduce((sum, e) => sum + e.length, 0);

  if (totalOuterPerimeter === 0) return [];

  // Calculate spacing between seats along the outer perimeter
  const seatSpacing = totalOuterPerimeter / totalSeats;

  // Collect all original seats sorted by perimeter order
  const perimeterSeats = calculatePerimeterSeats(tables);

  // Sort outer edges to create a continuous path around the shape
  // Start from the top-left-most point and go clockwise
  const sortedEdges = sortEdgesClockwise(outerEdges, tables);

  // Generate positions along the outer edges
  const virtualSeats: VirtualSeatPosition[] = [];

  // Track cumulative distance along the perimeter
  let cumulativeDistance = 0;
  let seatIndex = 0;

  for (const edge of sortedEdges) {
    // Calculate how many seats fit on this edge segment
    const edgeStart = cumulativeDistance;
    const edgeEnd = cumulativeDistance + edge.length;

    // Place seats that fall within this edge
    while (seatIndex < perimeterSeats.length) {
      const targetDistance = (seatIndex + 0.5) * seatSpacing;

      if (targetDistance >= edgeEnd) {
        break; // This seat belongs to a later edge
      }

      if (targetDistance >= edgeStart) {
        // This seat falls on this edge
        const distAlongEdge = targetDistance - edgeStart;
        const pos = getPositionAlongEdge(edge, distAlongEdge, seatDistance);

        const originalSeat = perimeterSeats[seatIndex];
        virtualSeats.push({
          id: `virtual-seat-${seatIndex + 1}`,
          perimeterNumber: seatIndex + 1,
          absoluteX: pos.x,
          absoluteY: pos.y,
          originalSeatId: originalSeat.seatId,
          originalTableId: originalSeat.tableId,
          originalSeatNumber: originalSeat.originalNumber,
        });
      }

      seatIndex++;
    }

    cumulativeDistance = edgeEnd;
  }

  return virtualSeats;
}

/**
 * Sort edges to form a continuous clockwise path around the combined shape.
 * Starts from the TOP-LEFT corner (highest point, furthest left) and goes clockwise.
 *
 * Order: Top edges (left to right) → Right edges (top to bottom) →
 *        Bottom edges (right to left) → Left edges (bottom to top)
 */
function sortEdgesClockwise(edges: EdgeSegment[], tables: TableForPerimeter[]): EdgeSegment[] {
  if (edges.length === 0) return [];

  // Get combined bounds to determine the shape's extent
  const bounds = getCombinedBounds(tables);

  // Group edges by their direction/side
  const topEdges: EdgeSegment[] = [];
  const rightEdges: EdgeSegment[] = [];
  const bottomEdges: EdgeSegment[] = [];
  const leftEdges: EdgeSegment[] = [];

  for (const edge of edges) {
    switch (edge.edge) {
      case 'top':
        topEdges.push(edge);
        break;
      case 'right':
        rightEdges.push(edge);
        break;
      case 'bottom':
        bottomEdges.push(edge);
        break;
      case 'left':
        leftEdges.push(edge);
        break;
    }
  }

  // Sort each group appropriately for clockwise traversal:
  // - Top edges: sort by X ascending (left to right)
  // - Right edges: sort by Y ascending (top to bottom)
  // - Bottom edges: sort by X descending (right to left)
  // - Left edges: sort by Y descending (bottom to top)

  topEdges.sort((a, b) => a.startX - b.startX);
  rightEdges.sort((a, b) => a.startY - b.startY);
  bottomEdges.sort((a, b) => b.startX - a.startX);  // Descending
  leftEdges.sort((a, b) => b.startY - a.startY);    // Descending

  // Combine in clockwise order starting from top-left
  return [...topEdges, ...rightEdges, ...bottomEdges, ...leftEdges];
}

/**
 * Get the position of a point along an edge, offset outward by seatDistance
 */
function getPositionAlongEdge(
  edge: EdgeSegment,
  distanceAlongEdge: number,
  seatDistance: number
): { x: number; y: number } {
  // Calculate the fraction along the edge
  const fraction = edge.length > 0 ? distanceAlongEdge / edge.length : 0;

  // Interpolate position along the edge
  const x = edge.startX + (edge.endX - edge.startX) * fraction;
  const y = edge.startY + (edge.endY - edge.startY) * fraction;

  // Offset perpendicular to the edge (outward)
  let offsetX = 0;
  let offsetY = 0;

  switch (edge.edge) {
    case 'top':
      offsetY = -seatDistance; // Above the table
      break;
    case 'bottom':
      offsetY = seatDistance; // Below the table
      break;
    case 'left':
      offsetX = -seatDistance; // Left of the table
      break;
    case 'right':
      offsetX = seatDistance; // Right of the table
      break;
  }

  return { x: x + offsetX, y: y + offsetY };
}

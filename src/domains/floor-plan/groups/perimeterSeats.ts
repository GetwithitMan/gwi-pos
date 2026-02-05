/**
 * GWI POS - Floor Plan Domain
 * Perimeter Seat Renumbering for Virtual Table Groups
 *
 * PROPER PERIMETER WALK for L-shapes and complex arrangements:
 * 1. Find the topmost point (12 o'clock starting position)
 * 2. Walk clockwise around actual table edges, not bounding box
 * 3. Assign seat numbers sequentially along the walk
 */

export interface SeatWithPosition {
  id: string;
  tableId: string;
  seatNumber: number;
  label: string;
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
  rotation?: number;
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
  perimeterNumber: number;
  originalLabel: string;
  perimeterLabel: string;
}

export interface VirtualSeatPosition {
  id: string;
  perimeterNumber: number;
  absoluteX: number;
  absoluteY: number;
  originalSeatId: string;
  originalTableId: string;
  originalSeatNumber: number;
}

function getCombinedBounds(tables: TableForPerimeter[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const table of tables) {
    minX = Math.min(minX, table.posX);
    minY = Math.min(minY, table.posY);
    maxX = Math.max(maxX, table.posX + table.width);
    maxY = Math.max(maxY, table.posY + table.height);
  }
  return { minX, minY, maxX, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

function getAbsoluteSeats(tables: TableForPerimeter[]): SeatWithPosition[] {
  const seats: SeatWithPosition[] = [];
  for (const table of tables) {
    const cx = table.posX + table.width / 2;
    const cy = table.posY + table.height / 2;
    const rad = ((table.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const seat of table.seats) {
      const rx = seat.relativeX * cos - seat.relativeY * sin;
      const ry = seat.relativeX * sin + seat.relativeY * cos;
      seats.push({
        id: seat.id,
        tableId: table.id,
        seatNumber: seat.seatNumber,
        label: seat.label,
        absoluteX: cx + rx,
        absoluteY: cy + ry,
      });
    }
  }
  return seats;
}

/**
 * Calculate angle from center to seat, normalized to start at 12 o'clock (top)
 * Returns value 0-360 where 0 = top, 90 = right, 180 = bottom, 270 = left
 */
function getClockwiseAngle(seatX: number, seatY: number, centerX: number, centerY: number): number {
  // atan2 returns -PI to PI, with 0 pointing right
  // We want 0 to be at top (12 o'clock), going clockwise
  const angle = Math.atan2(seatX - centerX, centerY - seatY); // Note: swapped and negated for clockwise from top
  // Convert to 0-360 range
  return ((angle * 180 / Math.PI) + 360) % 360;
}

/**
 * Calculate perimeter seat numbers using simple radial sorting from the combined center.
 * Start at 12 o'clock (top-center) and go clockwise.
 */
export function calculatePerimeterSeats(tables: TableForPerimeter[]): PerimeterSeatResult[] {
  if (tables.length === 0) return [];

  const absoluteSeats = getAbsoluteSeats(tables);
  if (absoluteSeats.length === 0) return [];

  // Calculate the center of ALL tables combined
  const bounds = getCombinedBounds(tables);
  const { centerX, centerY } = bounds;

  // Sort seats by their clockwise angle from center, starting at 12 o'clock
  const seatsWithAngles = absoluteSeats.map(seat => ({
    ...seat,
    angle: getClockwiseAngle(seat.absoluteX, seat.absoluteY, centerX, centerY),
  }));

  // Sort by angle (0 = top, going clockwise)
  seatsWithAngles.sort((a, b) => a.angle - b.angle);

  const tableNameMap = new Map(tables.map((t) => [t.id, t.name]));

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

export function getPerimeterSeatCount(tables: TableForPerimeter[]): number {
  return tables.reduce((sum, t) => sum + t.seats.length, 0);
}

export function getGroupDisplayName(tables: TableForPerimeter[]): string {
  const names = tables.map(t => t.name);
  const count = getPerimeterSeatCount(tables);
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} • ${count} seats`;
  if (names.length === 2) return `${names[0]} & ${names[1]} • Party of ${count}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]} • Party of ${count}`;
}

export function createPerimeterLookup(results: PerimeterSeatResult[]): Map<string, number> {
  return new Map(results.map(r => [r.seatId, r.perimeterNumber]));
}

export function getInnerSeats(tables: TableForPerimeter[]): Set<string> {
  if (tables.length < 2) return new Set();
  const innerSeatIds = new Set<string>();
  const OVERLAP_ZONE = 44;

  for (const table of tables) {
    const tL = table.posX, tR = table.posX + table.width;
    const tT = table.posY, tB = table.posY + table.height;

    for (const seat of table.seats) {
      const isOnRight = seat.relativeX > table.width / 4;
      const isOnLeft = seat.relativeX < -table.width / 4;
      const isOnBottom = seat.relativeY > table.height / 4;
      const isOnTop = seat.relativeY < -table.height / 4;

      for (const other of tables) {
        if (other.id === table.id) continue;
        const oL = other.posX, oR = other.posX + other.width;
        const oT = other.posY, oB = other.posY + other.height;
        const hasV = tT < oB + OVERLAP_ZONE && tB > oT - OVERLAP_ZONE;
        const hasH = tL < oR + OVERLAP_ZONE && tR > oL - OVERLAP_ZONE;

        if (isOnRight && hasV && oL - tR >= -5 && oL - tR <= OVERLAP_ZONE) { innerSeatIds.add(seat.id); break; }
        if (isOnLeft && hasV && tL - oR >= -5 && tL - oR <= OVERLAP_ZONE) { innerSeatIds.add(seat.id); break; }
        if (isOnBottom && hasH && oT - tB >= -5 && oT - tB <= OVERLAP_ZONE) { innerSeatIds.add(seat.id); break; }
        if (isOnTop && hasH && tT - oB >= -5 && tT - oB <= OVERLAP_ZONE) { innerSeatIds.add(seat.id); break; }
      }
    }
  }
  return innerSeatIds;
}

export function createEnhancedPerimeterLookup(tables: TableForPerimeter[]): Map<string, { perimeterNumber: number; isVisible: boolean }> {
  const results = calculatePerimeterSeats(tables);
  const inner = getInnerSeats(tables);
  const lookup = new Map<string, { perimeterNumber: number; isVisible: boolean }>();
  for (const r of results) {
    lookup.set(r.seatId, { perimeterNumber: r.perimeterNumber, isVisible: !inner.has(r.seatId) });
  }
  return lookup;
}

// ============================================================================
// VIRTUAL SEAT POSITION GENERATION
// Generate evenly-spaced seat positions around the combined table perimeter
// Seats hug the actual table edges, following L-shapes and complex arrangements
// ============================================================================

interface OuterEdge {
  tableId: string;
  edge: 'top' | 'right' | 'bottom' | 'left';
  x1: number; y1: number;
  x2: number; y2: number;
  length: number;
  angle: number; // Clockwise angle from 12 o'clock for sorting
}

/**
 * Find the starting point for seat numbering:
 * - Find the leftmost table
 * - Use the top-left corner of that table as the starting point
 */
function findStartingPoint(tables: TableForPerimeter[]): { x: number; y: number } {
  if (tables.length === 0) return { x: 0, y: 0 };

  // Find the leftmost table (smallest posX)
  // If tied, pick the one with smallest posY (highest on screen)
  let leftmostTable = tables[0];
  for (const table of tables) {
    if (table.posX < leftmostTable.posX ||
        (table.posX === leftmostTable.posX && table.posY < leftmostTable.posY)) {
      leftmostTable = table;
    }
  }

  // Return the top-left corner of the leftmost table
  return { x: leftmostTable.posX, y: leftmostTable.posY };
}

/**
 * Get all outer edges of the combined tables (edges not touching another table)
 */
function getOuterEdges(tables: TableForPerimeter[]): OuterEdge[] {
  // Tables snap at ~44px, so use 50px threshold to detect "touching"
  const TOUCH_THRESHOLD = 50;
  const edges: OuterEdge[] = [];
  const bounds = getCombinedBounds(tables);
  const { centerX, centerY } = bounds;

  for (const table of tables) {
    const l = table.posX;
    const r = table.posX + table.width;
    const t = table.posY;
    const b = table.posY + table.height;

    // Define edges in clockwise order for each table
    const tableEdges: Array<{ edge: 'top' | 'right' | 'bottom' | 'left'; x1: number; y1: number; x2: number; y2: number }> = [
      { edge: 'top', x1: l, y1: t, x2: r, y2: t },
      { edge: 'right', x1: r, y1: t, x2: r, y2: b },
      { edge: 'bottom', x1: r, y1: b, x2: l, y2: b },
      { edge: 'left', x1: l, y1: b, x2: l, y2: t },
    ];

    for (const e of tableEdges) {
      let isCovered = false;

      for (const other of tables) {
        if (other.id === table.id) continue;
        const oL = other.posX;
        const oR = other.posX + other.width;
        const oT = other.posY;
        const oB = other.posY + other.height;

        if (e.edge === 'top' && Math.abs(oB - t) <= TOUCH_THRESHOLD && oL < r && oR > l) { isCovered = true; break; }
        if (e.edge === 'bottom' && Math.abs(oT - b) <= TOUCH_THRESHOLD && oL < r && oR > l) { isCovered = true; break; }
        if (e.edge === 'left' && Math.abs(oR - l) <= TOUCH_THRESHOLD && oT < b && oB > t) { isCovered = true; break; }
        if (e.edge === 'right' && Math.abs(oL - r) <= TOUCH_THRESHOLD && oT < b && oB > t) { isCovered = true; break; }
      }

      if (!isCovered) {
        const length = Math.sqrt(Math.pow(e.x2 - e.x1, 2) + Math.pow(e.y2 - e.y1, 2));
        if (length > 0) {
          // Calculate angle of edge midpoint for sorting
          const midX = (e.x1 + e.x2) / 2;
          const midY = (e.y1 + e.y2) / 2;
          const angle = getClockwiseAngle(midX, midY, centerX, centerY);
          edges.push({ tableId: table.id, edge: e.edge, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, length, angle });
        }
      }
    }
  }

  // Sort edges clockwise by their midpoint angle
  edges.sort((a, b) => a.angle - b.angle);

  // Find the starting point (top-left of leftmost table)
  const startPoint = findStartingPoint(tables);

  // Find the edge that starts closest to the starting point
  let bestEdgeIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const dx = edge.x1 - startPoint.x;
    const dy = edge.y1 - startPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestEdgeIdx = i;
    }
  }

  // Rotate the array so the best edge comes first
  if (bestEdgeIdx > 0) {
    const rotated = [...edges.slice(bestEdgeIdx), ...edges.slice(0, bestEdgeIdx)];
    return rotated;
  }

  return edges;
}

/**
 * A point along the perimeter path with its offset direction for seat placement
 */
interface PerimeterPoint {
  x: number;
  y: number;
  // Offset direction (normalized) - points outward from table
  offsetX: number;
  offsetY: number;
  distFromStart: number; // Cumulative distance from start of perimeter
}

/**
 * Build a continuous perimeter path including corners.
 * Corners get diagonal offsets so seats at corners point outward at 45 degrees.
 */
function buildPerimeterPath(edges: OuterEdge[]): PerimeterPoint[] {
  if (edges.length === 0) return [];

  const points: PerimeterPoint[] = [];
  let cumDist = 0;

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const nextEdge = edges[(i + 1) % edges.length];

    // Get offset direction for this edge (perpendicular, pointing outward)
    const edgeOffset = getEdgeOffset(edge.edge);

    // Add start point of edge (this is also the corner from previous edge)
    // For corners, we blend the offset directions
    if (i === 0) {
      // First point - use this edge's offset
      points.push({
        x: edge.x1,
        y: edge.y1,
        offsetX: edgeOffset.x,
        offsetY: edgeOffset.y,
        distFromStart: cumDist,
      });
    }

    // Add the end point of this edge
    cumDist += edge.length;

    // Calculate corner offset (blend this edge and next edge directions)
    const nextOffset = getEdgeOffset(nextEdge.edge);
    // Average and normalize for diagonal corners
    let cornerOffsetX = (edgeOffset.x + nextOffset.x);
    let cornerOffsetY = (edgeOffset.y + nextOffset.y);
    const cornerLen = Math.sqrt(cornerOffsetX * cornerOffsetX + cornerOffsetY * cornerOffsetY);
    if (cornerLen > 0) {
      cornerOffsetX /= cornerLen;
      cornerOffsetY /= cornerLen;
    }

    points.push({
      x: edge.x2,
      y: edge.y2,
      offsetX: cornerOffsetX,
      offsetY: cornerOffsetY,
      distFromStart: cumDist,
    });
  }

  return points;
}

/**
 * Get the outward offset direction for an edge type
 */
function getEdgeOffset(edge: 'top' | 'right' | 'bottom' | 'left'): { x: number; y: number } {
  switch (edge) {
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
  }
}

/**
 * Interpolate position and offset along the perimeter path at a given distance
 */
function interpolatePerimeter(points: PerimeterPoint[], dist: number, totalPerimeter: number): { x: number; y: number; offsetX: number; offsetY: number } {
  // Handle wrapping
  const normalizedDist = ((dist % totalPerimeter) + totalPerimeter) % totalPerimeter;

  // Find the two points we're between
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (normalizedDist >= p1.distFromStart && normalizedDist <= p2.distFromStart) {
      const segmentLength = p2.distFromStart - p1.distFromStart;
      if (segmentLength === 0) {
        return { x: p1.x, y: p1.y, offsetX: p1.offsetX, offsetY: p1.offsetY };
      }

      const t = (normalizedDist - p1.distFromStart) / segmentLength;

      // Lerp position
      const x = p1.x + (p2.x - p1.x) * t;
      const y = p1.y + (p2.y - p1.y) * t;

      // Lerp and normalize offset
      let offsetX = p1.offsetX + (p2.offsetX - p1.offsetX) * t;
      let offsetY = p1.offsetY + (p2.offsetY - p1.offsetY) * t;
      const len = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
      if (len > 0) {
        offsetX /= len;
        offsetY /= len;
      }

      return { x, y, offsetX, offsetY };
    }
  }

  // Fallback to last point
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, offsetX: last.offsetX, offsetY: last.offsetY };
}

// Collision detection constants
const SEAT_RADIUS = 12; // Half of 24px seat diameter
const MIN_GAP = 3; // Minimum 3px gap between any objects
const SEAT_TO_TABLE_CLEARANCE = SEAT_RADIUS + MIN_GAP; // 15px - Seat center must be this far from table edge
const SEAT_TO_SEAT_MIN_DIST = SEAT_RADIUS * 2 + MIN_GAP; // 27px minimum between seat centers

/**
 * Check if a seat position collides with any table.
 * A collision occurs if the seat center is closer than SEAT_TO_TABLE_CLEARANCE to any table edge.
 * Returns true if collision detected.
 */
function collidesWithTable(seatX: number, seatY: number, tables: TableForPerimeter[]): boolean {
  for (const table of tables) {
    // Check if seat center is within the "forbidden zone" (table + clearance)
    const left = table.posX - SEAT_TO_TABLE_CLEARANCE;
    const right = table.posX + table.width + SEAT_TO_TABLE_CLEARANCE;
    const top = table.posY - SEAT_TO_TABLE_CLEARANCE;
    const bottom = table.posY + table.height + SEAT_TO_TABLE_CLEARANCE;

    if (seatX > left && seatX < right && seatY > top && seatY < bottom) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a seat collides with already-placed seats
 * Returns true if collision detected
 */
function collidesWithSeats(
  seatX: number,
  seatY: number,
  placedSeats: Array<{ x: number; y: number }>
): boolean {
  for (const placed of placedSeats) {
    const dx = seatX - placed.x;
    const dy = seatY - placed.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SEAT_TO_SEAT_MIN_DIST) {
      return true;
    }
  }
  return false;
}

/**
 * Generate virtual seat positions evenly spaced around the perimeter.
 * Seats follow the actual table edges (hugging L-shapes), with minimum spacing enforced.
 * Corners are utilized - seats at corners get diagonal offsets.
 *
 * COLLISION RULES:
 * - Seats must have 3px minimum gap from table edges
 * - Seats must have 3px minimum gap from other seats (27px center-to-center)
 * - If perimeter is too small for all seats, we cap at what fits
 */
export function generateVirtualSeatPositions(tables: TableForPerimeter[], seatDistance = 22): VirtualSeatPosition[] {
  if (tables.length === 0) return [];

  const totalSeats = tables.reduce((sum, t) => sum + t.seats.length, 0);
  if (totalSeats === 0) return [];

  const outerEdges = getOuterEdges(tables);
  if (outerEdges.length === 0) return [];

  // Build continuous perimeter path with corner support
  const perimeterPath = buildPerimeterPath(outerEdges);
  if (perimeterPath.length < 2) return [];

  // Calculate total perimeter
  const totalPerimeter = perimeterPath[perimeterPath.length - 1].distFromStart;
  if (totalPerimeter === 0) return [];

  // STANDARD SEAT SPACING - seats must not overlap (27px = 24px diameter + 3px gap)
  const MIN_SPACING = SEAT_TO_SEAT_MIN_DIST;

  // Calculate how many seats can actually fit at minimum spacing
  const maxSeatsAtMinSpacing = Math.floor(totalPerimeter / MIN_SPACING);

  // Use the minimum of requested seats and what physically fits
  const seatsToPlace = Math.min(totalSeats, maxSeatsAtMinSpacing);
  if (seatsToPlace === 0) return [];

  // Calculate actual spacing (evenly distributed)
  const effectiveSpacing = totalPerimeter / seatsToPlace;

  const perimeterSeats = calculatePerimeterSeats(tables);
  const virtualSeats: VirtualSeatPosition[] = [];
  const placedPositions: Array<{ x: number; y: number }> = [];

  // Place seats evenly around the perimeter
  for (let seatIdx = 0; seatIdx < seatsToPlace; seatIdx++) {
    // Calculate distance along perimeter for this seat
    const dist = (seatIdx + 0.5) * effectiveSpacing; // +0.5 to center within segment

    // Get position and offset at this distance
    const { x, y, offsetX, offsetY } = interpolatePerimeter(perimeterPath, dist, totalPerimeter);

    // Start with base offset distance
    let currentDistance = seatDistance;

    // Calculate initial seat position
    let seatX = x + offsetX * currentDistance;
    let seatY = y + offsetY * currentDistance;

    // Push outward until clear of all tables (max 20 attempts, 3px each)
    let tableAttempts = 0;
    while (collidesWithTable(seatX, seatY, tables) && tableAttempts < 20) {
      currentDistance += 3; // Push outward in 3px increments
      seatX = x + offsetX * currentDistance;
      seatY = y + offsetY * currentDistance;
      tableAttempts++;
    }

    // Push outward until clear of already-placed seats (max 10 attempts, 3px each)
    let seatAttempts = 0;
    while (collidesWithSeats(seatX, seatY, placedPositions) && seatAttempts < 10) {
      currentDistance += 3; // Push outward in 3px increments
      seatX = x + offsetX * currentDistance;
      seatY = y + offsetY * currentDistance;
      seatAttempts++;
    }

    // Record this seat's position for future collision checks
    placedPositions.push({ x: seatX, y: seatY });

    const orig = perimeterSeats[seatIdx % perimeterSeats.length];
    virtualSeats.push({
      id: `virtual-seat-${seatIdx + 1}`,
      perimeterNumber: seatIdx + 1,
      absoluteX: seatX,
      absoluteY: seatY,
      originalSeatId: orig?.seatId || `seat-${seatIdx}`,
      originalTableId: orig?.tableId || tables[0].id,
      originalSeatNumber: orig?.originalNumber || seatIdx + 1,
    });
  }

  return virtualSeats;
}

/**
 * Get total distance along perimeter before a given edge index
 */
function getTotalDistBefore(edges: OuterEdge[], edgeIndex: number): number {
  let total = 0;
  for (let i = 0; i < edgeIndex; i++) {
    total += edges[i].length;
  }
  return total;
}

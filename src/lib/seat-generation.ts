/**
 * GWI POS - Seat Position Generation Utilities
 *
 * Pure functions for calculating seat positions around tables.
 * All positions are in PIXELS relative to table center.
 *
 * Coordinate System:
 * - (0, 0) = Table center
 * - Positive X = Right
 * - Positive Y = Down
 * - Angle: 0° = Up, 90° = Right, 180° = Down, 270° = Left
 */

// =============================================================================
// TYPES
// =============================================================================

export type TableShape = 'rectangle' | 'square' | 'round' | 'oval' | 'booth';
export type SeatPattern =
  | 'all_around'
  | 'two_sides'
  | 'one_side'
  | 'booth'
  | 'heads_only'
  | 'custom';

export interface SeatPosition {
  seatNumber: number; // 1-based
  relativeX: number; // Offset from table center (pixels)
  relativeY: number; // Offset from table center (pixels)
  angle: number; // Facing direction (0 = up, 90 = right, 180 = down, 270 = left)
}

export interface GenerateSeatPositionsParams {
  shape: TableShape;
  pattern: SeatPattern;
  capacity: number;
  width: number; // Table width in pixels
  height: number; // Table height in pixels
  seatRadius?: number; // Default 15px
  seatGap?: number; // Min gap between seats, default 5px
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_SEAT_RADIUS = 15; // pixels
const DEFAULT_SEAT_GAP = 5; // pixels
const CLEARANCE = 25; // Distance from table edge to seat center

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Generate seat positions for a table based on shape and pattern
 */
export function generateSeatPositions(
  params: GenerateSeatPositionsParams
): SeatPosition[] {
  const { shape, pattern } = params;

  // Route to shape-specific generator
  if (shape === 'round') {
    return generateRoundSeats(params);
  }

  if (shape === 'oval') {
    return generateOvalSeats(params);
  }

  if (shape === 'booth') {
    return generateBoothSeats(params);
  }

  // Rectangle and square use same logic
  return generateRectangleSeats(params);
}

// =============================================================================
// RECTANGLE / SQUARE SEATS
// =============================================================================

/**
 * Generate seats for rectangle/square tables
 * Clockwise distribution: top → right → bottom → left
 */
export function generateRectangleSeats(
  params: GenerateSeatPositionsParams
): SeatPosition[] {
  const {
    pattern,
    capacity,
    width,
    height,
    seatRadius = DEFAULT_SEAT_RADIUS,
    seatGap = DEFAULT_SEAT_GAP,
  } = params;

  const seats: SeatPosition[] = [];
  const halfW = width / 2;
  const halfH = height / 2;

  // Special patterns
  if (pattern === 'heads_only') {
    // Only 2 seats at short ends
    seats.push({
      seatNumber: 1,
      relativeX: 0,
      relativeY: -(halfH + CLEARANCE),
      angle: 180, // Face down toward table
    });
    seats.push({
      seatNumber: 2,
      relativeX: 0,
      relativeY: halfH + CLEARANCE,
      angle: 0, // Face up toward table
    });
    return seats;
  }

  if (pattern === 'one_side') {
    // All seats on top edge
    return distributeSeatsOnEdge(
      capacity,
      width,
      0,
      -(halfH + CLEARANCE),
      180,
      seatRadius,
      seatGap
    );
  }

  if (pattern === 'two_sides') {
    // Split between top and bottom
    const seatsPerSide = Math.ceil(capacity / 2);
    const topSeats = distributeSeatsOnEdge(
      seatsPerSide,
      width,
      0,
      -(halfH + CLEARANCE),
      180,
      seatRadius,
      seatGap
    );
    const bottomSeats = distributeSeatsOnEdge(
      capacity - seatsPerSide,
      width,
      0,
      halfH + CLEARANCE,
      0,
      seatRadius,
      seatGap,
      seatsPerSide + 1
    );
    return [...topSeats, ...bottomSeats];
  }

  if (pattern === 'booth') {
    // One seat at each head + rest on long sides
    const headSeats = 2;
    const sideSeats = capacity - headSeats;
    const seatsPerSide = Math.ceil(sideSeats / 2);

    seats.push({
      seatNumber: 1,
      relativeX: 0,
      relativeY: -(halfH + CLEARANCE),
      angle: 180,
    });

    const rightSeats = distributeSeatsOnEdge(
      seatsPerSide,
      height,
      halfW + CLEARANCE,
      0,
      270,
      seatRadius,
      seatGap,
      2,
      true
    );
    seats.push(...rightSeats);

    seats.push({
      seatNumber: 2 + seatsPerSide,
      relativeX: 0,
      relativeY: halfH + CLEARANCE,
      angle: 0,
    });

    const leftSeats = distributeSeatsOnEdge(
      sideSeats - seatsPerSide,
      height,
      -(halfW + CLEARANCE),
      0,
      90,
      seatRadius,
      seatGap,
      3 + seatsPerSide,
      true
    );
    seats.push(...leftSeats);

    return seats;
  }

  // Default: all_around pattern
  // Calculate perimeter and distribute proportionally
  const perimeter = 2 * (width + height);
  const topCount = Math.round((width / perimeter) * capacity);
  const rightCount = Math.round((height / perimeter) * capacity);
  const bottomCount = Math.round((width / perimeter) * capacity);
  const leftCount = capacity - topCount - rightCount - bottomCount;

  let seatNum = 1;

  // Top edge (left to right)
  const topSeats = distributeSeatsOnEdge(
    topCount,
    width,
    0,
    -(halfH + CLEARANCE),
    180,
    seatRadius,
    seatGap,
    seatNum
  );
  seats.push(...topSeats);
  seatNum += topCount;

  // Right edge (top to bottom)
  const rightSeats = distributeSeatsOnEdge(
    rightCount,
    height,
    halfW + CLEARANCE,
    0,
    270,
    seatRadius,
    seatGap,
    seatNum,
    true
  );
  seats.push(...rightSeats);
  seatNum += rightCount;

  // Bottom edge (right to left)
  const bottomSeats = distributeSeatsOnEdge(
    bottomCount,
    width,
    0,
    halfH + CLEARANCE,
    0,
    seatRadius,
    seatGap,
    seatNum,
    false,
    true // Reverse for right-to-left
  );
  seats.push(...bottomSeats);
  seatNum += bottomCount;

  // Left edge (bottom to top)
  const leftSeats = distributeSeatsOnEdge(
    leftCount,
    height,
    -(halfW + CLEARANCE),
    0,
    90,
    seatRadius,
    seatGap,
    seatNum,
    true,
    true // Reverse for bottom-to-top
  );
  seats.push(...leftSeats);

  return seats;
}

/**
 * Helper: Distribute seats evenly along an edge
 */
function distributeSeatsOnEdge(
  count: number,
  edgeLength: number,
  baseX: number,
  baseY: number,
  angle: number,
  seatRadius: number,
  seatGap: number,
  startSeatNum = 1,
  vertical = false,
  reverse = false
): SeatPosition[] {
  if (count === 0) return [];

  const seats: SeatPosition[] = [];
  const seatDiameter = seatRadius * 2;
  const availableSpace = edgeLength - seatDiameter;
  const spacing = count > 1 ? availableSpace / (count - 1) : 0;

  for (let i = 0; i < count; i++) {
    const index = reverse ? count - 1 - i : i;
    const offset = count === 1 ? 0 : -availableSpace / 2 + index * spacing;

    seats.push({
      seatNumber: startSeatNum + i,
      relativeX: vertical ? baseX : baseX + offset,
      relativeY: vertical ? baseY + offset : baseY,
      angle: angle,
    });
  }

  return seats;
}

// =============================================================================
// ROUND SEATS
// =============================================================================

/**
 * Generate seats for round tables
 * Evenly distributed around circumference, starting at top (12 o'clock)
 */
export function generateRoundSeats(
  params: GenerateSeatPositionsParams
): SeatPosition[] {
  const {
    capacity,
    width,
    height,
    seatRadius = DEFAULT_SEAT_RADIUS,
  } = params;

  const seats: SeatPosition[] = [];
  const radius = Math.min(width, height) / 2 + CLEARANCE;

  // Start at top (12 o'clock = -90 degrees = -PI/2)
  const startAngle = -Math.PI / 2;
  const angleStep = (2 * Math.PI) / capacity;

  for (let i = 0; i < capacity; i++) {
    const angle = startAngle + i * angleStep;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);

    // Calculate facing angle (toward center)
    // Angle in our system: 0 = up, 90 = right, 180 = down, 270 = left
    const facingAngle = ((angle + Math.PI) * 180) / Math.PI;
    const normalizedAngle = ((facingAngle % 360) + 360) % 360;

    seats.push({
      seatNumber: i + 1,
      relativeX: Math.round(x),
      relativeY: Math.round(y),
      angle: Math.round(normalizedAngle),
    });
  }

  return seats;
}

// =============================================================================
// OVAL SEATS
// =============================================================================

/**
 * Generate seats for oval tables
 * Similar to round but with stretched ellipse
 */
export function generateOvalSeats(
  params: GenerateSeatPositionsParams
): SeatPosition[] {
  const {
    capacity,
    width,
    height,
    seatRadius = DEFAULT_SEAT_RADIUS,
  } = params;

  const seats: SeatPosition[] = [];
  const radiusX = width / 2 + CLEARANCE;
  const radiusY = height / 2 + CLEARANCE;

  // Start at top (12 o'clock = -90 degrees = -PI/2)
  const startAngle = -Math.PI / 2;
  const angleStep = (2 * Math.PI) / capacity;

  for (let i = 0; i < capacity; i++) {
    const angle = startAngle + i * angleStep;
    const x = radiusX * Math.cos(angle);
    const y = radiusY * Math.sin(angle);

    // Calculate facing angle (toward center)
    const facingAngle = ((angle + Math.PI) * 180) / Math.PI;
    const normalizedAngle = ((facingAngle % 360) + 360) % 360;

    seats.push({
      seatNumber: i + 1,
      relativeX: Math.round(x),
      relativeY: Math.round(y),
      angle: Math.round(normalizedAngle),
    });
  }

  return seats;
}

// =============================================================================
// BOOTH SEATS
// =============================================================================

/**
 * Generate seats for booth tables
 * All seats on front (open) side
 */
export function generateBoothSeats(
  params: GenerateSeatPositionsParams
): SeatPosition[] {
  const {
    capacity,
    width,
    seatRadius = DEFAULT_SEAT_RADIUS,
    seatGap = DEFAULT_SEAT_GAP,
  } = params;

  // All seats on bottom edge (open side)
  return distributeSeatsOnEdge(
    capacity,
    width,
    0,
    params.height / 2 + CLEARANCE,
    0, // Face up toward table
    seatRadius,
    seatGap
  );
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Redistribute seats when capacity changes
 * Maintains clockwise ordering, recalculates positions
 */
export function redistributeSeats(
  existingPositions: SeatPosition[],
  newSeatCount: number,
  shape: TableShape,
  width: number,
  height: number
): SeatPosition[] {
  // Generate fresh positions with new count
  return generateSeatPositions({
    shape,
    pattern: 'all_around',
    capacity: newSeatCount,
    width,
    height,
  });
}

/**
 * Insert a new seat at a specific index
 * Renumbers all seats and redistributes positions
 */
export function insertSeatAt(
  existingPositions: SeatPosition[],
  insertAtIndex: number, // 0-based
  shape: TableShape,
  width: number,
  height: number
): SeatPosition[] {
  const newCapacity = existingPositions.length + 1;

  // Generate positions for new capacity
  const newPositions = generateSeatPositions({
    shape,
    pattern: 'all_around',
    capacity: newCapacity,
    width,
    height,
  });

  // Renumber to reflect insertion point
  const result: SeatPosition[] = [];

  for (let i = 0; i < newPositions.length; i++) {
    if (i < insertAtIndex) {
      // Before insertion point - keep original numbering
      result.push({
        ...newPositions[i],
        seatNumber: i + 1,
      });
    } else if (i === insertAtIndex) {
      // New seat at insertion point
      result.push({
        ...newPositions[i],
        seatNumber: insertAtIndex + 1,
      });
    } else {
      // After insertion point - increment numbering
      result.push({
        ...newPositions[i],
        seatNumber: i + 1,
      });
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// Floor Plan Constants - Single Source of Truth
// ═══════════════════════════════════════════════════════════════

// Scale
export const PIXELS_PER_FOOT = 20;

// Seat positioning
export const SEAT_RADIUS = 20;           // Visual size of seat circle
export const SEAT_HIT_RADIUS = 25;       // Click target (larger than visual)
export const SEAT_COLLISION_RADIUS = 8;  // Collision detection (smaller = allow closer)

// Seat offsets from table edge
export const SEAT_DEFAULT_OFFSET = 8;    // Default distance from table
export const SEAT_MIN_OFFSET = 5;        // Minimum when compressed
export const SEAT_MAX_OFFSET = 50;       // Maximum boundary distance

// Seat boundary (dragging limits)
export const SEAT_BOUNDARY_DISTANCE = 35;
export const SEAT_MIN_DISTANCE = 5;

// Angles (0 = facing up/north, clockwise)
export const ANGLE = {
  UP: 0,
  RIGHT: 90,
  DOWN: 180,
  LEFT: 270,
} as const;

// Table defaults
export const TABLE_DEFAULT_WIDTH = 100;
export const TABLE_DEFAULT_HEIGHT = 100;
export const TABLE_DEFAULT_CAPACITY = 4;
export const TABLE_MIN_WIDTH = 50;
export const TABLE_MIN_HEIGHT = 30;

/**
 * GWI POS - Floor Plan Domain
 * Layer 1: Floor Canvas API
 *
 * Manages floor plans, rooms, fixtures, and collision detection.
 */

import type {
  FloorPlan,
  Fixture,
  FixtureType,
  FixtureCategory,
  Point,
} from '../shared/types';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_PIXELS_PER_FOOT = 20; // 20px = 1 foot
let pixelsPerFoot = DEFAULT_PIXELS_PER_FOOT;

// =============================================================================
// STATE (In production, this would come from the database)
// =============================================================================

let floorPlans: Map<string, FloorPlan> = new Map();
let fixtures: Map<string, Fixture> = new Map();
let activeRoomId: string | null = null;

// =============================================================================
// COORDINATE SYSTEM
// =============================================================================

/**
 * Convert feet to pixels
 */
export function feetToPixels(feet: number): number {
  return feet * pixelsPerFoot;
}

/**
 * Convert pixels to feet
 */
export function pixelsToFeet(pixels: number): number {
  return pixels / pixelsPerFoot;
}

/**
 * Set the scale (pixels per foot)
 */
export function setScale(pxPerFoot: number): void {
  pixelsPerFoot = pxPerFoot;
}

/**
 * Get current scale
 */
export function getScale(): number {
  return pixelsPerFoot;
}

/**
 * Snap a position to the grid
 */
export function snapToGrid(position: Point, gridSizeFeet: number): Point {
  return {
    x: Math.round(position.x / gridSizeFeet) * gridSizeFeet,
    y: Math.round(position.y / gridSizeFeet) * gridSizeFeet,
  };
}

// =============================================================================
// FLOOR PLAN / ROOM MANAGEMENT
// =============================================================================

/**
 * Get a floor plan by ID
 */
export function getFloorPlan(roomId?: string): FloorPlan | null {
  const id = roomId ?? activeRoomId;
  if (!id) return null;
  return floorPlans.get(id) ?? null;
}

/**
 * Get all rooms/floor plans
 */
export function getAllRooms(): FloorPlan[] {
  return Array.from(floorPlans.values())
    .filter((fp) => fp.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get the currently active room ID
 */
export function getActiveRoom(): string | null {
  return activeRoomId;
}

/**
 * Set the active room
 */
export function setActiveRoom(roomId: string): void {
  if (floorPlans.has(roomId)) {
    activeRoomId = roomId;
  }
}

/**
 * Get rooms by type
 */
export function getRoomsByType(type: string): FloorPlan[] {
  return Array.from(floorPlans.values()).filter(
    (fp) => fp.type === type && fp.isActive
  );
}

/**
 * Get canvas dimensions in pixels for a room
 */
export function getCanvasDimensions(roomId?: string): {
  widthPx: number;
  heightPx: number;
} {
  const fp = getFloorPlan(roomId);
  if (!fp) {
    return { widthPx: 0, heightPx: 0 };
  }
  return {
    widthPx: feetToPixels(fp.widthFeet),
    heightPx: feetToPixels(fp.heightFeet),
  };
}

// =============================================================================
// FLOOR PLAN CRUD
// =============================================================================

/**
 * Create a new floor plan
 */
export function createFloorPlan(
  data: Omit<FloorPlan, 'id'>
): FloorPlan {
  const id = `fp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const floorPlan: FloorPlan = {
    id,
    ...data,
  };
  floorPlans.set(id, floorPlan);

  // Set as active if it's the first one
  if (!activeRoomId) {
    activeRoomId = id;
  }

  return floorPlan;
}

/**
 * Update a floor plan
 */
export function updateFloorPlan(
  roomId: string,
  updates: Partial<FloorPlan>
): void {
  const fp = floorPlans.get(roomId);
  if (fp) {
    floorPlans.set(roomId, { ...fp, ...updates });
  }
}

/**
 * Delete a floor plan
 */
export function deleteFloorPlan(roomId: string): void {
  floorPlans.delete(roomId);
  // Also delete all fixtures in this room
  for (const [id, fixture] of fixtures) {
    if (fixture.roomId === roomId) {
      fixtures.delete(id);
    }
  }
  // Update active room if necessary
  if (activeRoomId === roomId) {
    const rooms = getAllRooms();
    activeRoomId = rooms.length > 0 ? rooms[0].id : null;
  }
}

// =============================================================================
// FIXTURE MANAGEMENT
// =============================================================================

/**
 * Get all fixtures for a room
 */
export function getFixtures(roomId: string): Fixture[] {
  return Array.from(fixtures.values()).filter(
    (f) => f.roomId === roomId && f.isActive
  );
}

/**
 * Get fixtures by type
 */
export function getFixturesByType(
  roomId: string,
  type: FixtureType
): Fixture[] {
  return getFixtures(roomId).filter((f) => f.type === type);
}

/**
 * Get fixtures by category
 */
export function getFixturesByCategory(
  roomId: string,
  category: FixtureCategory
): Fixture[] {
  return getFixtures(roomId).filter((f) => f.category === category);
}

/**
 * Get bar counters (convenience method)
 */
export function getBarCounters(roomId: string): Fixture[] {
  return getFixturesByType(roomId, 'bar_counter');
}

/**
 * Add a fixture
 */
export function addFixture(data: Omit<Fixture, 'id'>): Fixture {
  const id = `fix_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const fixture: Fixture = {
    id,
    ...data,
  };
  fixtures.set(id, fixture);
  return fixture;
}

/**
 * Update a fixture
 */
export function updateFixture(
  fixtureId: string,
  updates: Partial<Fixture>
): void {
  const fixture = fixtures.get(fixtureId);
  if (fixture) {
    fixtures.set(fixtureId, { ...fixture, ...updates });
  }
}

/**
 * Remove a fixture
 */
export function removeFixture(fixtureId: string): void {
  fixtures.delete(fixtureId);
}

// =============================================================================
// COLLISION DETECTION
// =============================================================================

/**
 * Check if a position is blocked by fixtures
 */
export function isPositionBlocked(
  roomId: string,
  position: Point,
  objectWidth: number,
  objectHeight: number
): boolean {
  const roomFixtures = getFixtures(roomId);

  // Calculate object bounds
  const objectLeft = position.x;
  const objectRight = position.x + objectWidth;
  const objectTop = position.y;
  const objectBottom = position.y + objectHeight;

  for (const fixture of roomFixtures) {
    // Skip fixtures that don't block placement
    if (!fixture.blocksPlacement) continue;

    // Check collision based on geometry type
    if (fixture.geometry.type === 'rectangle') {
      const { position: fPos, width, height, rotation } = fixture.geometry;

      // For now, ignore rotation (simplified collision)
      const fixtureLeft = fPos.x;
      const fixtureRight = fPos.x + width;
      const fixtureTop = fPos.y;
      const fixtureBottom = fPos.y + height;

      // AABB collision check
      if (
        objectLeft < fixtureRight &&
        objectRight > fixtureLeft &&
        objectTop < fixtureBottom &&
        objectBottom > fixtureTop
      ) {
        return true;
      }
    } else if (fixture.geometry.type === 'circle') {
      const { center, radius } = fixture.geometry;

      // Check if any corner of the object is inside the circle
      // Or if the circle center is inside the object bounds
      const closestX = Math.max(objectLeft, Math.min(center.x, objectRight));
      const closestY = Math.max(objectTop, Math.min(center.y, objectBottom));

      const distanceX = center.x - closestX;
      const distanceY = center.y - closestY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;

      if (distanceSquared < radius * radius) {
        return true;
      }
    } else if (fixture.geometry.type === 'line') {
      const { start, end } = fixture.geometry;
      const thickness = fixture.thickness || 0.5; // Default wall thickness

      // Convert line to rectangle for collision
      const lineLeft = Math.min(start.x, end.x) - thickness / 2;
      const lineRight = Math.max(start.x, end.x) + thickness / 2;
      const lineTop = Math.min(start.y, end.y) - thickness / 2;
      const lineBottom = Math.max(start.y, end.y) + thickness / 2;

      if (
        objectLeft < lineRight &&
        objectRight > lineLeft &&
        objectTop < lineBottom &&
        objectBottom > lineTop
      ) {
        return true;
      }
    }
    // Add more geometry types as needed
  }

  // Also check room boundaries
  const room = getFloorPlan(roomId);
  if (room) {
    if (
      objectLeft < 0 ||
      objectTop < 0 ||
      objectRight > room.widthFeet ||
      objectBottom > room.heightFeet
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Get fixtures that an object can snap to
 */
export function getSnapTargets(
  roomId: string,
  objectPosition: Point,
  snapDistance: number
): Fixture[] {
  const roomFixtures = getFixtures(roomId);

  return roomFixtures.filter((fixture) => {
    if (!fixture.snapTarget) return false;

    // Calculate distance to fixture (simplified)
    if (fixture.geometry.type === 'rectangle') {
      const { position: fPos, width, height } = fixture.geometry;
      const centerX = fPos.x + width / 2;
      const centerY = fPos.y + height / 2;

      const dx = Math.abs(objectPosition.x - centerX);
      const dy = Math.abs(objectPosition.y - centerY);

      // Check if within snap distance of any edge
      return (
        (dx < width / 2 + snapDistance && dy < height / 2) ||
        (dy < height / 2 + snapDistance && dx < width / 2)
      );
    }

    return false;
  });
}

/**
 * Get the nearest edge point of a fixture
 */
export function getNearestFixtureEdge(
  roomId: string,
  position: Point,
  fixtureId: string
): Point | null {
  const fixture = fixtures.get(fixtureId);
  if (!fixture || fixture.roomId !== roomId) return null;

  if (fixture.geometry.type === 'rectangle') {
    const { position: fPos, width, height } = fixture.geometry;

    // Calculate distances to each edge
    const edges = [
      { x: position.x, y: fPos.y }, // Top edge
      { x: position.x, y: fPos.y + height }, // Bottom edge
      { x: fPos.x, y: position.y }, // Left edge
      { x: fPos.x + width, y: position.y }, // Right edge
    ];

    // Clamp positions to be on the fixture
    edges[0].x = Math.max(fPos.x, Math.min(position.x, fPos.x + width));
    edges[1].x = Math.max(fPos.x, Math.min(position.x, fPos.x + width));
    edges[2].y = Math.max(fPos.y, Math.min(position.y, fPos.y + height));
    edges[3].y = Math.max(fPos.y, Math.min(position.y, fPos.y + height));

    // Find nearest edge
    let nearest = edges[0];
    let minDist = Infinity;

    for (const edge of edges) {
      const dist = Math.sqrt(
        Math.pow(position.x - edge.x, 2) + Math.pow(position.y - edge.y, 2)
      );
      if (dist < minDist) {
        minDist = dist;
        nearest = edge;
      }
    }

    return nearest;
  }

  return null;
}

/**
 * Get the valid placement area (room minus barriers)
 * Returns a simplified polygon of placeable area
 */
export function getPlaceableArea(roomId: string): Point[] {
  const room = getFloorPlan(roomId);
  if (!room) return [];

  // Start with room boundaries
  const area: Point[] = [
    { x: 0, y: 0 },
    { x: room.widthFeet, y: 0 },
    { x: room.widthFeet, y: room.heightFeet },
    { x: 0, y: room.heightFeet },
  ];

  // In a full implementation, we would subtract barrier fixtures
  // For now, return the room boundary
  return area;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the canvas with floor plans from the database
 */
export function initializeFloorPlans(plans: FloorPlan[], fixtureList: Fixture[]): void {
  floorPlans.clear();
  fixtures.clear();

  for (const plan of plans) {
    floorPlans.set(plan.id, plan);
  }

  for (const fixture of fixtureList) {
    fixtures.set(fixture.id, fixture);
  }

  // Set first active room
  const activeRooms = getAllRooms();
  if (activeRooms.length > 0 && !activeRoomId) {
    activeRoomId = activeRooms[0].id;
  }
}

/**
 * Clear all data (for testing)
 */
export function clearAll(): void {
  floorPlans.clear();
  fixtures.clear();
  activeRoomId = null;
}

// =============================================================================
// EXPORT THE API
// =============================================================================

export const FloorCanvasAPI = {
  // Coordinate system
  feetToPixels,
  pixelsToFeet,
  setScale,
  getScale,
  snapToGrid,

  // Room management
  getFloorPlan,
  getAllRooms,
  getActiveRoom,
  setActiveRoom,
  getRoomsByType,
  getCanvasDimensions,

  // Floor plan CRUD
  createFloorPlan,
  updateFloorPlan,
  deleteFloorPlan,

  // Fixture management
  getFixtures,
  getFixturesByType,
  getFixturesByCategory,
  getBarCounters,
  addFixture,
  updateFixture,
  removeFixture,

  // Collision detection
  isPositionBlocked,
  getSnapTargets,
  getNearestFixtureEdge,
  getPlaceableArea,

  // Initialization
  initializeFloorPlans,
  clearAll,
};

export default FloorCanvasAPI;

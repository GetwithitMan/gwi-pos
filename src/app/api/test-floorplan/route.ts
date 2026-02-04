/**
 * GWI POS - Floor Plan Test API (Backend)
 *
 * API endpoint for testing Floor Plan domain services.
 * Access at: http://localhost:3000/api/test-floorplan
 *
 * This tests the backend services without the UI.
 */

import { NextResponse } from 'next/server';
import { FloorCanvasAPI } from '@/domains/floor-plan/canvas';
import type { FloorPlan, Fixture, Table, Point } from '@/domains/floor-plan/shared/types';

// =============================================================================
// SAMPLE DATA (same as frontend test)
// =============================================================================

const sampleFloorPlans: FloorPlan[] = [
  {
    id: 'room-main',
    locationId: 'loc-1',
    name: 'Main Dining',
    type: 'indoor',
    widthFeet: 40,
    heightFeet: 30,
    gridSizeFeet: 1,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'room-bar',
    locationId: 'loc-1',
    name: 'Bar Area',
    type: 'bar',
    widthFeet: 25,
    heightFeet: 20,
    gridSizeFeet: 1,
    isActive: true,
    sortOrder: 2,
  },
];

const sampleFixtures: Fixture[] = [
  {
    id: 'fix-1',
    floorPlanId: 'room-main',
    roomId: 'room-main',
    type: 'wall',
    category: 'barrier',
    label: 'North Wall',
    geometry: { type: 'line', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
    color: '#424242',
    opacity: 1,
    thickness: 0.5,
    height: 'full',
    blocksPlacement: true,
    blocksMovement: true,
    snapTarget: false,
    isActive: true,
  },
  {
    id: 'fix-pillar',
    floorPlanId: 'room-main',
    roomId: 'room-main',
    type: 'pillar',
    category: 'barrier',
    label: 'Support Pillar',
    geometry: { type: 'circle', center: { x: 20, y: 15 }, radius: 1 },
    color: '#9E9E9E',
    opacity: 1,
    thickness: 0,
    height: 'full',
    blocksPlacement: true,
    blocksMovement: true,
    snapTarget: false,
    isActive: true,
  },
  {
    id: 'fix-bar',
    floorPlanId: 'room-bar',
    roomId: 'room-bar',
    type: 'bar_counter',
    category: 'surface',
    label: 'Main Bar',
    geometry: { type: 'rectangle', position: { x: 2, y: 2 }, width: 20, height: 3, rotation: 0 },
    color: '#8D6E63',
    opacity: 1,
    thickness: 0,
    height: 'counter',
    blocksPlacement: true,
    blocksMovement: true,
    snapTarget: true,
    isActive: true,
  },
];

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  data?: unknown;
}

function runTests(): TestResult[] {
  const results: TestResult[] = [];

  // Initialize
  FloorCanvasAPI.clearAll();
  FloorCanvasAPI.initializeFloorPlans(sampleFloorPlans, sampleFixtures);

  // Test 1: Get all rooms
  const rooms = FloorCanvasAPI.getAllRooms();
  results.push({
    name: 'Get All Rooms',
    passed: rooms.length === 2,
    message: `Found ${rooms.length} rooms (expected 2)`,
    data: rooms.map((r) => ({ id: r.id, name: r.name })),
  });

  // Test 2: Get floor plan by ID
  const mainRoom = FloorCanvasAPI.getFloorPlan('room-main');
  results.push({
    name: 'Get Floor Plan by ID',
    passed: mainRoom !== null && mainRoom.name === 'Main Dining',
    message: mainRoom ? `Found: ${mainRoom.name}` : 'Not found',
  });

  // Test 3: Get fixtures for room
  const mainFixtures = FloorCanvasAPI.getFixtures('room-main');
  results.push({
    name: 'Get Fixtures for Room',
    passed: mainFixtures.length === 2,
    message: `Found ${mainFixtures.length} fixtures in Main Dining (expected 2)`,
    data: mainFixtures.map((f) => ({ id: f.id, type: f.type, label: f.label })),
  });

  // Test 4: Get bar counters
  const barCounters = FloorCanvasAPI.getBarCounters('room-bar');
  results.push({
    name: 'Get Bar Counters',
    passed: barCounters.length === 1,
    message: `Found ${barCounters.length} bar counter(s)`,
  });

  // Test 5: Coordinate conversion
  const pixels = FloorCanvasAPI.feetToPixels(10);
  const feetBack = FloorCanvasAPI.pixelsToFeet(pixels);
  results.push({
    name: 'Coordinate Conversion',
    passed: feetBack === 10,
    message: `10ft → ${pixels}px → ${feetBack}ft`,
  });

  // Test 6: Grid snapping
  const snapped = FloorCanvasAPI.snapToGrid({ x: 5.3, y: 7.8 }, 1);
  results.push({
    name: 'Grid Snapping',
    passed: snapped.x === 5 && snapped.y === 8,
    message: `(5.3, 7.8) → (${snapped.x}, ${snapped.y})`,
  });

  // Test 7: Collision detection - open area (should NOT be blocked)
  const openPosition: Point = { x: 5, y: 5 };
  const isOpenBlocked = FloorCanvasAPI.isPositionBlocked('room-main', openPosition, 2, 2);
  results.push({
    name: 'Collision - Open Area',
    passed: !isOpenBlocked,
    message: `Position (5, 5) blocked: ${isOpenBlocked} (expected: false)`,
  });

  // Test 8: Collision detection - on pillar (SHOULD be blocked)
  const pillarPosition: Point = { x: 19, y: 14 }; // Near the pillar at (20, 15)
  const isPillarBlocked = FloorCanvasAPI.isPositionBlocked('room-main', pillarPosition, 2, 2);
  results.push({
    name: 'Collision - On Pillar',
    passed: isPillarBlocked,
    message: `Position (19, 14) blocked: ${isPillarBlocked} (expected: true)`,
  });

  // Test 9: Collision detection - outside room (SHOULD be blocked)
  const outsidePosition: Point = { x: 50, y: 10 }; // Outside room boundaries
  const isOutsideBlocked = FloorCanvasAPI.isPositionBlocked('room-main', outsidePosition, 2, 2);
  results.push({
    name: 'Collision - Outside Room',
    passed: isOutsideBlocked,
    message: `Position (50, 10) blocked: ${isOutsideBlocked} (expected: true)`,
  });

  // Test 10: Get snap targets
  const nearBar: Point = { x: 12, y: 6 }; // Near the bar counter
  const snapTargets = FloorCanvasAPI.getSnapTargets('room-bar', nearBar, 2);
  results.push({
    name: 'Get Snap Targets',
    passed: snapTargets.length >= 1,
    message: `Found ${snapTargets.length} snap target(s) near bar`,
    data: snapTargets.map((f) => f.label),
  });

  // Test 11: Canvas dimensions
  const dimensions = FloorCanvasAPI.getCanvasDimensions('room-main');
  const expectedWidth = 40 * 40; // 40ft * 40px/ft
  const expectedHeight = 30 * 40;
  results.push({
    name: 'Canvas Dimensions',
    passed: dimensions.widthPx === expectedWidth && dimensions.heightPx === expectedHeight,
    message: `${dimensions.widthPx}x${dimensions.heightPx}px (expected ${expectedWidth}x${expectedHeight}px)`,
  });

  // Test 12: Add fixture
  const newFixture = FloorCanvasAPI.addFixture({
    floorPlanId: 'room-main',
    roomId: 'room-main',
    type: 'portable_divider' as any,
    category: 'decorative',
    label: 'Test Divider',
    geometry: { type: 'rectangle', position: { x: 10, y: 10 }, width: 1, height: 5, rotation: 0 },
    color: '#795548',
    opacity: 1,
    thickness: 0,
    height: 'half',
    blocksPlacement: false,
    blocksMovement: false,
    snapTarget: false,
    isActive: true,
  });
  const afterAdd = FloorCanvasAPI.getFixtures('room-main');
  results.push({
    name: 'Add Fixture',
    passed: afterAdd.length === 3 && newFixture.id.startsWith('fix_'),
    message: `Added fixture with ID: ${newFixture.id}. Total fixtures: ${afterAdd.length}`,
  });

  // Test 13: Remove fixture
  FloorCanvasAPI.removeFixture(newFixture.id);
  const afterRemove = FloorCanvasAPI.getFixtures('room-main');
  results.push({
    name: 'Remove Fixture',
    passed: afterRemove.length === 2,
    message: `Removed fixture. Total fixtures: ${afterRemove.length}`,
  });

  // Test 14: Active room management
  FloorCanvasAPI.setActiveRoom('room-bar');
  const activeRoom = FloorCanvasAPI.getActiveRoom();
  results.push({
    name: 'Active Room Management',
    passed: activeRoom === 'room-bar',
    message: `Active room: ${activeRoom}`,
  });

  return results;
}

// =============================================================================
// API HANDLER
// =============================================================================

export async function GET() {
  try {
    const tests = runTests();
    const passed = tests.filter((t) => t.passed).length;
    const failed = tests.filter((t) => !t.passed).length;

    return NextResponse.json({
      success: failed === 0,
      summary: {
        total: tests.length,
        passed,
        failed,
      },
      tests,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// POST endpoint to run specific tests or test with custom data
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, data } = body;

    FloorCanvasAPI.clearAll();
    FloorCanvasAPI.initializeFloorPlans(sampleFloorPlans, sampleFixtures);

    switch (action) {
      case 'checkCollision': {
        const { roomId, position, width, height } = data;
        const blocked = FloorCanvasAPI.isPositionBlocked(roomId, position, width, height);
        return NextResponse.json({ blocked });
      }

      case 'getFixtures': {
        const { roomId } = data;
        const fixtures = FloorCanvasAPI.getFixtures(roomId);
        return NextResponse.json({ fixtures });
      }

      case 'snapToGrid': {
        const { position, gridSize } = data;
        const snapped = FloorCanvasAPI.snapToGrid(position, gridSize);
        return NextResponse.json({ snapped });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

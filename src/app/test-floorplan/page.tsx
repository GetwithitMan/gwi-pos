'use client';

/**
 * GWI POS - Floor Plan Test Page (Frontend / FOH View)
 *
 * Visual test page for the Floor Plan domain components.
 * Access at: http://localhost:3000/test-floorplan
 *
 * This page receives real-time updates from the Editor via socket events.
 * Changes made in /test-floorplan/editor will appear here automatically.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FloorCanvas, RoomSelector, FloorCanvasAPI } from '@/domains/floor-plan/canvas';
import { Table as TableComponent, SmartObject, TableAPI } from '@/domains/floor-plan/tables';
import { Seat, SeatAPI } from '@/domains/floor-plan/seats';
import type { Point, Table, Seat as SeatType, Fixture } from '@/domains/floor-plan/shared/types';
import { sampleFloorPlans, sampleFixtures, sampleTables } from './sampleData';
import { PIXELS_PER_FOOT, CANVAS_WIDTH, CANVAS_HEIGHT, GRID_SIZE } from '@/lib/floorplan/constants';
import { useTableGroups } from '@/domains/floor-plan/hooks/useTableGroups';
import { MERGE_CONSTANTS } from '@/domains/floor-plan/groups/types';
import {
  DragState,
  DropTarget,
  findDropTarget,
  createDragState,
  updateDragState,
  getDraggedTablePosition,
  resetDragState,
  calculatePerimeterSeats,
  getGroupDisplayName,
  createPerimeterLookup,
  createEnhancedPerimeterLookup,
  generateVirtualSeatPositions,
  assignColorsToGroup,
  createColorLookup,
  getColorFamilyForGroup,
  getGroupGlowStyle,
  getColorWithOpacity,
  findBestSnap,
  type TableForPerimeter,
  type PerimeterSeatResult,
  type TableColorAssignment,
  type SnapPreview,
  type VirtualSeatPosition,
} from '@/domains/floor-plan/groups';

// =============================================================================
// DATABASE FIXTURE CONVERSION
// =============================================================================
// IMPORTANT: Database stores positions in PIXELS for direct rendering
// These fixtures are rendered DIRECTLY using pixel values (no feet conversion)

interface DbFloorPlanElement {
  id: string;
  name: string;
  elementType: string;
  visualType: string;
  geometry: unknown;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  thickness: number;
  fillColor: string | null;
  opacity: number;
  isLocked: boolean;
  sectionId: string | null;
}

interface DbSeat {
  id: string;
  label: string;
  seatNumber: number;
  relativeX: number;
  relativeY: number;
  angle: number;
  seatType: string;
}

interface DbTable {
  id: string;
  name: string;
  abbreviation: string | null;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: string;
  status: string;
  section: { id: string; name: string; color: string | null } | null;
  seats: DbSeat[];
  virtualGroupId?: string | null;
  virtualGroupColor?: string | null;
  virtualGroupPrimary?: boolean;
}

// Convert database element to a "pixel fixture" for DIRECT rendering (no feet conversion)
// The returned fixture has geometry in PIXELS, not feet
interface PixelFixture {
  id: string;
  floorPlanId: string;
  roomId: string;
  type: string;
  category: string;
  label: string;
  geometry: {
    type: 'rectangle';
    position: { x: number; y: number };
    width: number;
    height: number;
    rotation: number;
  } | {
    type: 'circle';
    center: { x: number; y: number };
    radius: number;
  } | {
    type: 'line';
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  color: string;
  opacity: number;
  thickness: number;
  isActive: boolean;
}

function dbElementToPixelFixture(el: DbFloorPlanElement, roomId: string): PixelFixture {
  const geometry = el.geometry as { type: string; [key: string]: unknown } | null;

  let fixtureGeometry: PixelFixture['geometry'];
  if (geometry?.type === 'line') {
    fixtureGeometry = {
      type: 'line',
      start: (geometry.start as { x: number; y: number }) || { x: el.posX, y: el.posY },
      end: (geometry.end as { x: number; y: number }) || { x: el.posX + el.width, y: el.posY },
    };
  } else if (geometry?.type === 'circle') {
    // For circles, reconstruct from posX/posY/width/height (bounding box)
    const centerX = el.posX + el.width / 2;
    const centerY = el.posY + el.height / 2;
    const radius = el.width / 2;
    fixtureGeometry = {
      type: 'circle',
      center: { x: centerX, y: centerY },
      radius: radius,
    };
  } else {
    fixtureGeometry = {
      type: 'rectangle',
      position: { x: el.posX, y: el.posY },
      width: el.width,
      height: el.height,
      rotation: el.rotation,
    };
  }

  return {
    id: el.id,
    floorPlanId: roomId,
    roomId: roomId,
    type: el.visualType || 'custom_fixture',
    category: 'barrier',
    label: el.name,
    geometry: fixtureGeometry,
    color: el.fillColor || '#666666',
    opacity: el.opacity,
    thickness: el.thickness,
    isActive: true,
  };
}

// =============================================================================
// DATABASE FIXTURE RENDERER (PIXELS - NO CONVERSION)
// =============================================================================
// Renders fixtures using PIXEL coordinates directly from the database
// NO feetToPixels conversion because DB already stores pixels

interface DbFixtureRendererProps {
  fixture: PixelFixture;
  onClick?: () => void;
}

function DbFixtureRenderer({ fixture, onClick }: DbFixtureRendererProps) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: fixture.color,
    opacity: fixture.opacity,
    cursor: onClick ? 'pointer' : 'default',
    border: '1px solid rgba(0,0,0,0.2)',
  };

  // Render based on geometry type - using PIXEL values directly
  if (fixture.geometry.type === 'rectangle') {
    const { position, width, height, rotation } = fixture.geometry;
    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: position.x,  // Already in pixels
          top: position.y,   // Already in pixels
          width: width,      // Already in pixels
          height: height,    // Already in pixels
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
        }}
        title={fixture.label}
      />
    );
  }

  if (fixture.geometry.type === 'circle') {
    const { center, radius } = fixture.geometry;
    const diameter = radius * 2;
    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: center.x - radius,  // Already in pixels
          top: center.y - radius,   // Already in pixels
          width: diameter,          // Already in pixels
          height: diameter,         // Already in pixels
          borderRadius: '50%',
        }}
        title={fixture.label}
      />
    );
  }

  if (fixture.geometry.type === 'line') {
    const { start, end } = fixture.geometry;
    const thickness = fixture.thickness || 10; // Default thickness in pixels
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return (
      <div
        onClick={onClick}
        style={{
          ...baseStyle,
          left: start.x,              // Already in pixels
          top: start.y - thickness / 2, // Already in pixels
          width: length,              // Already in pixels
          height: thickness,          // Already in pixels
          transform: `rotate(${angle}deg)`,
          transformOrigin: 'left center',
        }}
        title={fixture.label}
      />
    );
  }

  return null;
}

// =============================================================================
// DATABASE TABLE RENDERER
// =============================================================================

interface DbTableRendererProps {
  table: DbTable;
  showSeats?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: () => void;
  isSelectedForCombine?: boolean;
  isHolding?: boolean;
  tableColor?: string;
  seatColor?: string;
  groupGlow?: string;
  perimeterLookup?: Map<string, number>;
  enhancedLookup?: Map<string, { perimeterNumber: number; isVisible: boolean }>;  // Includes visibility
  visualOffset?: { offsetX: number; offsetY: number };  // Visual snap offset for grouped tables
  isInGroup?: boolean;  // If true, skip rendering seats (virtual seats rendered separately)
}

function DbTableRenderer({
  table,
  showSeats,
  onClick,
  onPointerDown,
  onPointerUp,
  isSelectedForCombine,
  isHolding,
  tableColor,
  seatColor,
  groupGlow,
  perimeterLookup,
  enhancedLookup,
  visualOffset,
  isInGroup,
}: DbTableRendererProps) {
  const isRound = table.shape === 'round' || table.shape === 'circle';

  // Apply visual offset if provided (for grouped tables to appear snapped together)
  const visualPosX = table.posX + (visualOffset?.offsetX || 0);
  const visualPosY = table.posY + (visualOffset?.offsetY || 0);

  const tableCenterX = visualPosX + table.width / 2;
  const tableCenterY = visualPosY + table.height / 2;

  // Render seats with rotation and perimeter numbers
  const renderSeats = () => {
    // If table is in a group, don't render individual seats
    // Virtual seats are rendered separately around the combined shape
    if (isInGroup) return null;

    if (!showSeats || !table.seats || table.seats.length === 0) return null;

    return table.seats.map((seat) => {
      // Check if this seat should be hidden (inner seat between combined tables)
      const enhancedInfo = enhancedLookup?.get(seat.id);
      if (enhancedInfo && !enhancedInfo.isVisible) {
        // This is an inner seat - don't render it
        return null;
      }

      // Apply table rotation to seat position
      const angleRad = (table.rotation * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);

      const rotatedX = seat.relativeX * cos - seat.relativeY * sin;
      const rotatedY = seat.relativeX * sin + seat.relativeY * cos;

      const seatAbsX = tableCenterX + rotatedX;
      const seatAbsY = tableCenterY + rotatedY;

      // Smaller seats (24px) to prevent overlap and allow tapping
      const SEAT_SIZE = 24;
      const SEAT_HALF = SEAT_SIZE / 2;

      // Get perimeter number if in group (use enhanced lookup first, fallback to basic)
      const perimeterNum = enhancedInfo?.perimeterNumber ?? perimeterLookup?.get(seat.id);
      const seatLabel = perimeterNum !== undefined ? String(perimeterNum) : String(seat.seatNumber);

      return (
        <div
          key={seat.id}
          onClick={(e) => {
            e.stopPropagation();
            // When we integrate with orders, this will select the seat
            console.log(`Seat ${seatLabel} tapped on table ${table.name}`);
          }}
          style={{
            position: 'absolute',
            left: seatAbsX - SEAT_HALF,
            top: seatAbsY - SEAT_HALF,
            width: SEAT_SIZE,
            height: SEAT_SIZE,
            backgroundColor: seatColor || '#fff',
            border: '2px solid #555',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: '#333',
            cursor: 'pointer',
            pointerEvents: 'auto',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.15)';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
            e.currentTarget.style.zIndex = '100';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
            e.currentTarget.style.zIndex = 'auto';
          }}
          title={`Seat ${seatLabel}`}
        >
          {seatLabel}
        </div>
      );
    });
  };

  return (
    <>
      <div
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute',
          left: visualPosX,  // Use visual position (with snap offset applied)
          top: visualPosY,   // Use visual position (with snap offset applied)
          width: table.width,
          height: table.height,
          backgroundColor: tableColor || (table.status === 'occupied' ? '#ffcdd2' : '#e8f5e9'),
          border: isSelectedForCombine
            ? '3px solid #06b6d4'
            : tableColor
            ? `3px solid ${tableColor}`
            : '2px solid #666',
          borderRadius: isRound ? '50%' : 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          color: tableColor ? '#fff' : '#333',
          transform: isHolding
            ? `rotate(${table.rotation}deg) scale(1.02)`
            : `rotate(${table.rotation}deg)`,
          transformOrigin: 'center center',
          boxShadow: isSelectedForCombine
            ? '0 0 20px rgba(6, 182, 212, 0.6), inset 0 0 10px rgba(6, 182, 212, 0.2)'
            : isHolding
            ? '0 0 15px rgba(251, 191, 36, 0.5)'
            : groupGlow
            ? groupGlow
            : undefined,
          transition: visualOffset ? 'all 0.3s ease-out' : 'all 0.2s ease',  // Smooth snap animation
          // Prevent text selection and touch scrolling during long-hold
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
        }}
        title={`${table.name} (${table.capacity} seats)`}
      >
        {table.abbreviation || table.name}
      </div>
      {renderSeats()}
    </>
  );
}

// =============================================================================
// TABLE RENDERER - Using Layer 2 Components
// =============================================================================

// =============================================================================
// TEST PAGE COMPONENT
// =============================================================================

// Database section type
interface DbSection {
  id: string;
  name: string;
  widthFeet: number;
  heightFeet: number;
}

export default function TestFloorPlanPage() {
  const [selectedRoomId, setSelectedRoomId] = useState<string>('room-main');
  const [clickedPosition, setClickedPosition] = useState<Point | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<SeatType | null>(null);

  // Database fixtures from FloorPlanElement table
  const [dbFixtures, setDbFixtures] = useState<PixelFixture[]>([]);
  const [dbSections, setDbSections] = useState<DbSection[]>([]);
  const [dbTables, setDbTables] = useState<DbTable[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isDbMode, setIsDbMode] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showDbSeats, setShowDbSeats] = useState(true);

  // Virtual combining state
  const [isCombineMode, setIsCombineMode] = useState(false);
  const [selectedForCombine, setSelectedForCombine] = useState<string[]>([]);
  const [holdingTableId, setHoldingTableId] = useState<string | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Drag-to-combine state
  const [dragState, setDragState] = useState<DragState>(resetDragState());
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const longHoldTimerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const LONG_HOLD_MS = 750;
  const SNAP_DISTANCE_PX = 60;

  // Helper to convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    if (!canvasContainerRef.current) {
      return { x: screenX, y: screenY };
    }
    const rect = canvasContainerRef.current.getBoundingClientRect();
    return {
      x: screenX - rect.left,
      y: screenY - rect.top,
    };
  }, []);

  // Virtual group visual state
  const [virtualGroupData, setVirtualGroupData] = useState<{
    groups: Map<string, {
      groupId: string;
      tableIds: string[];
      colorAssignments: TableColorAssignment[];
      colorLookup: Map<string, { tableColor: string; seatColor: string }>;
      perimeterSeats: PerimeterSeatResult[];
      perimeterLookup: Map<string, number>;
      enhancedLookup: Map<string, { perimeterNumber: number; isVisible: boolean }>;
      virtualSeats: VirtualSeatPosition[];  // New: regenerated seat positions around combined shape
      displayName: string;
      groupIndex: number;
    }>;
  }>({ groups: new Map() });

  // Visual offsets for tables in virtual groups (makes them appear snapped together)
  // Key: tableId, Value: { offsetX, offsetY } - how much to shift the table visually
  const [visualOffsets, setVisualOffsets] = useState<Map<string, { offsetX: number; offsetY: number }>>(new Map());

  // Store snap positions when groups are created (persists the exact drag-preview position)
  // Key: groupId, Value: { draggedTableId, snapPosition }
  const [storedSnapPositions, setStoredSnapPositions] = useState<Map<string, { draggedTableId: string; snapPosition: { x: number; y: number } }>>(new Map());

  // Snap preview during drag
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null);

  // Use table groups hook
  const { createVirtualGroup, dissolveGroup, addToGroup, isLoading: isCreatingGroup } = useTableGroups({
    locationId: locationId || 'loc-1',
    autoLoad: false,
  });

  // Fetch database fixtures
  const fetchDbFixtures = useCallback(async (locId: string) => {
    try {
      const res = await fetch(`/api/floor-plan-elements?locationId=${locId}`);
      if (res.ok) {
        const data = await res.json();
        const fixtures = (data.elements || []).map((el: DbFloorPlanElement) =>
          dbElementToPixelFixture(el, el.sectionId || 'db-room')
        );
        setDbFixtures(fixtures);
        setIsDbMode(fixtures.length > 0);
        setLastUpdate(new Date());
        console.log(`[FOH] Loaded ${fixtures.length} fixtures from database`);
      }
    } catch (error) {
      console.error('[FOH] Failed to fetch database fixtures:', error);
    }
  }, []);

  // Fetch database sections
  const fetchDbSections = useCallback(async (locId: string) => {
    try {
      const res = await fetch(`/api/sections?locationId=${locId}`);
      if (res.ok) {
        const data = await res.json();
        const sections = data.sections || [];
        setDbSections(sections);
        console.log(`[FOH] Loaded ${sections.length} sections from database`);
        // Auto-select first section if available
        if (sections.length > 0) {
          setSelectedRoomId(sections[0].id);
        }
        return sections;
      }
    } catch (error) {
      console.error('[FOH] Failed to fetch sections:', error);
    }
    return [];
  }, []);

  // Fetch database tables
  const fetchDbTables = useCallback(async (locId: string, sectionId?: string) => {
    try {
      let url = `/api/tables?locationId=${locId}&includeSeats=true`;
      if (sectionId) {
        url += `&sectionId=${sectionId}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDbTables(data.tables || []);
        console.log(`[FOH] Loaded ${(data.tables || []).length} tables from database`);
      }
    } catch (error) {
      console.error('[FOH] Failed to fetch database tables:', error);
    }
  }, []);

  // Reset all virtual groups (for testing)
  const handleResetAllGroups = useCallback(async () => {
    if (!locationId) return;

    // Find all unique virtual group IDs
    const groupIds = new Set<string>();
    dbTables.forEach(table => {
      if (table.virtualGroupId) {
        groupIds.add(table.virtualGroupId);
      }
    });

    if (groupIds.size === 0) {
      alert('No virtual groups to reset');
      return;
    }

    const confirmed = window.confirm(`Reset ${groupIds.size} virtual group(s)? Tables will return to their original positions.`);
    if (!confirmed) return;

    // Dissolve each group
    for (const groupId of groupIds) {
      await dissolveGroup(groupId);
    }

    // Clear stored snap positions
    setStoredSnapPositions(new Map());

    // Refresh table data
    await fetchDbTables(locationId);
    console.log(`[FOH] Reset ${groupIds.size} virtual groups`);
  }, [locationId, dbTables, dissolveGroup, fetchDbTables]);

  // Get location ID and initialize
  useEffect(() => {
    async function init() {
      // Get location ID
      try {
        const res = await fetch('/api/locations');
        if (res.ok) {
          const data = await res.json();
          if (data.locations && data.locations.length > 0) {
            const locId = data.locations[0].id;
            setLocationId(locId);
            // Fetch database sections and fixtures
            const sections = await fetchDbSections(locId);
            await fetchDbFixtures(locId);
            await fetchDbTables(locId);
            // If we have sections, we're in DB mode
            if (sections.length > 0) {
              setIsDbMode(true);
            }
          }
        }
      } catch {
        console.log('[FOH] No locations API available');
      }

      // Initialize in-memory data as fallback
      if (FloorCanvasAPI.getAllRooms().length === 0) {
        FloorCanvasAPI.initializeFloorPlans(sampleFloorPlans, sampleFixtures);
      }

      // Only initialize tables if not already done
      if (TableAPI.getAllTables().length === 0) {
        TableAPI.initializeTables(sampleTables);

        // Generate seats for seatable tables
        sampleTables.forEach((table) => {
          if (table.category === 'seatable') {
            SeatAPI.generateSeatsForTable(
              table.id,
              table.defaultCapacity,
              table.shape
            );
          }
        });
      }

      // Only set to room-main if not already set to a DB section
      if (!isDbMode) {
        setSelectedRoomId('room-main');
      }
    }
    init();
  }, [fetchDbFixtures, fetchDbSections, fetchDbTables, isDbMode]);

  // Listen for floor-plan:updated socket events
  useEffect(() => {
    if (!locationId) return;

    // Set up EventSource for Server-Sent Events (simple polling fallback)
    // For a full implementation, use socket.io-client
    let intervalId: NodeJS.Timeout | null = null;

    // Poll for updates every 5 seconds (simple approach without socket.io)
    // Don't pass sectionId - fetch ALL tables and filter client-side
    // This prevents the "0 tables" bug when polling with wrong section filter
    intervalId = setInterval(() => {
      fetchDbFixtures(locationId);
      fetchDbTables(locationId); // No sectionId filter - client filters by section
    }, 5000);

    console.log('[FOH] Started polling for floor plan updates');

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        console.log('[FOH] Stopped polling');
      }
    };
  }, [locationId, fetchDbFixtures, fetchDbTables]);

  // Compute virtual group data and visual offsets whenever dbTables changes
  useEffect(() => {
    if (!dbTables || dbTables.length === 0) {
      setVirtualGroupData({ groups: new Map() });
      setVisualOffsets(new Map());
      return;
    }

    // Find all unique virtual group IDs
    const groupIds = new Set<string>();
    dbTables.forEach(table => {
      if (table.virtualGroupId) {
        groupIds.add(table.virtualGroupId);
        console.log('[Groups] Table', table.name, 'is in group', table.virtualGroupId);
      }
    });

    console.log('[Groups] Found', groupIds.size, 'virtual groups');

    // Build group data for each virtual group
    const groups = new Map<string, {
      groupId: string;
      tableIds: string[];
      colorAssignments: TableColorAssignment[];
      colorLookup: Map<string, { tableColor: string; seatColor: string }>;
      perimeterSeats: PerimeterSeatResult[];
      perimeterLookup: Map<string, number>;
      enhancedLookup: Map<string, { perimeterNumber: number; isVisible: boolean }>;
      virtualSeats: VirtualSeatPosition[];
      displayName: string;
      groupIndex: number;
    }>();

    // Calculate visual offsets for tables in groups (to make them appear snapped together)
    const newVisualOffsets = new Map<string, { offsetX: number; offsetY: number }>();

    let groupIndex = 0;

    groupIds.forEach(groupId => {
      // Get tables in this group
      const groupTables = dbTables.filter(t => t.virtualGroupId === groupId);
      if (groupTables.length === 0) return;

      const tableIds = groupTables.map(t => t.id);

      // Calculate color assignments
      const colorAssignments = assignColorsToGroup(tableIds, groupIndex);
      const colorLookup = createColorLookup(colorAssignments);

      // Find the primary table (anchor - doesn't move visually)
      const primaryTable = groupTables.find(t => t.virtualGroupPrimary) || groupTables[0];

      // Check if we have a stored snap position for this group
      const storedSnap = storedSnapPositions.get(groupId);

      // Calculate visual snap positions for secondary tables
      // Each secondary table should snap to the nearest edge of the primary table
      groupTables.forEach(table => {
        if (table.id === primaryTable.id) {
          // Primary table doesn't move - no offset
          newVisualOffsets.set(table.id, { offsetX: 0, offsetY: 0 });
        } else {
          // Check for per-table stored snap position (for tables added to existing groups)
          const perTableSnap = storedSnapPositions.get(`${groupId}-${table.id}`);

          // Use stored snap position if available (from when the drag happened)
          // This ensures the table lands EXACTLY where the preview showed
          if (perTableSnap && perTableSnap.draggedTableId === table.id) {
            const offsetX = perTableSnap.snapPosition.x - table.posX;
            const offsetY = perTableSnap.snapPosition.y - table.posY;
            newVisualOffsets.set(table.id, { offsetX, offsetY });
            console.log(`[VisualSnap] Table ${table.name} using PER-TABLE snap: offset (${offsetX}, ${offsetY})`);
          } else if (storedSnap && storedSnap.draggedTableId === table.id) {
            // Original group snap position
            const offsetX = storedSnap.snapPosition.x - table.posX;
            const offsetY = storedSnap.snapPosition.y - table.posY;
            newVisualOffsets.set(table.id, { offsetX, offsetY });
            console.log(`[VisualSnap] Table ${table.name} using GROUP snap: offset (${offsetX}, ${offsetY})`);
          } else {
            // Fallback: Calculate where this table should visually appear (snapped to combined group)
            // For 3+ tables, we need to snap to the nearest already-positioned table
            const snapPos = calculateSnapPositionForTableInGroup(table, primaryTable, groupTables, newVisualOffsets);
            const offsetX = snapPos.x - table.posX;
            const offsetY = snapPos.y - table.posY;
            newVisualOffsets.set(table.id, { offsetX, offsetY });
            console.log(`[VisualSnap] Table ${table.name} CALCULATED offset: (${offsetX}, ${offsetY})`);
          }
        }
      });

      // Calculate perimeter seats using VISUAL positions (snapped positions)
      const tablesForPerimeter: TableForPerimeter[] = groupTables.map(t => {
        const offset = newVisualOffsets.get(t.id) || { offsetX: 0, offsetY: 0 };
        return {
          id: t.id,
          name: t.name,
          posX: t.posX + offset.offsetX,  // Use visual position
          posY: t.posY + offset.offsetY,  // Use visual position
          width: t.width,
          height: t.height,
          seats: t.seats || [],
        };
      });
      const perimeterSeats = calculatePerimeterSeats(tablesForPerimeter);
      const perimeterLookup = createPerimeterLookup(perimeterSeats);
      const enhancedLookup = createEnhancedPerimeterLookup(tablesForPerimeter);

      // Generate virtual seat positions around the combined bounding box
      // This places seats evenly around the perimeter instead of using original positions
      // seatDistance = 18px (half seat size of 24px + small margin, close to table edge)
      const virtualSeats = generateVirtualSeatPositions(tablesForPerimeter, 18);

      // Debug: Log virtual seat positions
      console.log('[VirtualSeats] Group', groupId, '- generated', virtualSeats.length, 'virtual seats');

      // Get display name
      const displayName = getGroupDisplayName(tablesForPerimeter);

      groups.set(groupId, {
        groupId,
        tableIds,
        colorAssignments,
        colorLookup,
        perimeterSeats,
        perimeterLookup,
        enhancedLookup,
        virtualSeats,
        displayName,
        groupIndex,
      });

      groupIndex++;
    });

    setVirtualGroupData({ groups });
    setVisualOffsets(newVisualOffsets);
  }, [dbTables, storedSnapPositions]);

  // Helper function to calculate where a secondary table should snap to the primary table
  function calculateSnapPositionForTable(
    secondary: DbTable,
    primary: DbTable
  ): { x: number; y: number } {
    // Calculate centers
    const primaryCenterX = primary.posX + primary.width / 2;
    const primaryCenterY = primary.posY + primary.height / 2;
    const secondaryCenterX = secondary.posX + secondary.width / 2;
    const secondaryCenterY = secondary.posY + secondary.height / 2;

    // Determine which edge to snap to based on relative position
    const dx = secondaryCenterX - primaryCenterX;
    const dy = secondaryCenterY - primaryCenterY;

    // Determine primary direction (horizontal or vertical)
    const isHorizontal = Math.abs(dx) > Math.abs(dy);

    let snapX: number;
    let snapY: number;

    if (isHorizontal) {
      if (dx > 0) {
        // Secondary is to the RIGHT of primary - snap to primary's right edge
        snapX = primary.posX + primary.width;  // Left edge of secondary touches right edge of primary
      } else {
        // Secondary is to the LEFT of primary - snap to primary's left edge
        snapX = primary.posX - secondary.width;  // Right edge of secondary touches left edge of primary
      }
      // Align centers vertically (with small offset to preserve original offset)
      const verticalOffset = Math.min(Math.abs(dy), Math.min(primary.height, secondary.height) * 0.3);
      snapY = primary.posY + (primary.height - secondary.height) / 2 + (dy > 0 ? verticalOffset : -verticalOffset) * 0.5;
    } else {
      if (dy > 0) {
        // Secondary is BELOW primary - snap to primary's bottom edge
        snapY = primary.posY + primary.height;  // Top edge of secondary touches bottom edge of primary
      } else {
        // Secondary is ABOVE primary - snap to primary's top edge
        snapY = primary.posY - secondary.height;  // Bottom edge of secondary touches top edge of primary
      }
      // Align centers horizontally (with small offset to preserve original offset)
      const horizontalOffset = Math.min(Math.abs(dx), Math.min(primary.width, secondary.width) * 0.3);
      snapX = primary.posX + (primary.width - secondary.width) / 2 + (dx > 0 ? horizontalOffset : -horizontalOffset) * 0.5;
    }

    return { x: snapX, y: snapY };
  }

  // Helper function to calculate snap position for a table joining an existing group with multiple tables
  // Finds the nearest already-positioned table and snaps to it
  function calculateSnapPositionForTableInGroup(
    newTable: DbTable,
    primaryTable: DbTable,
    allGroupTables: DbTable[],
    currentOffsets: Map<string, { offsetX: number; offsetY: number }>
  ): { x: number; y: number } {
    // Get all tables that already have positions calculated (including primary)
    const positionedTables = allGroupTables.filter(t =>
      t.id === primaryTable.id || currentOffsets.has(t.id)
    );

    if (positionedTables.length === 0) {
      // Fallback to primary
      return calculateSnapPositionForTable(newTable, primaryTable);
    }

    // Find the nearest positioned table to snap to
    let nearestTable = primaryTable;
    let nearestDistance = Infinity;

    for (const table of positionedTables) {
      const offset = currentOffsets.get(table.id) || { offsetX: 0, offsetY: 0 };
      const visualX = table.posX + offset.offsetX;
      const visualY = table.posY + offset.offsetY;

      // Calculate distance from new table's original position to this positioned table
      const dx = newTable.posX - visualX;
      const dy = newTable.posY - visualY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestTable = table;
      }
    }

    // Create a virtual table with the visual position for snapping
    const nearestOffset = currentOffsets.get(nearestTable.id) || { offsetX: 0, offsetY: 0 };
    const virtualNearestTable: DbTable = {
      ...nearestTable,
      posX: nearestTable.posX + nearestOffset.offsetX,
      posY: nearestTable.posY + nearestOffset.offsetY,
    };

    return calculateSnapPositionForTable(newTable, virtualNearestTable);
  }

  // Get tables for current room using TableAPI
  const tablesInRoom = TableAPI.getTablesForRoom(selectedRoomId);

  // Get all seats for tables in the current room
  const seatsInRoom: SeatType[] = [];
  tablesInRoom.forEach((table) => {
    const tableSeats = SeatAPI.getSeatsForTable(table.id);
    seatsInRoom.push(...tableSeats);
  });

  // Virtual combining handlers with drag-to-combine
  const handleTablePointerDown = useCallback((
    tableId: string,
    tableCenterX: number,
    tableCenterY: number,
    e: React.PointerEvent
  ) => {
    console.log('[PointerDown] Table pressed:', { tableId, isCombineMode });

    // Don't start drag if already in combine mode
    if (isCombineMode) return;

    // Convert screen coordinates to canvas coordinates
    const canvasCoords = screenToCanvas(e.clientX, e.clientY);

    console.log('[PointerDown] Starting long-hold timer');
    setHoldingTableId(tableId);

    // Start long-hold timer for drag mode
    longHoldTimerRef.current = setTimeout(() => {
      // After 750ms, activate drag mode
      // Use canvas coordinates for both table center and pointer
      console.log('[Drag] Starting drag:', { tableId, tableCenterX, tableCenterY, canvasCoords });
      setDragState(createDragState(tableId, tableCenterX, tableCenterY, canvasCoords.x, canvasCoords.y));
      setHoldingTableId(null);
    }, LONG_HOLD_MS);
  }, [isCombineMode, LONG_HOLD_MS, screenToCanvas]);

  // Handle pointer move for dragging
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.isDragging) return;

    // Convert screen coordinates to canvas coordinates
    const canvasCoords = screenToCanvas(e.clientX, e.clientY);
    const newState = updateDragState(dragState, canvasCoords.x, canvasCoords.y);
    setDragState(newState);

    // Find potential drop target (now using canvas coordinates)
    const dragPos = getDraggedTablePosition(newState);
    const target = findDropTarget(
      dragState.draggedTableId!,
      dragPos.x,
      dragPos.y,
      dbTables,
      SNAP_DISTANCE_PX
    );
    setDropTarget(target);

    // Calculate snap preview
    const draggedTable = dbTables.find(t => t.id === dragState.draggedTableId);
    if (draggedTable) {
      // Only consider tables in the SAME SECTION as visible targets
      // This matches the rendering filter logic
      const visibleTables = dbTables.filter(t => {
        if (t.section?.id === selectedRoomId) return true;
        if (!t.section && dbSections.length > 0 && dbSections[0].id === selectedRoomId) return true;
        return false;
      });

      // Allow snapping to ANY table (including those in groups) so users can add to existing groups
      // Only exclude the table being dragged
      const tableRects = visibleTables
        .filter(t => t.id !== dragState.draggedTableId)
        .map(t => ({
          id: t.id,
          x: t.posX,
          y: t.posY,
          width: t.width,
          height: t.height,
        }));

      const draggedRect = {
        id: draggedTable.id,
        x: dragPos.x - draggedTable.width / 2,
        y: dragPos.y - draggedTable.height / 2,
        width: draggedTable.width,
        height: draggedTable.height,
      };

      // Debug logging
      console.log('[Snap] Checking:', {
        draggedName: draggedTable.name,
        visibleCount: visibleTables.length,
        availableTargets: tableRects.length,
        selectedRoomId,
        draggedPos: { x: draggedRect.x, y: draggedRect.y }
      });

      const snap = findBestSnap(draggedRect, tableRects);
      setSnapPreview(snap);
    }
  }, [dragState, dbTables, dbSections, selectedRoomId, SNAP_DISTANCE_PX, screenToCanvas]);

  // Handle pointer up - only snap and combine if we have a valid snap position
  const handleTablePointerUp = useCallback(async () => {
    // Clear long-hold timer
    if (longHoldTimerRef.current) {
      clearTimeout(longHoldTimerRef.current);
      longHoldTimerRef.current = null;
    }
    setHoldingTableId(null);

    // Only proceed if we were dragging AND have a valid snap preview
    // If no valid snap, table returns to original position (no action taken)
    if (dragState.isDragging && snapPreview?.isValid && dragState.draggedTableId) {
      try {
        // IMPORTANT: FOH view does NOT move table positions!
        // Virtual groups are visual-only - tables stay in their original positions
        // Only the Editor can change table positions

        // Check if the target table is already in a virtual group
        const targetTable = dbTables.find(t => t.id === snapPreview.targetTableId);
        const draggedTable = dbTables.find(t => t.id === dragState.draggedTableId);

        if (targetTable?.virtualGroupId) {
          // Target is already in a group - ADD the dragged table to that existing group
          console.log('[Snap] Adding table to existing group:', {
            draggedTableId: dragState.draggedTableId,
            targetGroupId: targetTable.virtualGroupId,
          });

          const success = await addToGroup(
            targetTable.virtualGroupId,
            dragState.draggedTableId,
            'emp-1' // TODO: Get from auth context
          );

          if (success) {
            console.log('[Snap] Table added to existing group');

            // Store the snap position for this table in the existing group
            setStoredSnapPositions(prev => {
              const updated = new Map(prev);
              // We need to update the stored snap for this group to include the new table
              const existingSnap = updated.get(targetTable.virtualGroupId!);
              // For additional tables, store under the group ID with tableId as key
              updated.set(`${targetTable.virtualGroupId}-${dragState.draggedTableId}`, {
                draggedTableId: dragState.draggedTableId!,
                snapPosition: snapPreview.snapPosition,
              });
              return updated;
            });

            // Refresh floor plan data to show the updated group
            if (locationId) {
              await fetchDbTables(locationId);
            }
          }
        } else if (draggedTable?.virtualGroupId) {
          // Dragged table is already in a group - ADD the target to that group
          console.log('[Snap] Adding target table to dragged table\'s group:', {
            targetTableId: snapPreview.targetTableId,
            draggedGroupId: draggedTable.virtualGroupId,
          });

          const success = await addToGroup(
            draggedTable.virtualGroupId,
            snapPreview.targetTableId,
            'emp-1' // TODO: Get from auth context
          );

          if (success) {
            console.log('[Snap] Target table added to existing group');

            // Store the snap position
            setStoredSnapPositions(prev => {
              const updated = new Map(prev);
              updated.set(`${draggedTable.virtualGroupId}-${snapPreview.targetTableId}`, {
                draggedTableId: snapPreview.targetTableId,
                snapPosition: { x: targetTable?.posX || 0, y: targetTable?.posY || 0 },
              });
              return updated;
            });

            // Refresh floor plan data to show the updated group
            if (locationId) {
              await fetchDbTables(locationId);
            }
          }
        } else {
          // Neither table is in a group - CREATE a new virtual group
          console.log('[Snap] Creating new virtual group:', {
            draggedTableId: dragState.draggedTableId,
            targetTableId: snapPreview.targetTableId,
          });

          // Create the virtual group with TARGET table as PRIMARY (first in array)
          // This means the dragged table will snap TO the target table's position
          const result = await createVirtualGroup(
            [snapPreview.targetTableId, dragState.draggedTableId],  // Target first = primary
            'emp-1' // TODO: Get from auth context
          );

          if (result) {
            console.log('[Snap] Virtual group created:', result.id);

            // Store the snap position so we can use it for visual positioning
            // This ensures the dragged table lands EXACTLY where the preview showed
            setStoredSnapPositions(prev => {
              const updated = new Map(prev);
              updated.set(result.id, {
                draggedTableId: dragState.draggedTableId!,
                snapPosition: snapPreview.snapPosition,
              });
              return updated;
            });

            // Refresh floor plan data to show the group
            if (locationId) {
              await fetchDbTables(locationId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to combine tables:', error);
      }
    } else if (dragState.isDragging) {
      // No valid snap - table returns to original position (just reset state, no API calls)
      console.log('[Snap] No valid snap, canceling drag');
    }

    // Reset drag state - table visual returns to original position
    setDragState(resetDragState());
    setDropTarget(null);
    setSnapPreview(null);
  }, [dragState, snapPreview, dbTables, createVirtualGroup, addToGroup, locationId, fetchDbTables]);

  // Cancel drag if pointer leaves the canvas
  const handlePointerLeave = useCallback(() => {
    if (longHoldTimerRef.current) {
      clearTimeout(longHoldTimerRef.current);
      longHoldTimerRef.current = null;
    }
    setHoldingTableId(null);
    setDragState(resetDragState());
    setDropTarget(null);
    setSnapPreview(null);
  }, []);

  const handleTableTap = useCallback((tableId: string) => {
    if (isCombineMode) {
      // Toggle selection
      setSelectedForCombine(prev =>
        prev.includes(tableId)
          ? prev.filter(id => id !== tableId)
          : [...prev, tableId]
      );
    } else {
      // Normal tap - show info (for now just log)
      console.log(`Table ${tableId} tapped`);
    }
  }, [isCombineMode]);

  const handleConfirmCombine = useCallback(async () => {
    if (selectedForCombine.length < 2) return;

    const result = await createVirtualGroup(
      selectedForCombine,
      'employee-default', // TODO: Get from auth context
    );

    if (result) {
      // Refresh tables to show virtual group
      if (locationId && selectedRoomId) {
        await fetchDbTables(locationId, selectedRoomId);
      }
      setIsCombineMode(false);
      setSelectedForCombine([]);
    }
  }, [selectedForCombine, createVirtualGroup, locationId, selectedRoomId, fetchDbTables]);

  const handleCancelCombine = useCallback(() => {
    setIsCombineMode(false);
    setSelectedForCombine([]);
  }, []);

  const handlePositionClick = (position: Point) => {
    setClickedPosition(position);
    setSelectedTable(null);
    setSelectedSeat(null);
  };

  const handleTableClick = (table: Table) => {
    setSelectedTable(table);
    setClickedPosition(null);
    setSelectedSeat(null);
  };

  const handleSeatClick = (seatId: string) => {
    const seat = SeatAPI.getSeat(seatId);
    if (seat) {
      setSelectedSeat(seat);
      setSelectedTable(null);
      setClickedPosition(null);
    }
  };

  const handleFixtureClick = (fixture: PixelFixture | Fixture) => {
    alert(`Fixture clicked: ${fixture.label} (${fixture.type})`);
  };

  // Combine in-memory fixtures with database fixtures for display
  const allFixtures = isDbMode ? dbFixtures : FloorCanvasAPI.getFixtures(selectedRoomId);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>Floor Plan Test Page (FOH View)</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        {isDbMode ? (
          <>Real-time sync enabled. Fixtures from database: <strong>{dbFixtures.length}</strong>
            {lastUpdate && <span style={{ marginLeft: 8, fontSize: 12 }}>(Updated: {lastUpdate.toLocaleTimeString()})</span>}
          </>
        ) : (
          'Using sample data. Create fixtures in Editor to enable database sync.'
        )}
      </p>

      {/* Room/Section Selector */}
      {isDbMode && dbSections.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {dbSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setSelectedRoomId(section.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: selectedRoomId === section.id ? '2px solid #3498db' : '1px solid #ccc',
                backgroundColor: selectedRoomId === section.id ? '#e3f2fd' : 'white',
                cursor: 'pointer',
                fontWeight: selectedRoomId === section.id ? 600 : 400,
                fontSize: 14,
              }}
            >
              {section.name}
            </button>
          ))}

          {/* Show/Hide Seats Toggle */}
          <button
            onClick={() => setShowDbSeats(!showDbSeats)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ccc',
              backgroundColor: showDbSeats ? '#e3f2fd' : 'white',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: showDbSeats ? 600 : 400,
              marginLeft: 'auto',
            }}
          >
            {showDbSeats ? 'Hide Seats' : 'Show Seats'}
          </button>

          {/* Reset All Groups Button (for testing) */}
          <button
            onClick={handleResetAllGroups}
            disabled={virtualGroupData.groups.size === 0}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ef4444',
              backgroundColor: virtualGroupData.groups.size > 0 ? '#fef2f2' : '#f5f5f5',
              color: virtualGroupData.groups.size > 0 ? '#dc2626' : '#9ca3af',
              cursor: virtualGroupData.groups.size > 0 ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Reset Groups ({virtualGroupData.groups.size})
          </button>
        </div>
      ) : (
        <RoomSelector
          selectedRoomId={selectedRoomId}
          onRoomSelect={setSelectedRoomId}
        />
      )}

      {/* Main Canvas */}
      <div style={{ display: 'flex', gap: 24 }}>
        <div
          ref={canvasContainerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handleTablePointerUp}
          onPointerLeave={handlePointerLeave}
          style={{
            position: 'relative',
            // Prevent text selection during drag
            userSelect: dragState.isDragging ? 'none' : 'auto',
            WebkitUserSelect: dragState.isDragging ? 'none' : 'auto',
          }}
        >
          <FloorCanvas
            roomId={selectedRoomId}
            showGrid={!isDbMode} // Disable grid in DB mode (we render our own canvas)
            showFixtures={!isDbMode}
            // Use FIXED canvas dimensions to match Editor (stable coordinates)
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onPositionClick={handlePositionClick}
            onFixtureClick={handleFixtureClick}
          >
            {/* Render database fixtures when in DB mode - filter by selected section */}
            {isDbMode && dbFixtures
              .filter((fixture) => {
                // In DB mode, filter by sectionId (stored as roomId in PixelFixture)
                return fixture.roomId === selectedRoomId;
              })
              .map((fixture) => (
                <DbFixtureRenderer
                  key={fixture.id}
                  fixture={fixture}
                  onClick={() => handleFixtureClick(fixture)}
                />
              ))}

            {/* Render database tables when in DB mode - filter by selected section */}
            {/* Tables without a section will show in first section as fallback */}
            {isDbMode && dbTables
              .filter((table) => {
                // Show tables that match the selected section
                if (table.section?.id === selectedRoomId) return true;
                // Also show tables with no section in the first section
                if (!table.section && dbSections.length > 0 && dbSections[0].id === selectedRoomId) return true;
                return false;
              })
              .map((table) => {
                const isSelectedForCombine = selectedForCombine.includes(table.id);
                const isHolding = holdingTableId === table.id;
                const isDragged = dragState.isDragging && dragState.draggedTableId === table.id;
                const isDropTarget = dropTarget?.tableId === table.id;

                // Calculate table center
                const tableCenterX = table.posX + table.width / 2;
                const tableCenterY = table.posY + table.height / 2;

                // Get group colors, perimeter data, and visual offset if in a virtual group
                let tableColor: string | undefined;
                let seatColor: string | undefined;
                let groupGlow: string | undefined;
                let perimeterLookup: Map<string, number> | undefined;
                let enhancedLookup: Map<string, { perimeterNumber: number; isVisible: boolean }> | undefined;
                let visualOffset: { offsetX: number; offsetY: number } | undefined;

                if (table.virtualGroupId) {
                  const groupData = virtualGroupData.groups.get(table.virtualGroupId);
                  if (groupData) {
                    const colors = groupData.colorLookup.get(table.id);
                    tableColor = colors?.tableColor;
                    seatColor = colors?.seatColor;
                    perimeterLookup = groupData.perimeterLookup;
                    enhancedLookup = groupData.enhancedLookup;

                    // Get group glow
                    const family = getColorFamilyForGroup(groupData.groupIndex);
                    groupGlow = getGroupGlowStyle(family);
                  }

                  // Get visual offset for snapped position
                  visualOffset = visualOffsets.get(table.id);
                }

                return (
                  <React.Fragment key={table.id}>
                    <DbTableRenderer
                      table={table}
                      showSeats={showDbSeats}
                      onClick={() => handleTableTap(table.id)}
                      onPointerDown={(e) => handleTablePointerDown(table.id, tableCenterX, tableCenterY, e)}
                      onPointerUp={handleTablePointerUp}
                      isSelectedForCombine={isSelectedForCombine}
                      isHolding={isHolding}
                      tableColor={tableColor}
                      seatColor={seatColor}
                      groupGlow={groupGlow}
                      perimeterLookup={perimeterLookup}
                      enhancedLookup={enhancedLookup}
                      visualOffset={visualOffset}
                      isInGroup={!!table.virtualGroupId}
                    />

                    {/* Drop target highlight - use visual position if available */}
                    {isDropTarget && (
                      <div
                        style={{
                          position: 'absolute',
                          left: (table.posX + (visualOffset?.offsetX || 0)) - 4,
                          top: (table.posY + (visualOffset?.offsetY || 0)) - 4,
                          width: table.width + 8,
                          height: table.height + 8,
                          border: '3px solid #22c55e',
                          borderRadius: table.shape === 'circle' ? '50%' : 12,
                          backgroundColor: 'rgba(34, 197, 94, 0.2)',
                          pointerEvents: 'none',
                          animation: 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}

            {/* Dragged table ghost - now using canvas coordinates (position: absolute) */}
            {dragState.isDragging && dragState.draggedTableId && (() => {
              const draggedTable = dbTables.find(t => t.id === dragState.draggedTableId);
              if (!draggedTable) return null;

              const dragPos = getDraggedTablePosition(dragState);

              return (
                <div
                  style={{
                    position: 'absolute',
                    left: dragPos.x - draggedTable.width / 2,
                    top: dragPos.y - draggedTable.height / 2,
                    width: draggedTable.width,
                    height: draggedTable.height,
                    backgroundColor: 'rgba(6, 182, 212, 0.4)',
                    border: '3px dashed #06b6d4',
                    borderRadius: draggedTable.shape === 'circle' ? '50%' : 8,
                    pointerEvents: 'none',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#06b6d4',
                  }}
                >
                  {draggedTable.abbreviation || draggedTable.name}
                </div>
              );
            })()}

            {/* Snap preview ghost */}
            {snapPreview && snapPreview.isValid && dragState.isDragging && dragState.draggedTableId && (() => {
              const draggedTable = dbTables.find(t => t.id === dragState.draggedTableId);
              if (!draggedTable) return null;

              return (
                <div
                  style={{
                    position: 'absolute',
                    left: snapPreview.snapPosition.x,
                    top: snapPreview.snapPosition.y,
                    width: draggedTable.width,
                    height: draggedTable.height,
                    backgroundColor: 'rgba(34, 197, 94, 0.3)',
                    border: '2px dashed #22c55e',
                    borderRadius: draggedTable.shape === 'circle' ? '50%' : 8,
                    pointerEvents: 'none',
                    zIndex: 999,
                    transition: 'all 0.15s ease-out',
                  }}
                />
              );
            })()}

            {/* Virtual seats for combined groups - rendered around bounding box perimeter */}
            {isDbMode && showDbSeats && Array.from(virtualGroupData.groups.entries()).map(([groupId, groupData]) => {
              // Get tables in this group for this section
              const groupTables = dbTables.filter(
                t => t.virtualGroupId === groupId &&
                (t.section?.id === selectedRoomId || (!t.section && dbSections[0]?.id === selectedRoomId))
              );
              if (groupTables.length === 0) return null;

              const family = getColorFamilyForGroup(groupData.groupIndex);
              const SEAT_SIZE = 24;
              const SEAT_HALF = SEAT_SIZE / 2;

              return (
                <React.Fragment key={`group-seats-${groupId}`}>
                  {groupData.virtualSeats.map((seat) => (
                    <div
                      key={seat.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log(`Virtual seat ${seat.perimeterNumber} tapped (original: table ${seat.originalTableId}, seat ${seat.originalSeatNumber})`);
                      }}
                      style={{
                        position: 'absolute',
                        left: seat.absoluteX - SEAT_HALF,
                        top: seat.absoluteY - SEAT_HALF,
                        width: SEAT_SIZE,
                        height: SEAT_SIZE,
                        backgroundColor: family.seatShades[3], // Light shade from family
                        border: `2px solid ${family.base}`,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#333',
                        cursor: 'pointer',
                        pointerEvents: 'auto',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        transition: 'all 0.2s ease',
                        zIndex: 50,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.15)';
                        e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
                        e.currentTarget.style.zIndex = '100';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
                        e.currentTarget.style.zIndex = '50';
                      }}
                      title={`Seat ${seat.perimeterNumber}`}
                    >
                      {seat.perimeterNumber}
                    </div>
                  ))}
                </React.Fragment>
              );
            })}

            {/* Group display name badges - positioned using visual (snapped) positions */}
            {isDbMode && Array.from(virtualGroupData.groups.entries()).map(([groupId, groupData]) => {
              // Get tables in this group for this section
              const groupTables = dbTables.filter(
                t => t.virtualGroupId === groupId &&
                (t.section?.id === selectedRoomId || (!t.section && dbSections[0]?.id === selectedRoomId))
              );
              if (groupTables.length === 0) return null;

              // Calculate bounding box using VISUAL positions (with snap offsets)
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              groupTables.forEach(t => {
                const offset = visualOffsets.get(t.id) || { offsetX: 0, offsetY: 0 };
                const visualX = t.posX + offset.offsetX;
                const visualY = t.posY + offset.offsetY;
                minX = Math.min(minX, visualX);
                minY = Math.min(minY, visualY);
                maxX = Math.max(maxX, visualX + t.width);
                maxY = Math.max(maxY, visualY + t.height);
              });

              const centerX = (minX + maxX) / 2;
              const family = getColorFamilyForGroup(groupData.groupIndex);

              // Account for seat extension above the table (18px offset + 12px seat radius)
              const SEAT_EXTENSION = 30;

              return (
                <div
                  key={`group-badge-${groupId}`}
                  style={{
                    position: 'absolute',
                    left: centerX,
                    top: minY - SEAT_EXTENSION - 25, // Position above seats (seat extension + badge margin)
                    transform: 'translateX(-50%)',
                    backgroundColor: getColorWithOpacity(family.base, 0.9),
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    zIndex: 100,
                    pointerEvents: 'none',
                  }}
                >
                  {groupData.displayName}
                </div>
              );
            })}

            {/* Render tables using Layer 2 components (SVG) */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              <g style={{ pointerEvents: 'auto' }}>
                {tablesInRoom.map((table) =>
                  table.category === 'seatable' ? (
                    <TableComponent
                      key={table.id}
                      table={table}
                      pixelsPerFoot={PIXELS_PER_FOOT}
                      isSelected={selectedTable?.id === table.id}
                      onSelect={(id) => {
                        const t = TableAPI.getTable(id);
                        if (t) setSelectedTable(t);
                      }}
                    />
                  ) : (
                    <SmartObject
                      key={table.id}
                      object={table}
                      pixelsPerFoot={PIXELS_PER_FOOT}
                      isSelected={selectedTable?.id === table.id}
                      onSelect={(id) => {
                        const t = TableAPI.getTable(id);
                        if (t) setSelectedTable(t);
                      }}
                    />
                  )
                )}

                {/* Render seats around tables */}
                {seatsInRoom.map((seat) => {
                  const table = TableAPI.getTable(seat.tableId);
                  if (!table) return null;

                  return (
                    <Seat
                      key={seat.id}
                      seat={seat}
                      tableX={table.positionX}
                      tableY={table.positionY}
                      pixelsPerFoot={PIXELS_PER_FOOT}
                      isSelected={selectedSeat?.id === seat.id}
                      onSelect={handleSeatClick}
                    />
                  );
                })}
              </g>
            </svg>
          </FloorCanvas>
        </div>

        {/* Info Panel */}
        <div style={{ width: 300 }}>
          <div
            style={{
              padding: 16,
              backgroundColor: '#f5f5f5',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Click Info</h3>
            {clickedPosition ? (
              <div>
                <p><strong>Position:</strong> ({clickedPosition.x.toFixed(1)}ft, {clickedPosition.y.toFixed(1)}ft)</p>
                <p><strong>Blocked:</strong> {FloorCanvasAPI.isPositionBlocked(selectedRoomId, clickedPosition, 3, 3) ? 'Yes' : 'No'}</p>
              </div>
            ) : selectedSeat ? (
              <div>
                <p><strong>Seat:</strong> #{selectedSeat.seatNumber}</p>
                <p><strong>Table:</strong> {(() => {
                  const table = TableAPI.getTable(selectedSeat.tableId);
                  return table ? table.label : 'Unknown';
                })()}</p>
                <p><strong>Position Index:</strong> {selectedSeat.positionIndex}</p>
                <p><strong>Offset:</strong> ({selectedSeat.offsetX.toFixed(2)}ft, {selectedSeat.offsetY.toFixed(2)}ft)</p>
                <p><strong>Occupied:</strong> {selectedSeat.isOccupied ? 'Yes' : 'No'}</p>
                <p><strong>Virtual:</strong> {selectedSeat.isVirtual ? 'Yes' : 'No'}</p>
              </div>
            ) : selectedTable ? (
              <div>
                <p><strong>Table:</strong> {selectedTable.label}</p>
                <p><strong>Type:</strong> {selectedTable.objectType}</p>
                <p><strong>Shape:</strong> {selectedTable.shape}</p>
                <p><strong>Capacity:</strong> {selectedTable.minCapacity}-{selectedTable.maxCapacity}</p>
                <p><strong>Position:</strong> ({selectedTable.positionX}ft, {selectedTable.positionY}ft)</p>
                <p><strong>Seats:</strong> {SeatAPI.getSeatsForTable(selectedTable.id).length}</p>
              </div>
            ) : (
              <p style={{ color: '#999' }}>Click on canvas, table, or seat</p>
            )}
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: '#f5f5f5',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Room Info</h3>
            {(() => {
              const room = FloorCanvasAPI.getFloorPlan(selectedRoomId);
              if (!room) return <p>No room selected</p>;
              return (
                <div>
                  <p><strong>Name:</strong> {room.name}</p>
                  <p><strong>Type:</strong> {room.type}</p>
                  <p><strong>Size:</strong> {room.widthFeet}ft x {room.heightFeet}ft</p>
                  <p><strong>Grid:</strong> {room.gridSizeFeet}ft</p>
                  <p><strong>Tables:</strong> {tablesInRoom.length}</p>
                  <p><strong>Fixtures:</strong> {isDbMode ? dbFixtures.length : FloorCanvasAPI.getFixtures(selectedRoomId).length}</p>
                  {isDbMode && <p style={{ color: '#4caf50', fontSize: 12 }}>Database Mode Active</p>}
                </div>
              );
            })()}
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: isDbMode ? '#e8f5e9' : '#e3f2fd',
              borderRadius: 8,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Sync Status</h3>
            {isDbMode ? (
              <>
                <p style={{ color: '#2e7d32' }}>Database Connected</p>
                <p style={{ fontSize: 12 }}>Fixtures: {dbFixtures.length}</p>
                <p style={{ fontSize: 12 }}>Polling: every 5s</p>
                {lastUpdate && (
                  <p style={{ fontSize: 11, color: '#666' }}>
                    Last: {lastUpdate.toLocaleTimeString()}
                  </p>
                )}
              </>
            ) : (
              <>
                <p style={{ color: '#1976d2' }}>In-Memory Mode</p>
                <p style={{ fontSize: 12 }}>Using sample data</p>
                <p style={{ fontSize: 12 }}>Create fixtures in Editor to enable sync</p>
              </>
            )}
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: '#fff3e0',
              borderRadius: 8,
              marginTop: 16,
            }}
          >
            <h3 style={{ margin: '0 0 12px 0' }}>Test Pages</h3>
            <p><a href="/test-floorplan" style={{ color: '#e65100' }}>✓ Frontend Test (Current)</a></p>
            <p><a href="/test-floorplan/api" style={{ color: '#e65100' }}>Backend API Test</a></p>
            <p>
              <a
                href="/test-floorplan/editor"
                style={{
                  color: '#e65100',
                  fontWeight: 'bold',
                  textDecoration: 'none',
                  display: 'inline-block',
                  padding: '4px 8px',
                  backgroundColor: '#ffebee',
                  borderRadius: 4,
                }}
              >
                ✏️ Edit Floor Plan →
              </a>
            </p>
            <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
              {isDbMode
                ? 'Changes made in Editor will appear here automatically (5s polling)'
                : 'Create fixtures in Editor to enable real-time sync'}
            </p>
          </div>
        </div>
      </div>

      {/* Combine Bar - Fixed at bottom when in combine mode */}
      {isCombineMode && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          padding: '12px 24px',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.1)',
          zIndex: 1000,
        }}>
          {/* Status Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#06b6d4',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
            <span style={{ color: 'white', fontWeight: 500, fontSize: 14 }}>
              {selectedForCombine.length} table{selectedForCombine.length !== 1 ? 's' : ''} selected
            </span>
          </div>

          {/* Hint Text */}
          <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 13, fontStyle: 'italic' }}>
            Tap tables to add/remove
          </span>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 8 }}>
            <button
              onClick={handleCancelCombine}
              disabled={isCreatingGroup}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                color: 'white',
                cursor: isCreatingGroup ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: 14,
                opacity: isCreatingGroup ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isCreatingGroup) {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmCombine}
              disabled={selectedForCombine.length < 2 || isCreatingGroup}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: selectedForCombine.length >= 2
                  ? (isCreatingGroup ? 'rgba(6, 182, 212, 0.5)' : '#06b6d4')
                  : 'rgba(100, 116, 139, 0.5)',
                color: 'white',
                cursor: (selectedForCombine.length >= 2 && !isCreatingGroup) ? 'pointer' : 'not-allowed',
                fontWeight: 600,
                fontSize: 14,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (selectedForCombine.length >= 2 && !isCreatingGroup) {
                  e.currentTarget.style.backgroundColor = '#0891b2';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedForCombine.length >= 2 && !isCreatingGroup) {
                  e.currentTarget.style.backgroundColor = '#06b6d4';
                }
              }}
            >
              {isCreatingGroup ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </div>
      )}

      {/* Pulse Animation Styles */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.05);
          }
        }
      `}</style>

      {/* Tables List */}
      <div style={{ marginTop: 24 }}>
        <h3>Tables in {FloorCanvasAPI.getFloorPlan(selectedRoomId)?.name || 'Room'}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tablesInRoom.map((table) => (
            <div
              key={table.id}
              onClick={() => handleTableClick(table)}
              style={{
                padding: '8px 16px',
                backgroundColor: selectedTable?.id === table.id ? '#3498db' : '#f5f5f5',
                color: selectedTable?.id === table.id ? 'white' : 'black',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              {table.label} ({table.objectType})
            </div>
          ))}
          {tablesInRoom.length === 0 && (
            <p style={{ color: '#999' }}>No tables in this room</p>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * GWI POS - Floor Plan Domain
 * Editor Canvas Component
 *
 * Canvas with drawing and editing interactions for floor plan fixtures.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FloorCanvasAPI } from '../canvas';
import type { Fixture, Point, FixtureGeometry } from '../shared/types';
import type { EditorToolMode, FixtureType, EditorTable, TableShape, EditorSeat } from './types';
import { getFixtureTypeMetadata, getTableShapeMetadata } from './types';
import { TableRenderer, type ResizeHandle } from './TableRenderer';
import { SeatRenderer } from './SeatRenderer';

// =============================================================================
// TYPES
// =============================================================================

// Virtual floor plan for database mode (created from Section data)
interface VirtualFloorPlan {
  id: string;
  name: string;
  widthFeet: number;
  heightFeet: number;
  gridSizeFeet: number;
}

interface EditorCanvasProps {
  roomId: string;
  toolMode: EditorToolMode;
  fixtureType: FixtureType;
  tableShape?: TableShape;
  selectedFixtureId: string | null;
  selectedTableId: string | null;
  refreshKey: number;
  onFixtureSelect: (fixtureId: string | null) => void;
  onFixtureUpdate: (fixtureId: string, updates: Partial<Fixture>) => void;
  onFixtureCreate: (fixture: Omit<Fixture, 'id'>) => void;
  onFixtureDelete: (fixtureId: string) => void;
  // Table handling
  onTableSelect?: (tableId: string | null) => void;
  onTableCreate?: (table: Omit<EditorTable, 'id'>) => void;
  onTableUpdate?: (tableId: string, updates: Partial<EditorTable>) => void;
  onTableDelete?: (tableId: string) => void;
  // Seat handling
  dbSeats?: EditorSeat[];
  onSeatSelect?: (seatId: string | null) => void;
  onSeatUpdate?: (seatId: string, updates: { relativeX?: number; relativeY?: number }) => void;
  onSeatsReflow?: (tableId: string, dimensions: {
    oldWidth: number;
    oldHeight: number;
    newWidth: number;
    newHeight: number;
  }) => void;
  // Database mode props
  useDatabase?: boolean;
  dbFixtures?: Fixture[];
  dbTables?: EditorTable[];
  dbFloorPlan?: VirtualFloorPlan; // Section data for database mode
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EditorCanvas({
  roomId,
  toolMode,
  fixtureType,
  tableShape = 'rectangle',
  selectedFixtureId,
  selectedTableId,
  refreshKey,
  onFixtureSelect,
  onFixtureUpdate,
  onFixtureCreate,
  onFixtureDelete,
  onTableSelect,
  onTableCreate,
  onTableUpdate,
  onTableDelete,
  dbSeats,
  onSeatSelect,
  onSeatUpdate,
  onSeatsReflow,
  useDatabase = false,
  dbFixtures,
  dbTables,
  dbFloorPlan,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  // In database mode, use the dbFloorPlan prop; otherwise use in-memory API
  const [floorPlan, setFloorPlan] = useState(
    useDatabase && dbFloorPlan ? dbFloorPlan : FloorCanvasAPI.getFloorPlan(roomId)
  );
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [tables, setTables] = useState<EditorTable[]>([]);
  const [seats, setSeats] = useState<EditorSeat[]>([]);

  // Drawing state
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Dragging state (for fixtures)
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point | null>(null);

  // Dragging state (for tables)
  const [isDraggingTable, setIsDraggingTable] = useState(false);
  const [tableDragOffset, setTableDragOffset] = useState<Point | null>(null);

  // Resizing state (for tables)
  const [isResizingTable, setIsResizingTable] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [resizeStartDimensions, setResizeStartDimensions] = useState<{width: number, height: number} | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState<{x: number, y: number} | null>(null);
  const [resizeStartMousePos, setResizeStartMousePos] = useState<Point | null>(null);

  // Rotation state (for tables)
  const [isRotatingTable, setIsRotatingTable] = useState(false);
  const [rotationStartAngle, setRotationStartAngle] = useState(0);
  const [rotationStartMouseAngle, setRotationStartMouseAngle] = useState(0);

  // Dragging state (for seats)
  const [isDraggingSeat, setIsDraggingSeat] = useState(false);
  const [draggedSeatId, setDraggedSeatId] = useState<string | null>(null);
  const [seatDragOffset, setSeatDragOffset] = useState<Point | null>(null);
  const [originalSeatPos, setOriginalSeatPos] = useState<Point | null>(null);
  const [seatDragPreview, setSeatDragPreview] = useState<{ id: string; relativeX: number; relativeY: number } | null>(null);

  // Auto-offset for new fixtures to prevent stacking
  const [placementOffset, setPlacementOffset] = useState(0);

  // Debug mode for boundary visualization (toggle with keyboard)
  const [showBoundaryDebug, setShowBoundaryDebug] = useState(false);

  // Boundary configuration (distance from table edge in pixels)
  const SEAT_BOUNDARY_DISTANCE = 50;  // Increased from 40 - more room to drag
  const SEAT_MIN_DISTANCE = 10;       // Increased from 5 - clearer boundary
  const SEAT_RADIUS = 20;             // Increased from 15 - easier to click
  const SEAT_HIT_RADIUS = 25;         // Larger hit target for clicking
  const SEAT_COLLISION_RADIUS = 12;   // Reduced collision radius - seats can be closer

  // Check if a table would collide with any fixture
  const checkTableFixtureCollision = useCallback((
    tablePosX: number,  // in pixels
    tablePosY: number,  // in pixels
    tableWidth: number, // in pixels
    tableHeight: number // in pixels
  ): boolean => {
    const fixtureList = useDatabase ? (dbFixtures || []) : fixtures;

    for (const fixture of fixtureList) {
      if (fixture.geometry.type === 'rectangle') {
        // Convert fixture position from feet to pixels
        const fx = FloorCanvasAPI.feetToPixels(fixture.geometry.position.x);
        const fy = FloorCanvasAPI.feetToPixels(fixture.geometry.position.y);
        const fw = FloorCanvasAPI.feetToPixels(fixture.geometry.width);
        const fh = FloorCanvasAPI.feetToPixels(fixture.geometry.height);

        // AABB collision check
        if (tablePosX < fx + fw &&
            tablePosX + tableWidth > fx &&
            tablePosY < fy + fh &&
            tablePosY + tableHeight > fy) {
          return true;
        }
      } else if (fixture.geometry.type === 'circle') {
        // Convert circle center and radius from feet to pixels
        const cx = FloorCanvasAPI.feetToPixels(fixture.geometry.center.x);
        const cy = FloorCanvasAPI.feetToPixels(fixture.geometry.center.y);
        const cr = FloorCanvasAPI.feetToPixels(fixture.geometry.radius);

        // Simple bounding box check for circle
        if (tablePosX < cx + cr &&
            tablePosX + tableWidth > cx - cr &&
            tablePosY < cy + cr &&
            tablePosY + tableHeight > cy - cr) {
          return true;
        }
      }
    }
    return false;
  }, [useDatabase, dbFixtures, fixtures]);

  // Check if a table would collide with any other table
  const checkTableCollision = useCallback((
    tablePosX: number,   // in pixels
    tablePosY: number,   // in pixels
    tableWidth: number,  // in pixels
    tableHeight: number, // in pixels
    excludeTableId?: string  // Table being moved (exclude from collision check)
  ): boolean => {
    const tableList = useDatabase ? (dbTables || []) : tables;

    for (const table of tableList) {
      // Skip the table being moved
      if (excludeTableId && table.id === excludeTableId) {
        continue;
      }

      // AABB collision check
      if (tablePosX < table.posX + table.width &&
          tablePosX + tableWidth > table.posX &&
          tablePosY < table.posY + table.height &&
          tablePosY + tableHeight > table.posY) {
        return true; // Collision detected
      }
    }
    return false;
  }, [useDatabase, dbTables, tables]);

  // Check if a seat position collides with other seats
  const checkSeatCollision = useCallback((
    posX: number,
    posY: number,
    tableId: string,
    excludeSeatId?: string
  ): boolean => {
    const tableSeats = seats.filter(s => s.tableId === tableId && s.id !== excludeSeatId);
    const table = tables.find(t => t.id === tableId);
    if (!table) return false;

    const tableCenterX = table.posX + table.width / 2;
    const tableCenterY = table.posY + table.height / 2;

    for (const seat of tableSeats) {
      // Calculate absolute position of existing seat
      const seatAbsX = tableCenterX + seat.relativeX;
      const seatAbsY = tableCenterY + seat.relativeY;

      // Check distance between seat centers
      const distance = Math.hypot(posX - seatAbsX, posY - seatAbsY);

      // Collision if distance < 2 * SEAT_COLLISION_RADIUS (seats touching)
      if (distance < SEAT_COLLISION_RADIUS * 2 + 4) { // Using smaller collision radius
        return true;
      }
    }
    return false;
  }, [seats, tables, SEAT_COLLISION_RADIUS]);

  // Check if any seat of a table would collide with obstacles at a given table position
  const checkSeatsObstacleCollision = useCallback((
    tableId: string,
    newTablePosX: number,
    newTablePosY: number,
    tableWidth: number,
    tableHeight: number,
    tableRotation: number = 0
  ): boolean => {
    // Get seats for this table
    const tableSeats = seats.filter(s => s.tableId === tableId);
    if (tableSeats.length === 0) return false;

    const tableCenterX = newTablePosX + tableWidth / 2;
    const tableCenterY = newTablePosY + tableHeight / 2;
    const rotation = tableRotation * Math.PI / 180;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Check each seat against all obstacles
    for (const seat of tableSeats) {
      // Calculate absolute seat position at the new table location
      const rotatedX = seat.relativeX * cos - seat.relativeY * sin;
      const rotatedY = seat.relativeX * sin + seat.relativeY * cos;
      const seatAbsX = tableCenterX + rotatedX;
      const seatAbsY = tableCenterY + rotatedY;

      // Check against other tables (exclude current table)
      const tableList = useDatabase ? (dbTables || []) : tables;
      for (const otherTable of tableList) {
        if (otherTable.id === tableId) continue;

        // Simple AABB check with seat radius
        if (seatAbsX + SEAT_RADIUS > otherTable.posX &&
            seatAbsX - SEAT_RADIUS < otherTable.posX + otherTable.width &&
            seatAbsY + SEAT_RADIUS > otherTable.posY &&
            seatAbsY - SEAT_RADIUS < otherTable.posY + otherTable.height) {
          return true; // Collision with another table
        }
      }

      // Check against fixtures
      const fixtureList = useDatabase ? (dbFixtures || []) : fixtures;
      for (const fixture of fixtureList) {
        if (fixture.geometry.type === 'rectangle') {
          const fx = FloorCanvasAPI.feetToPixels(fixture.geometry.position.x);
          const fy = FloorCanvasAPI.feetToPixels(fixture.geometry.position.y);
          const fw = FloorCanvasAPI.feetToPixels(fixture.geometry.width);
          const fh = FloorCanvasAPI.feetToPixels(fixture.geometry.height);

          if (seatAbsX + SEAT_RADIUS > fx &&
              seatAbsX - SEAT_RADIUS < fx + fw &&
              seatAbsY + SEAT_RADIUS > fy &&
              seatAbsY - SEAT_RADIUS < fy + fh) {
            return true; // Collision with fixture
          }
        } else if (fixture.geometry.type === 'circle') {
          const cx = FloorCanvasAPI.feetToPixels(fixture.geometry.center.x);
          const cy = FloorCanvasAPI.feetToPixels(fixture.geometry.center.y);
          const cr = FloorCanvasAPI.feetToPixels(fixture.geometry.radius);

          const dist = Math.hypot(seatAbsX - cx, seatAbsY - cy);
          if (dist < cr + SEAT_RADIUS) {
            return true; // Collision with circular fixture
          }
        }
        // Lines (walls) - simplified bounding box check
        else if (fixture.geometry.type === 'line') {
          const { start, end } = fixture.geometry;
          const thickness = fixture.thickness || 0.5;
          const x1 = FloorCanvasAPI.feetToPixels(Math.min(start.x, end.x) - thickness);
          const x2 = FloorCanvasAPI.feetToPixels(Math.max(start.x, end.x) + thickness);
          const y1 = FloorCanvasAPI.feetToPixels(Math.min(start.y, end.y) - thickness);
          const y2 = FloorCanvasAPI.feetToPixels(Math.max(start.y, end.y) + thickness);

          if (seatAbsX + SEAT_RADIUS > x1 &&
              seatAbsX - SEAT_RADIUS < x2 &&
              seatAbsY + SEAT_RADIUS > y1 &&
              seatAbsY - SEAT_RADIUS < y2) {
            return true; // Collision with wall
          }
        }
      }
    }

    return false; // No collisions
  }, [seats, tables, fixtures, useDatabase, dbTables, dbFixtures, SEAT_RADIUS]);

  // Check if position is valid for a seat (boundary + not inside table)
  const isValidSeatPosition = useCallback((
    absoluteX: number,
    absoluteY: number,
    table: EditorTable,
    excludeSeatId?: string
  ): boolean => {
    const tableCenterX = table.posX + table.width / 2;
    const tableCenterY = table.posY + table.height / 2;

    // If table is rotated, transform the check point to table-local coordinates
    const rotation = (table.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);

    // Translate to table center, rotate, translate back
    const dx = absoluteX - tableCenterX;
    const dy = absoluteY - tableCenterY;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // Now check against unrotated table bounds
    const halfWidth = table.width / 2;
    const halfHeight = table.height / 2;

    // Outer boundary (can't go beyond this)
    const outerHalfWidth = halfWidth + SEAT_BOUNDARY_DISTANCE;
    const outerHalfHeight = halfHeight + SEAT_BOUNDARY_DISTANCE;

    if (Math.abs(localX) > outerHalfWidth || Math.abs(localY) > outerHalfHeight) {
      return false; // Outside boundary
    }

    // Inner boundary (can't be inside table)
    const innerHalfWidth = halfWidth - SEAT_MIN_DISTANCE;
    const innerHalfHeight = halfHeight - SEAT_MIN_DISTANCE;

    if (Math.abs(localX) < innerHalfWidth && Math.abs(localY) < innerHalfHeight) {
      return false; // Inside table
    }

    // Check seat-to-seat collision
    if (checkSeatCollision(absoluteX, absoluteY, table.id, excludeSeatId)) {
      return false; // Collides with another seat
    }

    return true;
  }, [checkSeatCollision, SEAT_BOUNDARY_DISTANCE, SEAT_MIN_DISTANCE]);

  // Load floor plan and fixtures
  useEffect(() => {
    if (useDatabase && dbFloorPlan) {
      // Database mode: use the dbFloorPlan prop
      setFloorPlan(dbFloorPlan);
    } else if (!useDatabase) {
      // In-memory mode: use FloorCanvasAPI
      const fp = FloorCanvasAPI.getFloorPlan(roomId);
      setFloorPlan(fp);
      if (fp) {
        const fixtureList = FloorCanvasAPI.getFixtures(fp.id);
        setFixtures(fixtureList);
      }
    }
  }, [roomId, useDatabase, dbFloorPlan]);

  // Update fixtures from dbFixtures prop when in database mode
  useEffect(() => {
    if (useDatabase && dbFixtures) {
      setFixtures(dbFixtures);
    }
  }, [useDatabase, dbFixtures, refreshKey]);

  // Update tables from dbTables prop when in database mode
  useEffect(() => {
    if (useDatabase && dbTables) {
      setTables(dbTables);
    }
  }, [useDatabase, dbTables, refreshKey]);

  // Update seats from dbSeats prop when in database mode
  useEffect(() => {
    if (useDatabase && dbSeats) {
      setSeats(dbSeats);

      // Clear any stale seat references that no longer exist in the new seats array
      const seatIds = new Set(dbSeats.map(s => s.id));

      if (draggedSeatId && !seatIds.has(draggedSeatId)) {
        setDraggedSeatId(null);
        setIsDraggingSeat(false);
        setSeatDragOffset(null);
        setOriginalSeatPos(null);
        setSeatDragPreview(null);
      }
    }
  }, [useDatabase, dbSeats, refreshKey, draggedSeatId]);

  // Refresh fixtures when they change (in-memory mode only)
  const refreshFixtures = useCallback(() => {
    if (useDatabase) {
      // In database mode, parent handles refresh
      return;
    }
    if (floorPlan) {
      const fixtureList = FloorCanvasAPI.getFixtures(floorPlan.id);
      setFixtures(fixtureList);
    }
  }, [floorPlan, useDatabase]);

  // Immediate refresh on refreshKey change (eliminates lag) - in-memory mode only
  useEffect(() => {
    if (useDatabase) return; // Database mode handled by dbFixtures prop
    if (floorPlan) {
      const fixtureList = FloorCanvasAPI.getFixtures(floorPlan.id);
      setFixtures(fixtureList);
    }
  }, [refreshKey, floorPlan, useDatabase]);

  // Refresh fixtures when a selected fixture might have been updated - in-memory mode only
  useEffect(() => {
    if (useDatabase) return; // Database mode handled by dbFixtures prop
    if (selectedFixtureId && floorPlan) {
      // Refresh to pick up property changes from the Properties panel
      const fixtureList = FloorCanvasAPI.getFixtures(floorPlan.id);
      setFixtures(fixtureList);
    }
  }, [selectedFixtureId, floorPlan, useDatabase]);

  // Fast polling to catch any external updates - in-memory mode only
  useEffect(() => {
    if (useDatabase) return; // Database mode doesn't need polling
    if (!floorPlan) return;

    const intervalId = setInterval(() => {
      const fixtureList = FloorCanvasAPI.getFixtures(floorPlan.id);
      setFixtures(fixtureList);
    }, 100); // Refresh every 100ms for smoother updates

    return () => clearInterval(intervalId);
  }, [floorPlan, useDatabase]);

  // Reset placement offset when tool mode changes
  useEffect(() => {
    setPlacementOffset(0);
  }, [toolMode]);

  // ESC to cancel seat drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDraggingSeat && originalSeatPos) {
        // Cancel drag, revert to original position
        setSeatDragPreview(null);
        setIsDraggingSeat(false);
        setDraggedSeatId(null);
        setSeatDragOffset(null);
        setOriginalSeatPos(null);
      }
      if (e.key === 'b' && e.ctrlKey) {
        setShowBoundaryDebug(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDraggingSeat, originalSeatPos]);

  // Get canvas dimensions - use floorPlan dimensions directly (works for both database and in-memory mode)
  const canvasDimensions = floorPlan
    ? {
        widthPx: FloorCanvasAPI.feetToPixels(floorPlan.widthFeet),
        heightPx: FloorCanvasAPI.feetToPixels(floorPlan.heightFeet),
      }
    : { widthPx: 800, heightPx: 600 };

  // Calculate angle from table center to mouse position
  const calculateAngle = useCallback((tableCenter: Point, mousePos: Point): number => {
    const dx = mousePos.x - tableCenter.x;
    const dy = mousePos.y - tableCenter.y;
    return Math.atan2(dy, dx) * (180 / Math.PI) + 90; // 0 degrees = up
  }, []);

  // Convert screen position to floor position (feet)
  const screenToFloor = useCallback(
    (screenX: number, screenY: number): Point => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const rect = canvasRef.current.getBoundingClientRect();
      const x = screenX - rect.left;
      const y = screenY - rect.top;
      const position: Point = {
        x: FloorCanvasAPI.pixelsToFeet(x),
        y: FloorCanvasAPI.pixelsToFeet(y),
      };
      // Snap to grid
      if (floorPlan) {
        return FloorCanvasAPI.snapToGrid(position, floorPlan.gridSizeFeet);
      }
      return position;
    },
    [floorPlan]
  );

  // Handle resize start for tables
  const handleResizeStart = useCallback(
    (handle: ResizeHandle) => {
      if (!selectedTableId) return;
      const table = tables.find(t => t.id === selectedTableId);
      if (!table) return;

      setIsResizingTable(true);
      setResizeHandle(handle);
      setResizeStartDimensions({ width: table.width, height: table.height });
      setResizeStartPos({ x: table.posX, y: table.posY });
      // Mouse position will be captured in the next mouse move
    },
    [selectedTableId, tables]
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!floorPlan) return;

      const point = screenToFloor(event.clientX, event.clientY);

      // SELECT mode: Check if clicking on a seat to drag
      if (toolMode === 'SELECT') {
        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };

        // Check if clicking on any seat
        for (const seat of seats) {
          const table = tables.find(t => t.id === seat.tableId);
          if (!table) continue;

          const tableCenterX = table.posX + table.width / 2;
          const tableCenterY = table.posY + table.height / 2;

          // Calculate absolute seat position
          const rotation = (table.rotation || 0) * Math.PI / 180;
          const cos = Math.cos(rotation);
          const sin = Math.sin(rotation);
          const rotatedX = seat.relativeX * cos - seat.relativeY * sin;
          const rotatedY = seat.relativeX * sin + seat.relativeY * cos;

          const seatAbsX = tableCenterX + rotatedX;
          const seatAbsY = tableCenterY + rotatedY;

          // Check if click is within seat radius
          const distance = Math.hypot(pointPx.x - seatAbsX, pointPx.y - seatAbsY);
          if (distance <= SEAT_HIT_RADIUS) {
            // Start dragging seat
            setIsDraggingSeat(true);
            setDraggedSeatId(seat.id);
            setSeatDragOffset({ x: pointPx.x - seatAbsX, y: pointPx.y - seatAbsY });
            setOriginalSeatPos({ x: seat.relativeX, y: seat.relativeY });
            if (onSeatSelect) {
              onSeatSelect(seat.id);
            }
            return; // Early return to prevent selecting table/fixture
          }
        }
      }

      // SELECT mode: Check if clicking on a fixture to drag
      if (toolMode === 'SELECT' && selectedFixtureId) {
        const fixture = fixtures.find((f) => f.id === selectedFixtureId);
        if (fixture) {
          // Calculate if click is on this fixture
          let isOnFixture = false;
          if (fixture.geometry.type === 'rectangle') {
            const { position, width, height } = fixture.geometry;
            isOnFixture =
              point.x >= position.x &&
              point.x <= position.x + width &&
              point.y >= position.y &&
              point.y <= position.y + height;
            if (isOnFixture) {
              setIsDragging(true);
              setDragOffset({ x: point.x - position.x, y: point.y - position.y });
              return; // Early return to prevent re-selection
            }
          } else if (fixture.geometry.type === 'circle') {
            const { center, radius } = fixture.geometry;
            const dist = Math.sqrt(Math.pow(point.x - center.x, 2) + Math.pow(point.y - center.y, 2));
            isOnFixture = dist <= radius;
            if (isOnFixture) {
              setIsDragging(true);
              setDragOffset({ x: point.x - center.x, y: point.y - center.y });
              return; // Early return to prevent re-selection
            }
          }
        }
      }

      // WALL mode: Start drawing
      if (toolMode === 'WALL') {
        if (!startPoint) {
          // Snap start point to existing wall endpoints
          const snapDistance = 0.5; // feet
          let snappedStart = point;

          fixtures.forEach((f) => {
            if (f.geometry.type === 'line') {
              const { start, end } = f.geometry;
              // Check distance to start point
              if (Math.hypot(point.x - start.x, point.y - start.y) < snapDistance) {
                snappedStart = start;
              }
              // Check distance to end point
              if (Math.hypot(point.x - end.x, point.y - end.y) < snapDistance) {
                snappedStart = end;
              }
            }
          });

          setStartPoint(snappedStart);
        } else {
          // Snap end point to existing wall endpoints
          const snapDistance = 0.5; // feet
          let snappedEnd = point;

          fixtures.forEach((f) => {
            if (f.geometry.type === 'line') {
              const { start, end } = f.geometry;
              // Check distance to start point
              if (Math.hypot(point.x - start.x, point.y - start.y) < snapDistance) {
                snappedEnd = start;
              }
              // Check distance to end point
              if (Math.hypot(point.x - end.x, point.y - end.y) < snapDistance) {
                snappedEnd = end;
              }
            }
          });

          // Complete the wall
          const metadata = getFixtureTypeMetadata('wall');
          onFixtureCreate({
            floorPlanId: floorPlan.id,
            roomId: floorPlan.id,
            type: 'wall',
            category: metadata.category,
            label: metadata.label,
            geometry: { type: 'line', start: startPoint, end: snappedEnd },
            color: metadata.defaultColor,
            opacity: 1,
            thickness: metadata.defaultThickness,
            height: 'full',
            blocksPlacement: true,
            blocksMovement: true,
            snapTarget: false,
            isActive: true,
          });
          setStartPoint(null);
          refreshFixtures();
        }
        return;
      }

      // RECTANGLE mode: Start drawing
      if (toolMode === 'RECTANGLE') {
        setStartPoint(point);
        setIsDrawing(true);
        return;
      }

      // CIRCLE mode: Place circle
      if (toolMode === 'CIRCLE') {
        // Apply auto-offset to prevent stacking
        const offsetCenter = {
          x: point.x + (placementOffset * 0.5),
          y: point.y + (placementOffset * 0.5),
        };
        setPlacementOffset((prev) => (prev + 1) % 10); // Reset after 10

        const metadata = getFixtureTypeMetadata(fixtureType);
        onFixtureCreate({
          floorPlanId: floorPlan.id,
          roomId: floorPlan.id,
          type: fixtureType,
          category: metadata.category,
          label: metadata.label,
          geometry: { type: 'circle', center: offsetCenter, radius: 1 },
          color: metadata.defaultColor,
          opacity: metadata.category === 'zone' ? 0.3 : 1,
          thickness: metadata.defaultThickness,
          height: 'full',
          blocksPlacement: true,
          blocksMovement: true,
          snapTarget: false,
          isActive: true,
        });
        refreshFixtures();
        return;
      }

      // TABLE mode: Place table
      if (toolMode === 'TABLE' && onTableCreate) {
        const shapeMetadata = getTableShapeMetadata(tableShape);

        // Convert click position to pixels (tables stored in pixels in DB)
        const posX = FloorCanvasAPI.feetToPixels(point.x) - shapeMetadata.defaultWidth / 2;
        const posY = FloorCanvasAPI.feetToPixels(point.y) - shapeMetadata.defaultHeight / 2;

        // Check for collision with fixtures
        if (checkTableFixtureCollision(posX, posY, shapeMetadata.defaultWidth, shapeMetadata.defaultHeight)) {
          console.log('[EditorCanvas] Cannot place table: collision with fixture');
          return;
        }

        // Check for collision with other tables
        if (checkTableCollision(posX, posY, shapeMetadata.defaultWidth, shapeMetadata.defaultHeight)) {
          console.log('[EditorCanvas] Cannot place table: collision with another table');
          return;
        }

        // Generate table name
        const existingTableCount = tables.length;
        const tableName = `Table ${existingTableCount + 1}`;
        const abbrev = `T${existingTableCount + 1}`;

        onTableCreate({
          name: tableName,
          abbreviation: abbrev,
          capacity: shapeMetadata.defaultCapacity,
          posX,
          posY,
          width: shapeMetadata.defaultWidth,
          height: shapeMetadata.defaultHeight,
          rotation: 0,
          shape: tableShape,
          seatPattern: shapeMetadata.defaultSeatPattern,
          sectionId: roomId,
          status: 'available',
          isLocked: false,
        });
        return;
      }

      // DELETE mode: Delete fixture or table
      if (toolMode === 'DELETE') {
        // Convert point to pixels for table comparison
        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };

        // First check if clicking on a table
        const tableToDelete = tables.find((t) => {
          return (
            pointPx.x >= t.posX &&
            pointPx.x <= t.posX + t.width &&
            pointPx.y >= t.posY &&
            pointPx.y <= t.posY + t.height
          );
        });

        if (tableToDelete && onTableDelete) {
          onTableDelete(tableToDelete.id);
          return;
        }

        // Find fixture at this point
        const fixtureToDelete = fixtures.find((f) => {
          if (f.geometry.type === 'rectangle') {
            const { position, width, height } = f.geometry;
            return (
              point.x >= position.x &&
              point.x <= position.x + width &&
              point.y >= position.y &&
              point.y <= position.y + height
            );
          }
          if (f.geometry.type === 'circle') {
            const { center, radius } = f.geometry;
            const dist = Math.sqrt(Math.pow(point.x - center.x, 2) + Math.pow(point.y - center.y, 2));
            return dist <= radius;
          }
          if (f.geometry.type === 'line') {
            // Simplified: check if point is near line
            const { start, end } = f.geometry;
            const thickness = f.thickness || 0.5;
            const minX = Math.min(start.x, end.x) - thickness;
            const maxX = Math.max(start.x, end.x) + thickness;
            const minY = Math.min(start.y, end.y) - thickness;
            const maxY = Math.max(start.y, end.y) + thickness;
            return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
          }
          return false;
        });

        if (fixtureToDelete) {
          onFixtureDelete(fixtureToDelete.id);
          refreshFixtures();
        }
        return;
      }

      // SELECT mode: Select fixture or table
      if (toolMode === 'SELECT') {
        // Convert point to pixels for table comparison
        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };

        // First check if clicking on a table
        const clickedTable = tables.find((t) => {
          return (
            pointPx.x >= t.posX &&
            pointPx.x <= t.posX + t.width &&
            pointPx.y >= t.posY &&
            pointPx.y <= t.posY + t.height
          );
        });

        if (clickedTable) {
          onFixtureSelect(null); // Deselect fixture
          if (onTableSelect) {
            onTableSelect(clickedTable.id);
            // Start dragging table if not locked
            if (!clickedTable.isLocked) {
              setIsDraggingTable(true);
              setTableDragOffset({
                x: pointPx.x - clickedTable.posX,
                y: pointPx.y - clickedTable.posY,
              });
            }
          }
          return;
        }

        // Then check fixtures
        const clickedFixture = fixtures.find((f) => {
          if (f.geometry.type === 'rectangle') {
            const { position, width, height } = f.geometry;
            return (
              point.x >= position.x &&
              point.x <= position.x + width &&
              point.y >= position.y &&
              point.y <= position.y + height
            );
          }
          if (f.geometry.type === 'circle') {
            const { center, radius } = f.geometry;
            const dist = Math.sqrt(Math.pow(point.x - center.x, 2) + Math.pow(point.y - center.y, 2));
            return dist <= radius;
          }
          if (f.geometry.type === 'line') {
            const { start, end } = f.geometry;
            const thickness = f.thickness || 0.5;
            const minX = Math.min(start.x, end.x) - thickness;
            const maxX = Math.max(start.x, end.x) + thickness;
            const minY = Math.min(start.y, end.y) - thickness;
            const maxY = Math.max(start.y, end.y) + thickness;
            return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
          }
          return false;
        });

        if (onTableSelect) {
          onTableSelect(null); // Deselect table
        }
        onFixtureSelect(clickedFixture ? clickedFixture.id : null);
      }
    },
    [
      floorPlan,
      toolMode,
      fixtureType,
      tableShape,
      selectedFixtureId,
      selectedTableId,
      startPoint,
      fixtures,
      tables,
      seats,
      screenToFloor,
      onFixtureSelect,
      onFixtureCreate,
      onFixtureDelete,
      onTableSelect,
      onTableCreate,
      onTableDelete,
      onSeatSelect,
      refreshFixtures,
      checkTableFixtureCollision,
      checkTableCollision,
      placementOffset,
      SEAT_RADIUS,
    ]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!floorPlan) return;

      const point = screenToFloor(event.clientX, event.clientY);
      setCurrentPoint(point);

      // Handle seat dragging
      if (isDraggingSeat && draggedSeatId && seatDragOffset) {
        const seat = seats.find(s => s.id === draggedSeatId);
        if (!seat) return;

        const table = tables.find(t => t.id === seat.tableId);
        if (!table) return;

        const tableCenterX = table.posX + table.width / 2;
        const tableCenterY = table.posY + table.height / 2;

        // Calculate new absolute position
        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };
        let absoluteX = pointPx.x - seatDragOffset.x;
        let absoluteY = pointPx.y - seatDragOffset.y;

        // CLAMP to valid zone instead of rejecting
        // Transform to table-local coordinates for boundary check
        const rotation = (table.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = absoluteX - tableCenterX;
        const dy = absoluteY - tableCenterY;
        let localX = dx * cos - dy * sin;
        let localY = dx * sin + dy * cos;

        const halfWidth = table.width / 2;
        const halfHeight = table.height / 2;

        // Clamp to outer boundary
        const outerHalfWidth = halfWidth + SEAT_BOUNDARY_DISTANCE;
        const outerHalfHeight = halfHeight + SEAT_BOUNDARY_DISTANCE;
        localX = Math.max(-outerHalfWidth, Math.min(outerHalfWidth, localX));
        localY = Math.max(-outerHalfHeight, Math.min(outerHalfHeight, localY));

        // Push out of table body if seat is inside
        // Seat is "inside" if BOTH x and y are within table bounds
        const SEAT_CLEARANCE = 25; // Distance from table edge to seat center
        if (Math.abs(localX) < halfWidth && Math.abs(localY) < halfHeight) {
          // Seat center is INSIDE the table - push to nearest edge with clearance
          const distToLeftRight = halfWidth - Math.abs(localX);
          const distToTopBottom = halfHeight - Math.abs(localY);

          if (distToLeftRight < distToTopBottom) {
            // Closer to left/right edge - push horizontally
            localX = localX >= 0 ? (halfWidth + SEAT_CLEARANCE) : -(halfWidth + SEAT_CLEARANCE);
          } else {
            // Closer to top/bottom edge - push vertically
            localY = localY >= 0 ? (halfHeight + SEAT_CLEARANCE) : -(halfHeight + SEAT_CLEARANCE);
          }
        }

        // Use clamped local coordinates as the new relative position
        const newRelativeX = localX;
        const newRelativeY = localY;

        // Update local state immediately for smooth dragging
        setSeatDragPreview({ id: draggedSeatId, relativeX: newRelativeX, relativeY: newRelativeY });
        return;
      }

      // Handle table rotation
      if (isRotatingTable && selectedTableId && onTableUpdate) {
        const currentTable = tables.find(t => t.id === selectedTableId);
        if (!currentTable) return;

        // Convert point to pixels for angle calculation
        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };

        // Calculate table center in pixels
        const tableCenter = {
          x: currentTable.posX + currentTable.width / 2,
          y: currentTable.posY + currentTable.height / 2,
        };

        // Calculate current mouse angle
        const currentMouseAngle = calculateAngle(tableCenter, pointPx);
        const deltaAngle = currentMouseAngle - rotationStartMouseAngle;
        let newRotation = rotationStartAngle + deltaAngle;

        // Snap to 15° increments when holding Shift
        if (event.shiftKey) {
          newRotation = Math.round(newRotation / 15) * 15;
        }

        // Normalize to 0-360
        newRotation = ((newRotation % 360) + 360) % 360;

        onTableUpdate(selectedTableId, { rotation: newRotation });
        return;
      }

      // Handle table dragging
      // Handle table resizing
      if (isResizingTable && selectedTableId && resizeHandle && resizeStartDimensions && resizeStartPos && onTableUpdate) {
        const currentTable = tables.find(t => t.id === selectedTableId);
        if (!currentTable) return;

        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };

        if (!resizeStartMousePos) {
          setResizeStartMousePos(pointPx);
          return;
        }

        // Shape-specific minimum sizes
        const getMinimumSize = (shape: TableShape): { minWidth: number; minHeight: number } => {
          switch (shape) {
            case 'bar':
              return { minWidth: 80, minHeight: 30 };  // Wide and short
            case 'booth':
              return { minWidth: 60, minHeight: 80 };  // Taller than wide
            case 'round':
            case 'square':
              return { minWidth: 50, minHeight: 50 };  // Equal dimensions
            case 'oval':
              return { minWidth: 60, minHeight: 40 };  // Slightly wide
            case 'rectangle':
            default:
              return { minWidth: 60, minHeight: 40 };
          }
        };

        const gridPx = FloorCanvasAPI.feetToPixels(floorPlan.gridSizeFeet);
        const { minWidth, minHeight } = getMinimumSize(currentTable.shape as TableShape);
        const deltaX = pointPx.x - resizeStartMousePos.x;
        const deltaY = pointPx.y - resizeStartMousePos.y;

        let newWidth = resizeStartDimensions.width;
        let newHeight = resizeStartDimensions.height;
        let newPosX = resizeStartPos.x;
        let newPosY = resizeStartPos.y;

        const maintainAspect = currentTable.shape === 'round' || currentTable.shape === 'square';

        switch (resizeHandle) {
          case 'se':
            // Southeast corner - change both dimensions
            newWidth = Math.max(minWidth, resizeStartDimensions.width + deltaX);
            newHeight = Math.max(minHeight, resizeStartDimensions.height + deltaY);
            if (maintainAspect) {
              const size = Math.max(Math.min(newWidth, newHeight), minWidth);
              newWidth = size;
              newHeight = size;
            }
            break;
          case 'sw':
            // Southwest corner - change both dimensions
            newWidth = Math.max(minWidth, resizeStartDimensions.width - deltaX);
            newHeight = Math.max(minHeight, resizeStartDimensions.height + deltaY);
            newPosX = resizeStartPos.x + (resizeStartDimensions.width - newWidth);
            if (maintainAspect) {
              const size = Math.max(Math.min(newWidth, newHeight), minWidth);
              newWidth = size;
              newHeight = size;
              newPosX = resizeStartPos.x + (resizeStartDimensions.width - size);
            }
            break;
          case 'ne':
            // Northeast corner - change both dimensions
            newWidth = Math.max(minWidth, resizeStartDimensions.width + deltaX);
            newHeight = Math.max(minHeight, resizeStartDimensions.height - deltaY);
            newPosY = resizeStartPos.y + (resizeStartDimensions.height - newHeight);
            if (maintainAspect) {
              const size = Math.max(Math.min(newWidth, newHeight), minWidth);
              newWidth = size;
              newHeight = size;
              newPosY = resizeStartPos.y + (resizeStartDimensions.height - size);
            }
            break;
          case 'nw':
            // Northwest corner - change both dimensions
            newWidth = Math.max(minWidth, resizeStartDimensions.width - deltaX);
            newHeight = Math.max(minHeight, resizeStartDimensions.height - deltaY);
            newPosX = resizeStartPos.x + (resizeStartDimensions.width - newWidth);
            newPosY = resizeStartPos.y + (resizeStartDimensions.height - newHeight);
            if (maintainAspect) {
              const size = Math.max(Math.min(newWidth, newHeight), minWidth);
              newWidth = size;
              newHeight = size;
              newPosX = resizeStartPos.x + (resizeStartDimensions.width - size);
              newPosY = resizeStartPos.y + (resizeStartDimensions.height - size);
            }
            break;
          case 'e':
            // East edge - only change width
            newWidth = Math.max(minWidth, resizeStartDimensions.width + deltaX);
            newHeight = resizeStartDimensions.height; // Don't change height
            if (maintainAspect) {
              newHeight = newWidth; // For round/square, height matches width
            }
            break;
          case 'w':
            // West edge - only change width
            newWidth = Math.max(minWidth, resizeStartDimensions.width - deltaX);
            newHeight = resizeStartDimensions.height; // Don't change height
            newPosX = resizeStartPos.x + (resizeStartDimensions.width - newWidth);
            if (maintainAspect) {
              newHeight = newWidth; // For round/square, height matches width
            }
            break;
          case 's':
            // South edge - only change height
            newWidth = resizeStartDimensions.width; // Don't change width
            newHeight = Math.max(minHeight, resizeStartDimensions.height + deltaY);
            if (maintainAspect) {
              newWidth = newHeight; // For round/square, width matches height
            }
            break;
          case 'n':
            // North edge - only change height
            newWidth = resizeStartDimensions.width; // Don't change width
            newHeight = Math.max(minHeight, resizeStartDimensions.height - deltaY);
            newPosY = resizeStartPos.y + (resizeStartDimensions.height - newHeight);
            if (maintainAspect) {
              newWidth = newHeight; // For round/square, width matches height
            }
            break;
        }

        newWidth = Math.round(newWidth / gridPx) * gridPx;
        newHeight = Math.round(newHeight / gridPx) * gridPx;
        newPosX = Math.round(newPosX / gridPx) * gridPx;
        newPosY = Math.round(newPosY / gridPx) * gridPx;

        if (checkTableFixtureCollision(newPosX, newPosY, newWidth, newHeight)) return;
        if (checkTableCollision(newPosX, newPosY, newWidth, newHeight, selectedTableId)) return;

        // Note: After resize, seats are reflowed. Check if reflowed positions would collide.
        // For simplicity, check if expanded table footprint + seat boundary would hit obstacles
        const expandedWidth = newWidth + SEAT_BOUNDARY_DISTANCE * 2;
        const expandedHeight = newHeight + SEAT_BOUNDARY_DISTANCE * 2;
        const expandedPosX = newPosX - SEAT_BOUNDARY_DISTANCE;
        const expandedPosY = newPosY - SEAT_BOUNDARY_DISTANCE;

        if (checkTableFixtureCollision(expandedPosX, expandedPosY, expandedWidth, expandedHeight)) return;
        if (checkTableCollision(expandedPosX, expandedPosY, expandedWidth, expandedHeight, selectedTableId)) return;

        onTableUpdate(selectedTableId, {
          width: newWidth,
          height: newHeight,
          posX: newPosX,
          posY: newPosY,
        });
        return;
      }

      if (isDraggingTable && selectedTableId && tableDragOffset && onTableUpdate) {
        // Convert point to pixels for table positioning
        const pointPx = {
          x: FloorCanvasAPI.feetToPixels(point.x),
          y: FloorCanvasAPI.feetToPixels(point.y),
        };

        // Snap to grid (convert grid size to pixels)
        const gridPx = FloorCanvasAPI.feetToPixels(floorPlan.gridSizeFeet);
        const newPosX = Math.round((pointPx.x - tableDragOffset.x) / gridPx) * gridPx;
        const newPosY = Math.round((pointPx.y - tableDragOffset.y) / gridPx) * gridPx;

        // Get current table dimensions
        const currentTable = tables.find(t => t.id === selectedTableId);
        if (currentTable) {
          // Check for collision with fixtures
          if (checkTableFixtureCollision(newPosX, newPosY, currentTable.width, currentTable.height)) {
            // Don't update position if collision detected
            return;
          }

          // Check for collision with other tables (exclude self)
          if (checkTableCollision(newPosX, newPosY, currentTable.width, currentTable.height, selectedTableId)) {
            // Don't update position if collision detected
            return;
          }

          // Check if seats would collide with obstacles at new position
          if (checkSeatsObstacleCollision(
            selectedTableId,
            newPosX,
            newPosY,
            currentTable.width,
            currentTable.height,
            currentTable.rotation || 0
          )) {
            return; // Don't allow move if seats would collide
          }
        }

        onTableUpdate(selectedTableId, {
          posX: newPosX,
          posY: newPosY,
        });
        return;
      }

      // Handle fixture dragging
      if (isDragging && selectedFixtureId && dragOffset) {
        const fixture = fixtures.find((f) => f.id === selectedFixtureId);
        if (fixture && fixture.geometry.type === 'rectangle') {
          const newPosition = {
            x: point.x - dragOffset.x,
            y: point.y - dragOffset.y,
          };
          onFixtureUpdate(selectedFixtureId, {
            geometry: {
              ...fixture.geometry,
              position: newPosition,
            },
          });
        } else if (fixture && fixture.geometry.type === 'circle') {
          const newCenter = {
            x: point.x - dragOffset.x,
            y: point.y - dragOffset.y,
          };
          onFixtureUpdate(selectedFixtureId, {
            geometry: {
              ...fixture.geometry,
              center: newCenter,
            },
          });
        }
        refreshFixtures();
      }
    },
    [floorPlan, isDragging, isDraggingTable, isDraggingSeat, draggedSeatId, seatDragOffset, isRotatingTable, isResizingTable, resizeHandle, resizeStartDimensions, resizeStartPos, resizeStartMousePos, selectedFixtureId, selectedTableId, dragOffset, tableDragOffset, rotationStartAngle, rotationStartMouseAngle, fixtures, tables, seats, screenToFloor, calculateAngle, onFixtureUpdate, onTableUpdate, refreshFixtures, checkTableFixtureCollision, checkTableCollision, checkSeatsObstacleCollision, isValidSeatPosition]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
      if (!floorPlan) return;

      // Save seat position
      if (isDraggingSeat && draggedSeatId && seatDragPreview && onSeatUpdate) {
        const seat = seats.find(s => s.id === draggedSeatId);
        const table = seat ? tables.find(t => t.id === seat.tableId) : null;

        if (seat && table) {
          const tableCenterX = table.posX + table.width / 2;
          const tableCenterY = table.posY + table.height / 2;
          const rotation = (table.rotation || 0) * Math.PI / 180;

          // Calculate absolute position from preview
          let finalRelX = seatDragPreview.relativeX;
          let finalRelY = seatDragPreview.relativeY;

          // Convert to absolute for collision check
          const absX = tableCenterX + (finalRelX * Math.cos(rotation) - finalRelY * Math.sin(rotation));
          const absY = tableCenterY + (finalRelX * Math.sin(rotation) + finalRelY * Math.cos(rotation));

          // Check if final position collides with another seat
          if (checkSeatCollision(absX, absY, table.id, draggedSeatId)) {
            // Find the colliding seat
            const otherSeats = seats.filter(s => s.tableId === table.id && s.id !== draggedSeatId);
            let collidingSeat: typeof seat | undefined;

            for (const other of otherSeats) {
              const otherAbsX = tableCenterX + (other.relativeX * Math.cos(rotation) - other.relativeY * Math.sin(rotation));
              const otherAbsY = tableCenterY + (other.relativeX * Math.sin(rotation) + other.relativeY * Math.cos(rotation));
              const dist = Math.hypot(absX - otherAbsX, absY - otherAbsY);
              if (dist < SEAT_COLLISION_RADIUS * 2 + 8) {
                collidingSeat = other;
                break;
              }
            }

            if (collidingSeat) {
              // PUSH-SWAP: Move colliding seat to dragged seat's original position
              // This creates a natural "swap" effect
              if (originalSeatPos && onSeatUpdate) {
                onSeatUpdate(collidingSeat.id, {
                  relativeX: Math.round(originalSeatPos.x),
                  relativeY: Math.round(originalSeatPos.y),
                });
              }
            }
            // Use the preview position (where user dropped it)
            // The colliding seat was pushed to our old spot
          }

          // Save final position
          onSeatUpdate(draggedSeatId, {
            relativeX: Math.round(finalRelX),
            relativeY: Math.round(finalRelY),
          });
        }

        // Clear drag state
        setIsDraggingSeat(false);
        setDraggedSeatId(null);
        setSeatDragOffset(null);
        setOriginalSeatPos(null);
        setSeatDragPreview(null);
        return;
      }

      // End table rotation
      if (isRotatingTable) {
        setIsRotatingTable(false);
        setRotationStartAngle(0);
        setRotationStartMouseAngle(0);
        return;
      }

      // End table dragging
      // End table resizing
      if (isResizingTable) {
        // Trigger seat reflow if dimensions changed
        if (selectedTableId && resizeStartDimensions && onSeatsReflow) {
          const tableList = useDatabase ? (dbTables || []) : tables;
          const table = tableList.find(t => t.id === selectedTableId);
          if (table) {
            const widthChanged = table.width !== resizeStartDimensions.width;
            const heightChanged = table.height !== resizeStartDimensions.height;

            if (widthChanged || heightChanged) {
              onSeatsReflow(selectedTableId, {
                oldWidth: resizeStartDimensions.width,
                oldHeight: resizeStartDimensions.height,
                newWidth: table.width,
                newHeight: table.height,
              });
            }
          }
        }

        setIsResizingTable(false);
        setResizeHandle(null);
        setResizeStartDimensions(null);
        setResizeStartPos(null);
        setResizeStartMousePos(null);
        return;
      }

      if (isDraggingTable) {
        setIsDraggingTable(false);
        setTableDragOffset(null);
        return;
      }

      // End fixture dragging
      if (isDragging) {
        setIsDragging(false);
        setDragOffset(null);
        return;
      }

      // RECTANGLE mode: Complete drawing
      if (toolMode === 'RECTANGLE' && isDrawing && startPoint) {
        const point = screenToFloor(event.clientX, event.clientY);
        const width = Math.abs(point.x - startPoint.x);
        const height = Math.abs(point.y - startPoint.y);

        // Only create if has some size
        if (width > 0.5 && height > 0.5) {
          // Apply auto-offset to prevent stacking
          const basePosition = {
            x: Math.min(startPoint.x, point.x),
            y: Math.min(startPoint.y, point.y),
          };
          const position = {
            x: basePosition.x + (placementOffset * 0.5),
            y: basePosition.y + (placementOffset * 0.5),
          };
          setPlacementOffset((prev) => (prev + 1) % 10); // Reset after 10

          const metadata = getFixtureTypeMetadata(fixtureType);
          onFixtureCreate({
            floorPlanId: floorPlan.id,
            roomId: floorPlan.id,
            type: fixtureType,
            category: metadata.category,
            label: metadata.label,
            geometry: { type: 'rectangle', position, width, height, rotation: 0 },
            color: metadata.defaultColor,
            opacity: metadata.category === 'zone' ? 0.3 : 1,
            thickness: metadata.defaultThickness,
            height: metadata.category === 'surface' ? 'counter' : null,
            blocksPlacement: true,
            blocksMovement: metadata.category !== 'zone',
            snapTarget: metadata.category === 'surface',
            isActive: true,
          });
          refreshFixtures();
        }

        setStartPoint(null);
        setIsDrawing(false);
      }
    },
    [floorPlan, isDragging, isDraggingTable, isDraggingSeat, draggedSeatId, seatDragPreview, isRotatingTable, isResizingTable, toolMode, isDrawing, startPoint, fixtureType, placementOffset, screenToFloor, onFixtureCreate, onSeatUpdate, onSeatsReflow, selectedTableId, resizeStartDimensions, useDatabase, dbTables, tables, refreshFixtures]
  );

  // Render preview for current drawing
  const renderPreview = () => {
    if (!currentPoint) return null;

    // WALL mode: Preview line from start point to current
    if (toolMode === 'WALL' && startPoint) {
      const start = startPoint;
      const end = currentPoint;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      return (
        <div
          style={{
            position: 'absolute',
            left: FloorCanvasAPI.feetToPixels(start.x),
            top: FloorCanvasAPI.feetToPixels(start.y - 0.25),
            width: FloorCanvasAPI.feetToPixels(length),
            height: FloorCanvasAPI.feetToPixels(0.5),
            backgroundColor: '#3498db',
            opacity: 0.5,
            transform: `rotate(${angle}deg)`,
            transformOrigin: 'left center',
            pointerEvents: 'none',
          }}
        />
      );
    }

    // RECTANGLE mode: Preview rectangle
    if (toolMode === 'RECTANGLE' && isDrawing && startPoint) {
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      const position = {
        x: Math.min(startPoint.x, currentPoint.x),
        y: Math.min(startPoint.y, currentPoint.y),
      };

      return (
        <div
          style={{
            position: 'absolute',
            left: FloorCanvasAPI.feetToPixels(position.x),
            top: FloorCanvasAPI.feetToPixels(position.y),
            width: FloorCanvasAPI.feetToPixels(width),
            height: FloorCanvasAPI.feetToPixels(height),
            backgroundColor: getFixtureTypeMetadata(fixtureType).defaultColor,
            opacity: 0.5,
            border: '2px dashed #3498db',
            pointerEvents: 'none',
          }}
        />
      );
    }

    return null;
  };

  // Render fixtures with selection highlight
  const renderFixtures = () => {
    return fixtures.map((fixture) => {
      const isSelected = fixture.id === selectedFixtureId;
      const baseStyle: React.CSSProperties = {
        position: 'absolute',
        backgroundColor: fixture.color,
        opacity: fixture.opacity,
        cursor: toolMode === 'SELECT' ? 'move' : toolMode === 'DELETE' ? 'pointer' : 'default',
        border: isSelected ? '2px solid #3498db' : 'none',
        boxShadow: isSelected ? '0 0 8px rgba(52, 152, 219, 0.5)' : 'none',
      };

      if (fixture.geometry.type === 'rectangle') {
        const { position, width, height, rotation } = fixture.geometry;
        return (
          <div
            key={fixture.id}
            style={{
              ...baseStyle,
              left: FloorCanvasAPI.feetToPixels(position.x),
              top: FloorCanvasAPI.feetToPixels(position.y),
              width: FloorCanvasAPI.feetToPixels(width),
              height: FloorCanvasAPI.feetToPixels(height),
              transform: `rotate(${rotation}deg)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={fixture.label}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#fff',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '90%',
                textAlign: 'center',
              }}
            >
              {fixture.label}
            </span>
          </div>
        );
      }

      if (fixture.geometry.type === 'circle') {
        const { center, radius } = fixture.geometry;
        return (
          <div
            key={fixture.id}
            style={{
              ...baseStyle,
              left: FloorCanvasAPI.feetToPixels(center.x - radius),
              top: FloorCanvasAPI.feetToPixels(center.y - radius),
              width: FloorCanvasAPI.feetToPixels(radius * 2),
              height: FloorCanvasAPI.feetToPixels(radius * 2),
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={fixture.label}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#fff',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              {fixture.label}
            </span>
          </div>
        );
      }

      if (fixture.geometry.type === 'line') {
        const { start, end } = fixture.geometry;
        const thickness = fixture.thickness || 0.5;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        return (
          <div
            key={fixture.id}
            style={{
              ...baseStyle,
              left: FloorCanvasAPI.feetToPixels(start.x),
              top: FloorCanvasAPI.feetToPixels(start.y - thickness / 2),
              width: FloorCanvasAPI.feetToPixels(length),
              height: FloorCanvasAPI.feetToPixels(thickness),
              transform: `rotate(${angle}deg)`,
              transformOrigin: 'left center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={fixture.label}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#fff',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                backgroundColor: 'rgba(0,0,0,0.3)',
                padding: '2px 6px',
                borderRadius: 3,
              }}
            >
              {fixture.label}
            </span>
          </div>
        );
      }

      return null;
    });
  };

  // Render tables
  const renderTables = () => {
    return tables.map((table) => (
      <TableRenderer
        key={table.id}
        table={table}
        isSelected={table.id === selectedTableId}
        isDragging={isDraggingTable && table.id === selectedTableId}
        isRotating={isRotatingTable && table.id === selectedTableId}
        onSelect={() => {
          if (onTableSelect) {
            onTableSelect(table.id);
          }
        }}
        onRotateStart={(e) => {
          if (!onTableSelect || !onTableUpdate) return;

          // Select this table
          onTableSelect(table.id);

          // Start rotation
          setIsRotatingTable(true);

          // Store initial rotation angle
          setRotationStartAngle(table.rotation);

          // Calculate initial mouse angle relative to table center
          const pointFeet = screenToFloor(e.clientX, e.clientY);
          const pointPx = {
            x: FloorCanvasAPI.feetToPixels(pointFeet.x),
            y: FloorCanvasAPI.feetToPixels(pointFeet.y),
          };
          const tableCenter = {
            x: table.posX + table.width / 2,
            y: table.posY + table.height / 2,
          };
          const initialMouseAngle = calculateAngle(tableCenter, pointPx);
          setRotationStartMouseAngle(initialMouseAngle);
        }}
        isResizing={isResizingTable && table.id === selectedTableId}
        onResizeStart={handleResizeStart}
      />
    ));
  };

  // Render seats
  const renderSeats = () => {
    return seats.map((seat) => {
      const table = tables.find(t => t.id === seat.tableId);
      if (!table) return null;

      const tableCenterX = table.posX + table.width / 2;
      const tableCenterY = table.posY + table.height / 2;

      // Use preview position if dragging this seat
      const seatData = (isDraggingSeat && draggedSeatId === seat.id && seatDragPreview)
        ? { ...seat, relativeX: seatDragPreview.relativeX, relativeY: seatDragPreview.relativeY }
        : seat;

      // Calculate absolute position with table rotation
      const rotation = (table.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const rotatedX = seatData.relativeX * cos - seatData.relativeY * sin;
      const rotatedY = seatData.relativeX * sin + seatData.relativeY * cos;

      const seatAbsX = tableCenterX + rotatedX;
      const seatAbsY = tableCenterY + rotatedY;

      return (
        <div
          key={seat.id}
          style={{
            position: 'absolute',
            left: seatAbsX - 10, // Center the 20px SeatRenderer
            top: seatAbsY - 10,
            width: 20,  // Match SeatRenderer's seatSize (20px)
            height: 20,
            cursor: toolMode === 'SELECT' ? 'move' : 'default',
            pointerEvents: 'auto',
          }}
        >
          <SeatRenderer
            seat={seatData}
            tableRotation={table.rotation || 0}
            isSelected={draggedSeatId === seat.id}
            isHighlighted={false}
            hasItems={false}
          />
        </div>
      );
    });
  };

  // Render grid
  const renderGrid = () => {
    if (!floorPlan) return null;

    const gridSizePx = FloorCanvasAPI.feetToPixels(floorPlan.gridSizeFeet);
    const verticalLines: number[] = [];
    const horizontalLines: number[] = [];

    for (let x = 0; x <= canvasDimensions.widthPx; x += gridSizePx) {
      verticalLines.push(x);
    }
    for (let y = 0; y <= canvasDimensions.heightPx; y += gridSizePx) {
      horizontalLines.push(y);
    }

    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasDimensions.widthPx,
          height: canvasDimensions.heightPx,
          pointerEvents: 'none',
        }}
      >
        {verticalLines.map((x) => (
          <line
            key={`v-${x}`}
            x1={x}
            y1={0}
            x2={x}
            y2={canvasDimensions.heightPx}
            stroke="#e0e0e0"
            strokeWidth={1}
          />
        ))}
        {horizontalLines.map((y) => (
          <line
            key={`h-${y}`}
            x1={0}
            y1={y}
            x2={canvasDimensions.widthPx}
            y2={y}
            stroke="#e0e0e0"
            strokeWidth={1}
          />
        ))}
      </svg>
    );
  };

  if (!floorPlan) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>
        No floor plan found. Please select a room.
      </div>
    );
  }

  return (
    <div
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'relative',
        width: canvasDimensions.widthPx,
        height: canvasDimensions.heightPx,
        backgroundColor: '#f5f5f5',
        border: '2px solid #ccc',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: toolMode === 'SELECT' ? 'default' : 'crosshair',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Grid */}
      {renderGrid()}

      {/* Fixtures */}
      {renderFixtures()}

      {/* Tables */}
      {renderTables()}

      {/* Seats */}
      {renderSeats()}

      {/* Boundary visualization when dragging a seat */}
      {isDraggingSeat && draggedSeatId && (() => {
        const seat = seats.find(s => s.id === draggedSeatId);
        const table = seat ? tables.find(t => t.id === seat.tableId) : null;
        if (!table) return null;

        const tableCenterX = table.posX + table.width / 2;
        const tableCenterY = table.posY + table.height / 2;
        const halfW = table.width / 2;
        const halfH = table.height / 2;
        const rotation = table.rotation || 0;

        // Get other seats on this table for collision zone visualization
        const otherSeats = seats.filter(s => s.tableId === table.id && s.id !== draggedSeatId);

        return (
          <>
            {/* Inner boundary - table edge (red dashed) */}
            <div
              style={{
                position: 'absolute',
                left: table.posX,
                top: table.posY,
                width: table.width,
                height: table.height,
                border: '2px dashed rgba(239, 68, 68, 0.7)',
                borderRadius: table.shape === 'round' ? '50%' : 8,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 998,
              }}
            />

            {/* Outer boundary - max drag distance (blue dashed) */}
            <div
              style={{
                position: 'absolute',
                left: table.posX - SEAT_BOUNDARY_DISTANCE,
                top: table.posY - SEAT_BOUNDARY_DISTANCE,
                width: table.width + SEAT_BOUNDARY_DISTANCE * 2,
                height: table.height + SEAT_BOUNDARY_DISTANCE * 2,
                border: '2px dashed rgba(59, 130, 246, 0.5)',
                borderRadius: table.shape === 'round' ? '50%' : 12,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 997,
              }}
            />

            {/* Valid zone - between inner and outer (green fill) */}
            <div
              style={{
                position: 'absolute',
                left: table.posX - SEAT_BOUNDARY_DISTANCE,
                top: table.posY - SEAT_BOUNDARY_DISTANCE,
                width: table.width + SEAT_BOUNDARY_DISTANCE * 2,
                height: table.height + SEAT_BOUNDARY_DISTANCE * 2,
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderRadius: table.shape === 'round' ? '50%' : 12,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 996,
              }}
            />

            {/* Collision zones around other seats (orange circles) */}
            {otherSeats.map((otherSeat) => {
              const rot = rotation * Math.PI / 180;
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);
              const rotatedX = otherSeat.relativeX * cos - otherSeat.relativeY * sin;
              const rotatedY = otherSeat.relativeX * sin + otherSeat.relativeY * cos;
              const seatAbsX = tableCenterX + rotatedX;
              const seatAbsY = tableCenterY + rotatedY;
              const collisionDiameter = SEAT_COLLISION_RADIUS * 2 + 4;

              return (
                <div
                  key={`collision-${otherSeat.id}`}
                  style={{
                    position: 'absolute',
                    left: seatAbsX - collisionDiameter / 2,
                    top: seatAbsY - collisionDiameter / 2,
                    width: collisionDiameter,
                    height: collisionDiameter,
                    border: '2px dashed rgba(249, 115, 22, 0.6)',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    pointerEvents: 'none',
                    zIndex: 999,
                  }}
                />
              );
            })}
          </>
        );
      })()}

      {/* Debug: Show all seat collision zones */}
      {showBoundaryDebug && seats.map((seat) => {
        const table = tables.find(t => t.id === seat.tableId);
        if (!table) return null;

        const tableCenterX = table.posX + table.width / 2;
        const tableCenterY = table.posY + table.height / 2;
        const rotation = (table.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const rotatedX = seat.relativeX * cos - seat.relativeY * sin;
        const rotatedY = seat.relativeX * sin + seat.relativeY * cos;
        const seatAbsX = tableCenterX + rotatedX;
        const seatAbsY = tableCenterY + rotatedY;

        return (
          <div
            key={`debug-${seat.id}`}
            style={{
              position: 'absolute',
              left: seatAbsX - SEAT_COLLISION_RADIUS,
              top: seatAbsY - SEAT_COLLISION_RADIUS,
              width: SEAT_COLLISION_RADIUS * 2,
              height: SEAT_COLLISION_RADIUS * 2,
              borderRadius: '50%',
              border: '1px dashed rgba(255, 100, 100, 0.6)',
              backgroundColor: 'rgba(255, 100, 100, 0.1)',
              pointerEvents: 'none',
              zIndex: 999,
            }}
          />
        );
      })}

      {/* Debug: Show table inner boundary (no-go zone) */}
      {showBoundaryDebug && tables.map((table) => (
        <div
          key={`debug-inner-${table.id}`}
          style={{
            position: 'absolute',
            left: table.posX,
            top: table.posY,
            width: table.width,
            height: table.height,
            border: '2px solid rgba(255, 0, 0, 0.4)',
            backgroundColor: 'rgba(255, 0, 0, 0.05)',
            transform: `rotate(${table.rotation || 0}deg)`,
            transformOrigin: 'center center',
            pointerEvents: 'none',
            zIndex: 998,
          }}
        />
      ))}

      {/* Debug mode indicator */}
      {showBoundaryDebug && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '4px 8px',
            backgroundColor: 'rgba(255, 100, 100, 0.9)',
            color: 'white',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 2000,
          }}
        >
          DEBUG: Boundaries (Ctrl+B to toggle)
        </div>
      )}

      {/* Preview */}
      {renderPreview()}

      {/* Room info */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          padding: '4px 8px',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          color: 'white',
          borderRadius: 4,
          fontSize: 12,
          pointerEvents: 'none',
        }}
      >
        {floorPlan.name} ({floorPlan.widthFeet}ft x {floorPlan.heightFeet}ft)
      </div>

      {/* Cursor position */}
      {currentPoint && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '4px 8px',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            color: 'white',
            borderRadius: 4,
            fontSize: 12,
            pointerEvents: 'none',
            fontFamily: 'monospace',
          }}
        >
          ({currentPoint.x.toFixed(1)}, {currentPoint.y.toFixed(1)})
        </div>
      )}
    </div>
  );
}

export default EditorCanvas;

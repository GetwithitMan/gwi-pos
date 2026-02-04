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
import type { EditorToolMode, FixtureType } from './types';
import { getFixtureTypeMetadata } from './types';

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
  selectedFixtureId: string | null;
  refreshKey: number;
  onFixtureSelect: (fixtureId: string | null) => void;
  onFixtureUpdate: (fixtureId: string, updates: Partial<Fixture>) => void;
  onFixtureCreate: (fixture: Omit<Fixture, 'id'>) => void;
  onFixtureDelete: (fixtureId: string) => void;
  // Database mode props
  useDatabase?: boolean;
  dbFixtures?: Fixture[];
  dbFloorPlan?: VirtualFloorPlan; // Section data for database mode
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EditorCanvas({
  roomId,
  toolMode,
  fixtureType,
  selectedFixtureId,
  refreshKey,
  onFixtureSelect,
  onFixtureUpdate,
  onFixtureCreate,
  onFixtureDelete,
  useDatabase = false,
  dbFixtures,
  dbFloorPlan,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  // In database mode, use the dbFloorPlan prop; otherwise use in-memory API
  const [floorPlan, setFloorPlan] = useState(
    useDatabase && dbFloorPlan ? dbFloorPlan : FloorCanvasAPI.getFloorPlan(roomId)
  );
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  // Drawing state
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point | null>(null);

  // Auto-offset for new fixtures to prevent stacking
  const [placementOffset, setPlacementOffset] = useState(0);

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

  // Get canvas dimensions - use floorPlan dimensions directly (works for both database and in-memory mode)
  const canvasDimensions = floorPlan
    ? {
        widthPx: FloorCanvasAPI.feetToPixels(floorPlan.widthFeet),
        heightPx: FloorCanvasAPI.feetToPixels(floorPlan.heightFeet),
      }
    : { widthPx: 800, heightPx: 600 };

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

  // Handle mouse down
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!floorPlan) return;

      const point = screenToFloor(event.clientX, event.clientY);

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

      // DELETE mode: Delete fixture
      if (toolMode === 'DELETE') {
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

      // SELECT mode: Select fixture
      if (toolMode === 'SELECT') {
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

        onFixtureSelect(clickedFixture ? clickedFixture.id : null);
      }
    },
    [
      floorPlan,
      toolMode,
      fixtureType,
      selectedFixtureId,
      startPoint,
      fixtures,
      screenToFloor,
      onFixtureSelect,
      onFixtureCreate,
      onFixtureDelete,
      refreshFixtures,
    ]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!floorPlan) return;

      const point = screenToFloor(event.clientX, event.clientY);
      setCurrentPoint(point);

      // Handle dragging
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
    [floorPlan, isDragging, selectedFixtureId, dragOffset, fixtures, screenToFloor, onFixtureUpdate, refreshFixtures]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
      if (!floorPlan) return;

      // End dragging
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
    [floorPlan, isDragging, toolMode, isDrawing, startPoint, fixtureType, screenToFloor, onFixtureCreate, refreshFixtures]
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
      }}
    >
      {/* Grid */}
      {renderGrid()}

      {/* Fixtures */}
      {renderFixtures()}

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

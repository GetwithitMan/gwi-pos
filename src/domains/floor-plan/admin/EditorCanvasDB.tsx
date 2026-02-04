'use client';

/**
 * GWI POS - Floor Plan Domain
 * Editor Canvas (Database-Backed)
 *
 * Canvas with drawing and editing interactions for floor plan elements.
 * Uses pixels per foot conversion for grid snapping.
 */

import React, { useRef, useState, useCallback } from 'react';
import type { EditorToolMode, FixtureType } from './types';
import { getFixtureTypeMetadata } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const PIXELS_PER_FOOT = 20; // 20 pixels = 1 foot

// =============================================================================
// TYPES
// =============================================================================

interface Section {
  id: string;
  name: string;
  widthFeet: number;
  heightFeet: number;
  gridSizeFeet: number;
}

interface Point {
  x: number;
  y: number;
}

interface LineGeometry {
  type: 'line';
  start: Point;
  end: Point;
}

interface RectGeometry {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CircleGeometry {
  type: 'circle';
  x: number;
  y: number;
  radius: number;
}

type Geometry = LineGeometry | RectGeometry | CircleGeometry;

interface FloorPlanElement {
  id: string;
  name: string;
  elementType: string;
  visualType: string;
  geometry: unknown; // Cast to Geometry when needed
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  thickness: number;
  fillColor: string | null;
  opacity: number;
  isLocked: boolean;
}

interface EditorCanvasDBProps {
  section: Section;
  elements: FloorPlanElement[];
  toolMode: EditorToolMode;
  fixtureType: FixtureType;
  selectedElementId: string | null;
  onElementSelect: (elementId: string | null) => void;
  onElementUpdate: (elementId: string, updates: Partial<FloorPlanElement>) => void;
  onElementCreate: (element: Partial<FloorPlanElement>) => void;
  onElementDelete: (elementId: string) => void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function feetToPixels(feet: number): number {
  return feet * PIXELS_PER_FOOT;
}

function pixelsToFeet(pixels: number): number {
  return pixels / PIXELS_PER_FOOT;
}

function snapToGrid(point: Point, gridSizeFeet: number): Point {
  return {
    x: Math.round(point.x / gridSizeFeet) * gridSizeFeet,
    y: Math.round(point.y / gridSizeFeet) * gridSizeFeet,
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EditorCanvasDB({
  section,
  elements,
  toolMode,
  fixtureType,
  selectedElementId,
  onElementSelect,
  onElementUpdate,
  onElementCreate,
  onElementDelete,
}: EditorCanvasDBProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  // Drawing state
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point | null>(null);

  // Auto-offset for new elements to prevent stacking
  const [placementOffset, setPlacementOffset] = useState(0);

  // Canvas dimensions in pixels
  const canvasWidthPx = feetToPixels(section.widthFeet);
  const canvasHeightPx = feetToPixels(section.heightFeet);

  // Convert screen position to floor position (feet)
  const screenToFloor = useCallback(
    (screenX: number, screenY: number): Point => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const rect = canvasRef.current.getBoundingClientRect();
      const x = screenX - rect.left;
      const y = screenY - rect.top;
      const position: Point = {
        x: pixelsToFeet(x),
        y: pixelsToFeet(y),
      };
      // Snap to grid
      return snapToGrid(position, section.gridSizeFeet);
    },
    [section.gridSizeFeet]
  );

  // Get element bounds in feet
  const getElementBounds = useCallback((element: FloorPlanElement) => {
    if (element.geometry) {
      const geo = element.geometry as Geometry;
      if (geo.type === 'rectangle') {
        return {
          x: geo.x,
          y: geo.y,
          width: geo.width,
          height: geo.height,
        };
      }
      if (geo.type === 'circle') {
        return {
          x: geo.x - geo.radius,
          y: geo.y - geo.radius,
          width: geo.radius * 2,
          height: geo.radius * 2,
        };
      }
      if (geo.type === 'line') {
        const thickness = element.thickness || 0.5;
        const minX = Math.min(geo.start.x, geo.end.x) - thickness;
        const maxX = Math.max(geo.start.x, geo.end.x) + thickness;
        const minY = Math.min(geo.start.y, geo.end.y) - thickness;
        const maxY = Math.max(geo.start.y, geo.end.y) + thickness;
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };
      }
    }
    // Fallback to pixel-based position (convert to feet)
    return {
      x: pixelsToFeet(element.posX),
      y: pixelsToFeet(element.posY),
      width: pixelsToFeet(element.width),
      height: pixelsToFeet(element.height),
    };
  }, []);

  // Check if point is inside element
  const isPointInElement = useCallback(
    (point: Point, element: FloorPlanElement): boolean => {
      if (element.geometry) {
        const geo = element.geometry as Geometry;
        if (geo.type === 'rectangle') {
          return (
            point.x >= geo.x &&
            point.x <= geo.x + geo.width &&
            point.y >= geo.y &&
            point.y <= geo.y + geo.height
          );
        }
        if (geo.type === 'circle') {
          const dist = Math.sqrt(Math.pow(point.x - geo.x, 2) + Math.pow(point.y - geo.y, 2));
          return dist <= geo.radius;
        }
        if (geo.type === 'line') {
          const thickness = element.thickness || 0.5;
          const bounds = getElementBounds(element);
          return (
            point.x >= bounds.x &&
            point.x <= bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y <= bounds.y + bounds.height
          );
        }
      }
      // Fallback
      const bounds = getElementBounds(element);
      return (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      );
    },
    [getElementBounds]
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      const point = screenToFloor(event.clientX, event.clientY);

      // SELECT mode: Check if clicking on an element to drag
      if (toolMode === 'SELECT' && selectedElementId) {
        const element = elements.find((e) => e.id === selectedElementId);
        if (element && !element.isLocked && isPointInElement(point, element)) {
          const bounds = getElementBounds(element);
          setIsDragging(true);
          setDragOffset({ x: point.x - bounds.x, y: point.y - bounds.y });
          return;
        }
      }

      // WALL mode: Start drawing
      if (toolMode === 'WALL') {
        if (!startPoint) {
          // Snap start point to existing wall endpoints
          let snappedStart = point;
          const snapDistance = 0.5;

          elements.forEach((el) => {
            if (el.geometry && (el.geometry as Geometry).type === 'line') {
              const geo = el.geometry as LineGeometry;
              if (Math.hypot(point.x - geo.start.x, point.y - geo.start.y) < snapDistance) {
                snappedStart = geo.start;
              }
              if (Math.hypot(point.x - geo.end.x, point.y - geo.end.y) < snapDistance) {
                snappedStart = geo.end;
              }
            }
          });

          setStartPoint(snappedStart);
        } else {
          // Snap end point to existing wall endpoints
          let snappedEnd = point;
          const snapDistance = 0.5;

          elements.forEach((el) => {
            if (el.geometry && (el.geometry as Geometry).type === 'line') {
              const geo = el.geometry as LineGeometry;
              if (Math.hypot(point.x - geo.start.x, point.y - geo.start.y) < snapDistance) {
                snappedEnd = geo.start;
              }
              if (Math.hypot(point.x - geo.end.x, point.y - geo.end.y) < snapDistance) {
                snappedEnd = geo.end;
              }
            }
          });

          // Complete the wall
          const metadata = getFixtureTypeMetadata('wall');
          onElementCreate({
            name: metadata.label,
            elementType: 'barrier',
            visualType: 'wall',
            geometry: {
              type: 'line',
              start: startPoint,
              end: snappedEnd,
            },
            thickness: metadata.defaultThickness,
            fillColor: metadata.defaultColor,
            opacity: 1,
          });
          setStartPoint(null);
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
          x: point.x + placementOffset * 0.5,
          y: point.y + placementOffset * 0.5,
        };
        setPlacementOffset((prev) => (prev + 1) % 10);

        const metadata = getFixtureTypeMetadata(fixtureType);
        onElementCreate({
          name: metadata.label,
          elementType: metadata.category === 'zone' ? 'decoration' : 'barrier',
          visualType: fixtureType,
          geometry: {
            type: 'circle',
            x: offsetCenter.x,
            y: offsetCenter.y,
            radius: 1,
          },
          fillColor: metadata.defaultColor,
          opacity: metadata.category === 'zone' ? 0.3 : 1,
        });
        return;
      }

      // DELETE mode: Delete element
      if (toolMode === 'DELETE') {
        const elementToDelete = elements.find((el) => isPointInElement(point, el));
        if (elementToDelete) {
          onElementDelete(elementToDelete.id);
        }
        return;
      }

      // SELECT mode: Select element
      if (toolMode === 'SELECT') {
        const clickedElement = elements.find((el) => isPointInElement(point, el));
        onElementSelect(clickedElement ? clickedElement.id : null);
      }
    },
    [
      toolMode,
      fixtureType,
      selectedElementId,
      startPoint,
      elements,
      placementOffset,
      screenToFloor,
      isPointInElement,
      getElementBounds,
      onElementSelect,
      onElementCreate,
      onElementDelete,
    ]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const point = screenToFloor(event.clientX, event.clientY);
      setCurrentPoint(point);

      // Handle dragging
      if (isDragging && selectedElementId && dragOffset) {
        const element = elements.find((e) => e.id === selectedElementId);
        if (element && element.geometry) {
          const geo = element.geometry as Geometry;
          const newX = point.x - dragOffset.x;
          const newY = point.y - dragOffset.y;

          if (geo.type === 'rectangle') {
            onElementUpdate(selectedElementId, {
              geometry: { ...geo, x: newX, y: newY },
            });
          } else if (geo.type === 'circle') {
            onElementUpdate(selectedElementId, {
              geometry: { ...geo, x: newX + geo.radius, y: newY + geo.radius },
            });
          }
        }
      }
    },
    [screenToFloor, isDragging, selectedElementId, dragOffset, elements, onElementUpdate]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
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
          const position = {
            x: Math.min(startPoint.x, point.x) + placementOffset * 0.5,
            y: Math.min(startPoint.y, point.y) + placementOffset * 0.5,
          };
          setPlacementOffset((prev) => (prev + 1) % 10);

          const metadata = getFixtureTypeMetadata(fixtureType);
          onElementCreate({
            name: metadata.label,
            elementType: metadata.category === 'zone' ? 'decoration' : 'barrier',
            visualType: fixtureType,
            geometry: {
              type: 'rectangle',
              x: position.x,
              y: position.y,
              width,
              height,
            },
            fillColor: metadata.defaultColor,
            opacity: metadata.category === 'zone' ? 0.3 : 1,
          });
        }

        setStartPoint(null);
        setIsDrawing(false);
      }
    },
    [isDragging, toolMode, isDrawing, startPoint, fixtureType, placementOffset, screenToFloor, onElementCreate]
  );

  // Render preview for current drawing
  const renderPreview = () => {
    if (!currentPoint) return null;

    // WALL mode: Preview line from start point to current
    if (toolMode === 'WALL' && startPoint) {
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      return (
        <div
          style={{
            position: 'absolute',
            left: feetToPixels(startPoint.x),
            top: feetToPixels(startPoint.y - 0.25),
            width: feetToPixels(length),
            height: feetToPixels(0.5),
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
            left: feetToPixels(position.x),
            top: feetToPixels(position.y),
            width: feetToPixels(width),
            height: feetToPixels(height),
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

  // Render elements
  const renderElements = () => {
    return elements.map((element) => {
      const isSelected = element.id === selectedElementId;
      const baseStyle: React.CSSProperties = {
        position: 'absolute',
        backgroundColor: element.fillColor || '#888',
        opacity: element.opacity,
        cursor: toolMode === 'SELECT' ? (element.isLocked ? 'not-allowed' : 'move') : toolMode === 'DELETE' ? 'pointer' : 'default',
        border: isSelected ? '2px solid #3498db' : 'none',
        boxShadow: isSelected ? '0 0 8px rgba(52, 152, 219, 0.5)' : 'none',
      };

      if (element.geometry) {
        const geo = element.geometry as Geometry;

        if (geo.type === 'rectangle') {
          return (
            <div
              key={element.id}
              style={{
                ...baseStyle,
                left: feetToPixels(geo.x),
                top: feetToPixels(geo.y),
                width: feetToPixels(geo.width),
                height: feetToPixels(geo.height),
                transform: `rotate(${element.rotation}deg)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={element.name}
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
                {element.name}
              </span>
            </div>
          );
        }

        if (geo.type === 'circle') {
          return (
            <div
              key={element.id}
              style={{
                ...baseStyle,
                left: feetToPixels(geo.x - geo.radius),
                top: feetToPixels(geo.y - geo.radius),
                width: feetToPixels(geo.radius * 2),
                height: feetToPixels(geo.radius * 2),
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={element.name}
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
                {element.name}
              </span>
            </div>
          );
        }

        if (geo.type === 'line') {
          const thickness = element.thickness || 0.5;
          const dx = geo.end.x - geo.start.x;
          const dy = geo.end.y - geo.start.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);

          return (
            <div
              key={element.id}
              style={{
                ...baseStyle,
                left: feetToPixels(geo.start.x),
                top: feetToPixels(geo.start.y - thickness / 2),
                width: feetToPixels(length),
                height: feetToPixels(thickness),
                transform: `rotate(${angle}deg)`,
                transformOrigin: 'left center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={element.name}
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
                {element.name}
              </span>
            </div>
          );
        }
      }

      // Fallback: use pixel-based positioning
      return (
        <div
          key={element.id}
          style={{
            ...baseStyle,
            left: element.posX,
            top: element.posY,
            width: element.width,
            height: element.height,
            transform: `rotate(${element.rotation}deg)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={element.name}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#fff',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}
          >
            {element.name}
          </span>
        </div>
      );
    });
  };

  // Render grid
  const renderGrid = () => {
    const gridSizePx = feetToPixels(section.gridSizeFeet);
    const verticalLines: number[] = [];
    const horizontalLines: number[] = [];

    for (let x = 0; x <= canvasWidthPx; x += gridSizePx) {
      verticalLines.push(x);
    }
    for (let y = 0; y <= canvasHeightPx; y += gridSizePx) {
      horizontalLines.push(y);
    }

    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: canvasWidthPx,
          height: canvasHeightPx,
          pointerEvents: 'none',
        }}
      >
        {verticalLines.map((x) => (
          <line
            key={`v-${x}`}
            x1={x}
            y1={0}
            x2={x}
            y2={canvasHeightPx}
            stroke="#e0e0e0"
            strokeWidth={1}
          />
        ))}
        {horizontalLines.map((y) => (
          <line
            key={`h-${y}`}
            x1={0}
            y1={y}
            x2={canvasWidthPx}
            y2={y}
            stroke="#e0e0e0"
            strokeWidth={1}
          />
        ))}
      </svg>
    );
  };

  return (
    <div
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'relative',
        width: canvasWidthPx,
        height: canvasHeightPx,
        backgroundColor: '#f5f5f5',
        border: '2px solid #ccc',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: toolMode === 'SELECT' ? 'default' : 'crosshair',
      }}
    >
      {/* Grid */}
      {renderGrid()}

      {/* Elements */}
      {renderElements()}

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
        {section.name} ({section.widthFeet}ft x {section.heightFeet}ft)
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

export default EditorCanvasDB;

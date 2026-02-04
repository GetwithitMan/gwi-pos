'use client';

/**
 * GWI POS - Floor Plan Domain
 * Layer 1: Floor Canvas Component
 *
 * Renders the floor plan canvas with rooms and fixtures.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FloorCanvasAPI } from './floorCanvasAPI';
import type { FloorPlan, Fixture, Point } from '../shared/types';

// =============================================================================
// TYPES
// =============================================================================

interface FloorCanvasProps {
  roomId?: string;
  width?: number;
  height?: number;
  showGrid?: boolean;
  showFixtures?: boolean;
  onPositionClick?: (position: Point) => void;
  onFixtureClick?: (fixture: Fixture) => void;
  children?: React.ReactNode;
}

// =============================================================================
// FIXTURE RENDERER
// =============================================================================

interface FixtureRendererProps {
  fixture: Fixture;
  onClick?: (fixture: Fixture) => void;
}

function FixtureRenderer({ fixture, onClick }: FixtureRendererProps) {
  const handleClick = () => {
    if (onClick) onClick(fixture);
  };

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: fixture.color,
    opacity: fixture.opacity,
    cursor: onClick ? 'pointer' : 'default',
  };

  // Render based on geometry type
  if (fixture.geometry.type === 'rectangle') {
    const { position, width, height, rotation } = fixture.geometry;
    return (
      <div
        onClick={handleClick}
        style={{
          ...baseStyle,
          left: FloorCanvasAPI.feetToPixels(position.x),
          top: FloorCanvasAPI.feetToPixels(position.y),
          width: FloorCanvasAPI.feetToPixels(width),
          height: FloorCanvasAPI.feetToPixels(height),
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
        onClick={handleClick}
        style={{
          ...baseStyle,
          left: FloorCanvasAPI.feetToPixels(center.x - radius),
          top: FloorCanvasAPI.feetToPixels(center.y - radius),
          width: FloorCanvasAPI.feetToPixels(diameter),
          height: FloorCanvasAPI.feetToPixels(diameter),
          borderRadius: '50%',
        }}
        title={fixture.label}
      />
    );
  }

  if (fixture.geometry.type === 'line') {
    const { start, end } = fixture.geometry;
    const thickness = fixture.thickness || 0.5;

    // Calculate line dimensions
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return (
      <div
        onClick={handleClick}
        style={{
          ...baseStyle,
          left: FloorCanvasAPI.feetToPixels(start.x),
          top: FloorCanvasAPI.feetToPixels(start.y - thickness / 2),
          width: FloorCanvasAPI.feetToPixels(length),
          height: FloorCanvasAPI.feetToPixels(thickness),
          transform: `rotate(${angle}deg)`,
          transformOrigin: 'left center',
        }}
        title={fixture.label}
      />
    );
  }

  // Polygon rendering (simplified - just show bounding box)
  if (fixture.geometry.type === 'polygon') {
    const { points } = fixture.geometry;
    if (points.length < 3) return null;

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));

    // Create SVG path for polygon
    const pathD = points
      .map((p, i) => {
        const px = FloorCanvasAPI.feetToPixels(p.x - minX);
        const py = FloorCanvasAPI.feetToPixels(p.y - minY);
        return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
      })
      .join(' ') + ' Z';

    return (
      <svg
        onClick={handleClick}
        style={{
          position: 'absolute',
          left: FloorCanvasAPI.feetToPixels(minX),
          top: FloorCanvasAPI.feetToPixels(minY),
          width: FloorCanvasAPI.feetToPixels(maxX - minX),
          height: FloorCanvasAPI.feetToPixels(maxY - minY),
          overflow: 'visible',
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <title>{fixture.label}</title>
        <path
          d={pathD}
          fill={fixture.color}
          fillOpacity={fixture.opacity}
          stroke="none"
        />
      </svg>
    );
  }

  return null;
}

// =============================================================================
// GRID RENDERER
// =============================================================================

interface GridRendererProps {
  widthPx: number;
  heightPx: number;
  gridSizeFeet: number;
}

function GridRenderer({ widthPx, heightPx, gridSizeFeet }: GridRendererProps) {
  const gridSizePx = FloorCanvasAPI.feetToPixels(gridSizeFeet);

  // Generate grid lines
  const verticalLines: number[] = [];
  const horizontalLines: number[] = [];

  for (let x = 0; x <= widthPx; x += gridSizePx) {
    verticalLines.push(x);
  }
  for (let y = 0; y <= heightPx; y += gridSizePx) {
    horizontalLines.push(y);
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: widthPx,
        height: heightPx,
        pointerEvents: 'none',
      }}
    >
      {/* Grid lines */}
      {verticalLines.map((x) => (
        <line
          key={`v-${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={heightPx}
          stroke="#e0e0e0"
          strokeWidth={1}
        />
      ))}
      {horizontalLines.map((y) => (
        <line
          key={`h-${y}`}
          x1={0}
          y1={y}
          x2={widthPx}
          y2={y}
          stroke="#e0e0e0"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

// =============================================================================
// FLOOR CANVAS COMPONENT
// =============================================================================

export function FloorCanvas({
  roomId,
  width,
  height,
  showGrid = true,
  showFixtures = true,
  onPositionClick,
  onFixtureClick,
  children,
}: FloorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  // Load floor plan data
  useEffect(() => {
    const fp = FloorCanvasAPI.getFloorPlan(roomId);
    setFloorPlan(fp);

    if (fp) {
      const fixtureList = FloorCanvasAPI.getFixtures(fp.id);
      setFixtures(fixtureList);
    }
  }, [roomId]);

  // Calculate canvas dimensions
  const canvasDimensions = floorPlan
    ? FloorCanvasAPI.getCanvasDimensions(floorPlan.id)
    : { widthPx: width ?? 800, heightPx: height ?? 600 };

  // Handle click on canvas
  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onPositionClick || !floorPlan) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Convert to feet
      const position: Point = {
        x: FloorCanvasAPI.pixelsToFeet(clickX),
        y: FloorCanvasAPI.pixelsToFeet(clickY),
      };

      // Snap to grid if grid is enabled
      if (showGrid) {
        const snapped = FloorCanvasAPI.snapToGrid(position, floorPlan.gridSizeFeet);
        onPositionClick(snapped);
      } else {
        onPositionClick(position);
      }
    },
    [onPositionClick, floorPlan, showGrid]
  );

  return (
    <div
      ref={containerRef}
      onClick={handleCanvasClick}
      style={{
        position: 'relative',
        width: canvasDimensions.widthPx,
        height: canvasDimensions.heightPx,
        backgroundColor: '#f5f5f5',
        border: '2px solid #ccc',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: onPositionClick ? 'crosshair' : 'default',
      }}
    >
      {/* Grid layer */}
      {showGrid && floorPlan && (
        <GridRenderer
          widthPx={canvasDimensions.widthPx}
          heightPx={canvasDimensions.heightPx}
          gridSizeFeet={floorPlan.gridSizeFeet}
        />
      )}

      {/* Fixtures layer */}
      {showFixtures &&
        fixtures.map((fixture) => (
          <FixtureRenderer
            key={fixture.id}
            fixture={fixture}
            onClick={onFixtureClick}
          />
        ))}

      {/* Children (tables, seats, etc. from other layers) */}
      {children}

      {/* Room info overlay */}
      {floorPlan && (
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
      )}
    </div>
  );
}

// =============================================================================
// ROOM SELECTOR COMPONENT
// =============================================================================

interface RoomSelectorProps {
  selectedRoomId?: string;
  onRoomSelect: (roomId: string) => void;
}

export function RoomSelector({ selectedRoomId, onRoomSelect }: RoomSelectorProps) {
  const [rooms, setRooms] = useState<FloorPlan[]>([]);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    setRooms(FloorCanvasAPI.getAllRooms());
  }, []);

  const handleAddRoom = () => {
    // TODO: Implement room creation via FloorCanvasAPI
    alert('Add Room feature coming soon!\nThis will create a new room in the floor plan.');
  };

  const handleStartRename = (room: FloorPlan, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingRoomId(room.id);
    setEditingName(room.name);
  };

  const handleRenameSubmit = (roomId: string) => {
    if (editingName.trim()) {
      // TODO: Implement room rename via FloorCanvasAPI
      alert(`Rename feature coming soon!\nWould rename room to: ${editingName}`);
    }
    setEditingRoomId(null);
    setEditingName('');
  };

  const handleDeleteRoom = (room: FloorPlan, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm(`Delete room "${room.name}"?\n\nThis will remove all fixtures in this room.`)) {
      // TODO: Implement room deletion via FloorCanvasAPI
      alert('Delete Room feature coming soon!');
    }
  };

  if (rooms.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        marginBottom: 16,
        alignItems: 'center',
      }}
    >
      {rooms.map((room) => (
        <div
          key={room.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {editingRoomId === room.id ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => handleRenameSubmit(room.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit(room.id);
                if (e.key === 'Escape') {
                  setEditingRoomId(null);
                  setEditingName('');
                }
              }}
              autoFocus
              style={{
                minWidth: 120,
                padding: '8px 16px',
                borderRadius: 8,
                border: '2px solid #3498db',
                fontSize: 14,
              }}
            />
          ) : (
            <button
              onClick={() => onRoomSelect(room.id)}
              onDoubleClick={(e) => handleStartRename(room, e)}
              style={{
                minWidth: 120,
                padding: '8px 16px',
                borderRadius: 8,
                border: selectedRoomId === room.id ? '2px solid #3498db' : '1px solid #ccc',
                backgroundColor: selectedRoomId === room.id ? '#e3f2fd' : 'white',
                cursor: 'pointer',
                fontWeight: selectedRoomId === room.id ? 600 : 400,
                fontSize: 14,
              }}
            >
              {room.name}
            </button>
          )}
          {rooms.length > 1 && selectedRoomId === room.id && (
            <button
              onClick={(e) => handleDeleteRoom(room, e)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #f44336',
                backgroundColor: 'white',
                color: '#f44336',
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="Delete room"
            >
              🗑
            </button>
          )}
        </div>
      ))}
      <button
        onClick={handleAddRoom}
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          border: '2px dashed #3498db',
          backgroundColor: 'white',
          color: '#3498db',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        + Add Room
      </button>
    </div>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export default FloorCanvas;

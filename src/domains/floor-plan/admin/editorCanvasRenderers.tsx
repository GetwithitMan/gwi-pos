/**
 * GWI POS - Floor Plan Domain
 * Editor Canvas Render Helpers
 *
 * Extracted from EditorCanvas.tsx. JSX-returning functions for rendering
 * fixtures, tables, seats, entertainment elements, and drawing previews.
 */

import React from 'react';
import { FloorCanvasAPI } from '../canvas';
import type { Fixture, Point } from '../shared/types';
import type { EditorToolMode, FixtureType, EditorTable, EditorSeat } from './types';
import { getFixtureTypeMetadata } from './types';
import { TableRenderer, type ResizeHandle } from './TableRenderer';
import { SeatRenderer } from './SeatRenderer';
import { EntertainmentVisual, type EntertainmentVisualType } from '@/components/floor-plan/entertainment-visuals';
import { FixtureResizeHandles } from './components/FixtureResizeHandles';

// =============================================================================
// RENDER FIXTURES
// =============================================================================

export interface RenderFixturesProps {
  fixtures: Fixture[];
  selectedFixtureId: string | null;
  toolMode: EditorToolMode;
  handleFixtureResizeStart: (e: React.MouseEvent, fixtureId: string, handle: string) => void;
}

export function renderFixtures({
  fixtures,
  selectedFixtureId,
  toolMode,
  handleFixtureResizeStart,
}: RenderFixturesProps): React.ReactNode[] {
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
      const widthPx = FloorCanvasAPI.feetToPixels(width);
      const heightPx = FloorCanvasAPI.feetToPixels(height);

      return (
        <div
          key={fixture.id}
          style={{
            ...baseStyle,
            left: FloorCanvasAPI.feetToPixels(position.x),
            top: FloorCanvasAPI.feetToPixels(position.y),
            width: widthPx,
            height: heightPx,
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

          {/* Resize handles */}
          <FixtureResizeHandles
            fixtureId={fixture.id}
            toolMode={toolMode}
            isSelected={isSelected}
            onResizeStart={handleFixtureResizeStart}
          />
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

          {/* Resize handles for line endpoints */}
          {isSelected && toolMode === 'SELECT' && (
            <>
              <div
                className="resize-handle start"
                onMouseDown={(e) => handleFixtureResizeStart(e, fixture.id, 'start')}
                style={{
                  position: 'absolute',
                  left: -4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 8,
                  height: 8,
                  background: 'white',
                  border: '1px solid #3498db',
                  cursor: 'ew-resize',
                  zIndex: 10,
                  borderRadius: '50%',
                }}
              />
              <div
                className="resize-handle end"
                onMouseDown={(e) => handleFixtureResizeStart(e, fixture.id, 'end')}
                style={{
                  position: 'absolute',
                  right: -4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 8,
                  height: 8,
                  background: 'white',
                  border: '1px solid #3498db',
                  cursor: 'ew-resize',
                  zIndex: 10,
                  borderRadius: '50%',
                }}
              />
            </>
          )}
        </div>
      );
    }

    return null;
  });
}

// =============================================================================
// RENDER ENTERTAINMENT ELEMENTS
// =============================================================================

export interface RenderEntertainmentElementsProps {
  fixtures: Fixture[];
  selectedFixtureId: string | null;
  toolMode: EditorToolMode;
  handleFixtureResizeStart: (e: React.MouseEvent, fixtureId: string, handle: string) => void;
}

export function renderEntertainmentElements({
  fixtures,
  selectedFixtureId,
  toolMode,
  handleFixtureResizeStart,
}: RenderEntertainmentElementsProps): React.ReactNode[] {
  // Filter entertainment from fixtures (they come from dbElements via props)
  const entertainmentFixtures = fixtures.filter(f =>
    (f as any).elementType === 'entertainment'
  );

  return entertainmentFixtures.map((fixture) => {
    const isSelected = fixture.id === selectedFixtureId;
    const visualType = ((fixture as any).visualType || 'game_table') as EntertainmentVisualType;

    // Get position from fixture geometry or direct props
    const geo = fixture.geometry as { type: string; position?: { x: number; y: number }; width?: number; height?: number } | undefined;
    const posX = geo?.position?.x ?? (fixture as any).x ?? 0;
    const posY = geo?.position?.y ?? (fixture as any).y ?? 0;
    const width = geo?.width ?? (fixture as any).width ?? 5;
    const height = geo?.height ?? (fixture as any).height ?? 3;
    const rotation = (fixture as any).rotation ?? 0;

    const pixelX = FloorCanvasAPI.feetToPixels(posX);
    const pixelY = FloorCanvasAPI.feetToPixels(posY);
    const pixelWidth = FloorCanvasAPI.feetToPixels(width);
    const pixelHeight = FloorCanvasAPI.feetToPixels(height);

    return (
      <div
        key={fixture.id}
        style={{
          position: 'absolute',
          left: pixelX,
          top: pixelY,
          width: pixelWidth,
          height: pixelHeight,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
          cursor: toolMode === 'SELECT' ? 'move' : toolMode === 'DELETE' ? 'pointer' : 'default',
          zIndex: isSelected ? 100 : 10,
          border: isSelected ? '2px solid #9333ea' : 'none',
          boxShadow: isSelected ? '0 0 12px rgba(147, 51, 234, 0.5)' : 'none',
          borderRadius: 8,
        }}
      >
        {/* SVG Visual */}
        <EntertainmentVisual
          visualType={visualType}
          status="available"
          width={pixelWidth}
          height={pixelHeight}
        />

        {/* Label below */}
        <div style={{
          position: 'absolute',
          bottom: -20,
          left: '50%',
          transform: `translateX(-50%) rotate(-${rotation}deg)`,
          backgroundColor: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          {fixture.label || (fixture as any).name}
        </div>

        {/* Resize handles when selected */}
        <FixtureResizeHandles
          fixtureId={fixture.id}
          toolMode={toolMode}
          isSelected={isSelected}
          onResizeStart={handleFixtureResizeStart}
          color="#9333ea"
          cornersOnly
        />
      </div>
    );
  });
}

// =============================================================================
// RENDER TABLES
// =============================================================================

export interface RenderTablesProps {
  tables: EditorTable[];
  selectedTableId: string | null;
  isDraggingTable: boolean;
  isRotatingTable: boolean;
  isResizingTable: boolean;
  onTableSelect?: (tableId: string | null) => void;
  onRotateStart: (e: React.MouseEvent, table: EditorTable) => void;
  onResizeStart: (handle: ResizeHandle) => void;
}

export function renderTables({
  tables,
  selectedTableId,
  isDraggingTable,
  isRotatingTable,
  isResizingTable,
  onTableSelect,
  onRotateStart,
  onResizeStart,
}: RenderTablesProps): React.ReactNode[] {
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
      onRotateStart={(e) => onRotateStart(e, table)}
      isResizing={isResizingTable && table.id === selectedTableId}
      onResizeStart={onResizeStart}
    />
  ));
}

// =============================================================================
// RENDER SEATS
// =============================================================================

export interface RenderSeatsProps {
  seats: EditorSeat[];
  tables: EditorTable[];
  toolMode: EditorToolMode;
  isDraggingSeat: boolean;
  draggedSeatId: string | null;
  seatDragPreview: { id: string; relativeX: number; relativeY: number } | null;
}

export function renderSeats({
  seats,
  tables,
  toolMode,
  isDraggingSeat,
  draggedSeatId,
  seatDragPreview,
}: RenderSeatsProps): React.ReactNode[] {
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
}

// =============================================================================
// RENDER PREVIEW
// =============================================================================

export interface RenderPreviewProps {
  currentPoint: Point | null;
  toolMode: EditorToolMode;
  startPoint: Point | null;
  isDrawing: boolean;
  fixtureType: FixtureType;
}

export function renderPreview({
  currentPoint,
  toolMode,
  startPoint,
  isDrawing,
  fixtureType,
}: RenderPreviewProps): React.ReactNode | null {
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
}

'use client';

/**
 * GWI POS - Floor Plan Domain
 * Table Renderer Component
 *
 * Renders tables in the Floor Plan Editor canvas with seats and selection state.
 */

import React from 'react';
import { FloorCanvasAPI } from '../canvas';
import type { EditorTable, EditorSeat, TableShape } from './types';
import { SeatRenderer } from './SeatRenderer';

// =============================================================================
// TYPES
// =============================================================================

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface TableRendererProps {
  table: EditorTable;
  isSelected: boolean;
  onSelect: () => void;
  isDragging?: boolean;
  isRotating?: boolean;
  isResizing?: boolean;
  // Seat interaction
  selectedSeatId?: string | null;
  highlightedSeatId?: string | null;
  onSeatClick?: (seatId: string) => void;
  onSeatDoubleClick?: (seatId: string) => void;
  // Seat state (optional - for visual indicators)
  seatsWithItems?: Set<string>; // Set of seat IDs that have order items
  // Rotation interaction
  onRotateStart?: (e: React.MouseEvent) => void;
  // Resize interaction
  onResizeStart?: (handle: ResizeHandle) => void;
}

// =============================================================================
// TABLE SHAPE RENDERERS
// =============================================================================

function RoundTableShape({
  width,
  height,
  color,
  isSelected,
}: {
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: '50%',
        backgroundColor: color,
        border: isSelected ? '3px solid #3498db' : '2px solid #795548',
        boxShadow: isSelected ? '0 0 12px rgba(52, 152, 219, 0.6)' : '0 2px 4px rgba(0,0,0,0.2)',
      }}
    />
  );
}

function RectangleTableShape({
  width,
  height,
  color,
  isSelected,
  borderRadius = 4,
}: {
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
  borderRadius?: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: color,
        border: isSelected ? '3px solid #3498db' : '2px solid #795548',
        boxShadow: isSelected ? '0 0 12px rgba(52, 152, 219, 0.6)' : '0 2px 4px rgba(0,0,0,0.2)',
      }}
    />
  );
}

function OvalTableShape({
  width,
  height,
  color,
  isSelected,
}: {
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: '50%',
        backgroundColor: color,
        border: isSelected ? '3px solid #3498db' : '2px solid #795548',
        boxShadow: isSelected ? '0 0 12px rgba(52, 152, 219, 0.6)' : '0 2px 4px rgba(0,0,0,0.2)',
      }}
    />
  );
}

function BoothTableShape({
  width,
  height,
  color,
  isSelected,
}: {
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
}) {
  const boothBackHeight = 8;
  return (
    <div style={{ position: 'relative', width, height }}>
      {/* Booth back */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: boothBackHeight,
          backgroundColor: '#5D4037',
          borderRadius: '4px 4px 0 0',
        }}
      />
      {/* Table surface */}
      <div
        style={{
          position: 'absolute',
          top: boothBackHeight,
          left: 10,
          width: width - 20,
          height: height - boothBackHeight - 4,
          borderRadius: 4,
          backgroundColor: color,
          border: isSelected ? '3px solid #3498db' : '2px solid #795548',
          boxShadow: isSelected ? '0 0 12px rgba(52, 152, 219, 0.6)' : '0 2px 4px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  );
}

function BarSectionShape({
  width,
  height,
  color,
  isSelected,
}: {
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 2,
        backgroundColor: color,
        border: isSelected ? '3px solid #3498db' : '2px solid #5D4037',
        boxShadow: isSelected ? '0 0 12px rgba(52, 152, 219, 0.6)' : '0 2px 4px rgba(0,0,0,0.2)',
      }}
    />
  );
}

// =============================================================================
// RESIZE HANDLES
// =============================================================================

interface ResizeHandlesProps {
  width: number;
  height: number;
  onResizeStart: (handle: ResizeHandle) => void;
}

function ResizeHandles({ width, height, onResizeStart }: ResizeHandlesProps) {
  const handleSize = 10;
  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    width: handleSize,
    height: handleSize,
    backgroundColor: 'white',
    border: '2px solid #3498db',
    borderRadius: 2,
    zIndex: 1000,
  };

  const handles: { handle: ResizeHandle; style: React.CSSProperties; cursor: string }[] = [
    // Corners
    { handle: 'nw', style: { top: -handleSize / 2, left: -handleSize / 2 }, cursor: 'nwse-resize' },
    { handle: 'ne', style: { top: -handleSize / 2, right: -handleSize / 2 }, cursor: 'nesw-resize' },
    { handle: 'sw', style: { bottom: -handleSize / 2, left: -handleSize / 2 }, cursor: 'nesw-resize' },
    { handle: 'se', style: { bottom: -handleSize / 2, right: -handleSize / 2 }, cursor: 'nwse-resize' },
    // Edges
    { handle: 'n', style: { top: -handleSize / 2, left: '50%', transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { handle: 's', style: { bottom: -handleSize / 2, left: '50%', transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { handle: 'w', style: { left: -handleSize / 2, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
    { handle: 'e', style: { right: -handleSize / 2, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
  ];

  return (
    <>
      {handles.map(({ handle, style, cursor }) => (
        <div
          key={handle}
          style={{ ...handleStyle, ...style, cursor }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(handle);
          }}
          title={`Resize ${handle.toUpperCase()}`}
        />
      ))}
    </>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TableRenderer({
  table,
  isSelected,
  onSelect,
  isDragging = false,
  isRotating = false,
  isResizing = false,
  selectedSeatId = null,
  highlightedSeatId = null,
  onSeatClick,
  onSeatDoubleClick,
  seatsWithItems = new Set(),
  onRotateStart,
  onResizeStart,
}: TableRendererProps) {
  // Get table color based on status
  const getTableColor = () => {
    switch (table.status) {
      case 'occupied':
        return '#BBDEFB'; // Light blue
      case 'reserved':
        return '#F0E6FF'; // Light purple
      case 'dirty':
        return '#D7CCC8'; // Light brown
      case 'blocked':
        return '#9E9E9E'; // Grey
      default:
        return '#8D6E63'; // Default wood color
    }
  };

  const color = getTableColor();

  // Render the appropriate shape
  const renderShape = () => {
    const shapeProps = {
      width: table.width,
      height: table.height,
      color,
      isSelected,
    };

    switch (table.shape) {
      case 'round':
        return <RoundTableShape {...shapeProps} />;
      case 'oval':
        return <OvalTableShape {...shapeProps} />;
      case 'booth':
        return <BoothTableShape {...shapeProps} />;
      case 'bar':
        return <BarSectionShape {...shapeProps} />;
      case 'square':
        return <RectangleTableShape {...shapeProps} borderRadius={4} />;
      case 'rectangle':
      default:
        return <RectangleTableShape {...shapeProps} borderRadius={4} />;
    }
  };

  // Calculate table center (for seat positioning)
  const tableCenterX = table.posX + table.width / 2;
  const tableCenterY = table.posY + table.height / 2;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        position: 'absolute',
        left: table.posX,
        top: table.posY,
        width: table.width,
        height: table.height,
        cursor: isDragging ? 'grabbing' : 'grab',
        transform: `rotate(${table.rotation}deg)`,
        transformOrigin: 'center center',
        opacity: isDragging ? 0.7 : 1,
        transition: isDragging ? 'none' : 'transform 0.1s ease',
        zIndex: isSelected ? 100 : 10,
      }}
      title={`${table.name} (${table.capacity} seats)`}
    >
      {/* Table shape */}
      {renderShape()}

      {/* Table label */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) rotate(-${table.rotation}deg)`,
          fontSize: 14,
          fontWeight: 700,
          color: '#fff',
          textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {table.abbreviation || table.name}
      </div>

      {/* Capacity badge - positioned inside table */}
      <div
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 18,
          height: 18,
          borderRadius: '50%',
          backgroundColor: 'rgba(76, 175, 80, 0.9)',
          color: 'white',
          fontSize: 11,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `rotate(-${table.rotation}deg)`,
          pointerEvents: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      >
        {table.capacity}
      </div>

      {/* Locked indicator */}
      {table.isLocked && (
        <div
          style={{
            position: 'absolute',
            top: -8,
            left: -8,
            width: 18,
            height: 18,
            borderRadius: '50%',
            backgroundColor: '#F44336',
            color: 'white',
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `rotate(-${table.rotation}deg)`,
            pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
          title="Locked - Cannot be moved"
        >
          🔒
        </div>
      )}

      {/* Rotation handle (when selected) */}
      {isSelected && onRotateStart && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            onRotateStart(e);
          }}
          style={{
            position: 'absolute',
            top: -40,
            left: '50%',
            transform: `translateX(-50%) rotate(-${table.rotation}deg)`,
            transformOrigin: 'center bottom',
            cursor: isRotating ? 'grabbing' : 'grab',
            pointerEvents: 'auto',
            zIndex: 1000,
          }}
          title="Drag to rotate table (hold Shift to snap to 15°)"
        >
          {/* Stem line */}
          <div
            style={{
              width: 2,
              height: 30,
              backgroundColor: '#3498db',
              margin: '0 auto',
              pointerEvents: 'none',
            }}
          />
          {/* Handle circle */}
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: 'white',
              border: '2px solid #3498db',
              margin: '0 auto',
              cursor: isRotating ? 'grabbing' : 'grab',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }}
          />
        </div>
      )}

      {/* Seats (rendered relative to table center) */}
      {table.seats?.map((seat) => {
        // Seat positions are relative to table center
        // Position absolute within the table container
        const seatCenterX = table.width / 2 + seat.relativeX;
        const seatCenterY = table.height / 2 + seat.relativeY;
        const seatSize = 20;

        return (
          <div
            key={seat.id}
            style={{
              position: 'absolute',
              left: seatCenterX - seatSize / 2,
              top: seatCenterY - seatSize / 2,
            }}
          >
            <SeatRenderer
              seat={seat}
              tableRotation={table.rotation}
              isSelected={selectedSeatId === seat.id}
              isHighlighted={highlightedSeatId === seat.id}
              hasItems={seatsWithItems.has(seat.id)}
              onClick={() => onSeatClick?.(seat.id)}
              onDoubleClick={() => onSeatDoubleClick?.(seat.id)}
            />
          </div>
        );
      })}

      {/* Resize handles (only when selected and not rotating) */}
      {isSelected && !isRotating && onResizeStart && (
        <ResizeHandles
          width={table.width}
          height={table.height}
          onResizeStart={onResizeStart}
        />
      )}
    </div>
  );
}

export default TableRenderer;

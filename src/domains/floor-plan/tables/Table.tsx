/**
 * GWI POS - Floor Plan Domain
 * Layer 2: Table Component
 *
 * Renders a dining table object with correct shape (square, round, rectangle, etc.)
 */

'use client';

import React from 'react';
import type { Table as TableType, TableShape } from '../shared/types';

interface TableProps {
  table: TableType;
  pixelsPerFoot: number;
  isSelected?: boolean;
  onSelect?: (tableId: string) => void;
  onDragStart?: (tableId: string, event: React.PointerEvent) => void;
}

/**
 * Get the shape SVG path or element based on table shape
 */
function getShapePath(shape: TableShape, width: number, height: number): React.ReactElement {
  switch (shape) {
    case 'circle':
      return (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={width / 2}
          ry={height / 2}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2"
        />
      );

    case 'square':
    case 'rectangle':
    default:
      return (
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="4"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2"
        />
      );
  }
}

/**
 * Table Component
 * Renders a table with the specified shape, position, and rotation
 */
export function Table({ table, pixelsPerFoot, isSelected, onSelect, onDragStart }: TableProps) {
  const widthPx = table.width * pixelsPerFoot;
  const heightPx = table.height * pixelsPerFoot;
  const xPx = table.positionX * pixelsPerFoot;
  const yPx = table.positionY * pixelsPerFoot;

  // Determine color
  const color = table.color || '#8B7355'; // Default brown table color

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(table.id);
    }
    if (onDragStart) {
      onDragStart(table.id, e);
    }
  };

  return (
    <g
      style={{
        transform: `translate(${xPx}px, ${yPx}px) rotate(${table.rotation}deg)`,
        transformOrigin: `${widthPx / 2}px ${heightPx / 2}px`,
        cursor: 'move',
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Table shape */}
      <g
        style={{
          color: color,
          opacity: isSelected ? 0.9 : 0.8,
          filter: isSelected ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.8))' : undefined,
        }}
      >
        {getShapePath(table.shape, widthPx, heightPx)}
      </g>

      {/* Table label */}
      <text
        x={widthPx / 2}
        y={heightPx / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize="14"
        fontWeight="bold"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {table.label}
      </text>

      {/* Capacity indicator (small badge) */}
      {table.defaultCapacity > 0 && (
        <text
          x={widthPx - 8}
          y={heightPx - 8}
          textAnchor="end"
          dominantBaseline="auto"
          fill="white"
          fontSize="10"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {table.defaultCapacity}
        </text>
      )}
    </g>
  );
}

export default Table;

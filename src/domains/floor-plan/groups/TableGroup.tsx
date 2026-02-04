/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - TableGroup Component
 *
 * Renders visual indicators for grouped tables
 */

'use client';

import React from 'react';
import { TableGroup as TableGroupType, Table } from '../shared/types';

interface TableGroupProps {
  group: TableGroupType;
  tables: Table[];
  scale?: number; // Pixels per foot
}

/**
 * TableGroup Component
 *
 * Renders:
 * - Colored border around grouped tables
 * - Group identifier badge
 * - Dashed border for virtual groups
 */
export function TableGroup({ group, tables, scale = 20 }: TableGroupProps) {
  // Filter tables that belong to this group
  const groupTables = tables.filter((t) => group.tableIds.includes(t.id));

  if (groupTables.length === 0) {
    return null;
  }

  // Calculate bounding box for all tables in group
  const bounds = calculateBoundingBox(groupTables);

  // Convert feet to pixels
  const x = bounds.minX * scale;
  const y = bounds.minY * scale;
  const width = (bounds.maxX - bounds.minX) * scale;
  const height = (bounds.maxY - bounds.minY) * scale;

  // Border style
  const borderStyle = group.isVirtual ? 'dashed' : 'solid';
  const borderWidth = 3;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${x - borderWidth * 2}px`,
        top: `${y - borderWidth * 2}px`,
        width: `${width + borderWidth * 4}px`,
        height: `${height + borderWidth * 4}px`,
        border: `${borderWidth}px ${borderStyle} ${group.color}`,
        borderRadius: '8px',
        zIndex: 5,
      }}
    >
      {/* Group Identifier Badge */}
      {group.identifier && (
        <div
          className="absolute -top-8 left-0 px-3 py-1 rounded-full text-xs font-semibold text-white shadow-md"
          style={{
            backgroundColor: group.color,
          }}
        >
          {group.identifier}
        </div>
      )}

      {/* Seat Count Badge */}
      <div
        className="absolute -top-8 right-0 px-2 py-1 rounded-full text-xs font-semibold text-white shadow-md"
        style={{
          backgroundColor: group.color,
        }}
      >
        {group.combinedCapacity} seats
      </div>

      {/* Virtual Group Indicator */}
      {group.isVirtual && (
        <div
          className="absolute -bottom-8 left-0 px-2 py-1 rounded text-xs font-medium text-white shadow-md"
          style={{
            backgroundColor: group.color,
          }}
        >
          Virtual Group
        </div>
      )}
    </div>
  );
}

/**
 * Calculate bounding box containing all tables in group
 */
function calculateBoundingBox(tables: Table[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (tables.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const table of tables) {
    const tableMinX = table.positionX;
    const tableMinY = table.positionY;
    const tableMaxX = table.positionX + table.width;
    const tableMaxY = table.positionY + table.height;

    minX = Math.min(minX, tableMinX);
    minY = Math.min(minY, tableMinY);
    maxX = Math.max(maxX, tableMaxX);
    maxY = Math.max(maxY, tableMaxY);
  }

  return { minX, minY, maxX, maxY };
}

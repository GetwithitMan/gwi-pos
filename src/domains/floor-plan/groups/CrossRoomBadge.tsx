/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - CrossRoomBadge Component
 *
 * Small badge shown on tables that are part of a cross-room virtual group
 */

'use client';

import React from 'react';
import { TableGroup } from '../shared/types';

interface CrossRoomBadgeProps {
  group: TableGroup;
  roomCount: number; // Number of different rooms in the group
  onClick?: () => void; // Click to highlight all tables in group
}

/**
 * CrossRoomBadge Component
 *
 * Shows:
 * - Group color
 * - Number of other rooms (e.g., "+2 rooms")
 * - Clickable to highlight all tables in group
 */
export function CrossRoomBadge({
  group,
  roomCount,
  onClick,
}: CrossRoomBadgeProps) {
  if (!group.isVirtual || roomCount <= 1) {
    return null;
  }

  const otherRoomCount = roomCount - 1;

  return (
    <div
      className="absolute top-1 right-1 px-2 py-1 rounded-full text-xs font-semibold text-white shadow-lg cursor-pointer hover:scale-110 transition-transform z-10"
      style={{
        backgroundColor: group.color,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={`This table is part of a virtual group spanning ${roomCount} rooms. Click to highlight all tables.`}
    >
      <div className="flex items-center gap-1">
        {/* Multi-room icon */}
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>

        {/* Room count */}
        <span>+{otherRoomCount}</span>
      </div>
    </div>
  );
}

/**
 * Compact version for smaller tables
 */
export function CrossRoomBadgeCompact({
  group,
  roomCount,
}: {
  group: TableGroup;
  roomCount: number;
}) {
  if (!group.isVirtual || roomCount <= 1) {
    return null;
  }

  return (
    <div
      className="absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-white shadow-md"
      style={{
        backgroundColor: group.color,
      }}
      title={`Part of group spanning ${roomCount} rooms`}
    />
  );
}

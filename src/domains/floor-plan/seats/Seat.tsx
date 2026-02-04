/**
 * GWI POS - Floor Plan Domain
 * Layer 3: Seat Component
 *
 * Renders a seat as a small circle around a table.
 * Shows occupied state, guest info, and virtual seat indicators.
 */

'use client';

import React from 'react';
import type { Seat as SeatType } from '../shared/types';

interface SeatProps {
  seat: SeatType;
  tableX: number; // Table center X position in feet
  tableY: number; // Table center Y position in feet
  pixelsPerFoot: number;
  isSelected?: boolean;
  onSelect?: (seatId: string) => void;
}

/**
 * Seat Component
 * Renders a seat as a circle relative to the table center
 */
export function Seat({
  seat,
  tableX,
  tableY,
  pixelsPerFoot,
  isSelected,
  onSelect,
}: SeatProps) {
  // Calculate absolute position (table center + offset)
  const absoluteX = (tableX + seat.offsetX) * pixelsPerFoot;
  const absoluteY = (tableY + seat.offsetY) * pixelsPerFoot;

  // Seat circle radius
  const radius = 12; // pixels

  // Determine colors based on state
  let fillColor = '#FFFFFF'; // Default: empty white
  let strokeColor = '#9CA3AF'; // Default: gray border
  let strokeWidth = 2;
  let textColor = '#374151';

  if (seat.isOccupied) {
    fillColor = '#3B82F6'; // Blue for occupied
    strokeColor = '#2563EB';
    textColor = '#FFFFFF';
  }

  if (isSelected) {
    strokeColor = '#2563EB'; // Blue glow for selected
    strokeWidth = 3;
  }

  // Virtual seat gets dashed border
  const strokeDasharray = seat.isVirtual ? '4,2' : undefined;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(seat.id);
    }
  };

  // Get display text (guest initial or seat number)
  let displayText = seat.seatNumber.toString();
  if (seat.isOccupied && seat.guestName) {
    // Show first letter of guest name
    displayText = seat.guestName.charAt(0).toUpperCase();
  }

  return (
    <g
      style={{
        cursor: 'pointer',
      }}
      onClick={handleClick}
    >
      {/* Selected glow effect */}
      {isSelected && (
        <circle
          cx={absoluteX}
          cy={absoluteY}
          r={radius + 4}
          fill="none"
          stroke="rgba(59, 130, 246, 0.5)"
          strokeWidth="4"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Seat circle */}
      <circle
        cx={absoluteX}
        cy={absoluteY}
        r={radius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />

      {/* Seat number or guest initial */}
      <text
        x={absoluteX}
        y={absoluteY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textColor}
        fontSize="11"
        fontWeight={seat.isOccupied ? 'bold' : 'normal'}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {displayText}
      </text>

      {/* Virtual seat indicator (small "V" badge) */}
      {seat.isVirtual && (
        <text
          x={absoluteX + radius - 2}
          y={absoluteY - radius + 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#F59E0B"
          fontSize="8"
          fontWeight="bold"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          V
        </text>
      )}
    </g>
  );
}

export default Seat;

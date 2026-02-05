'use client';

/**
 * GWI POS - Floor Plan Domain
 * Seat Renderer Component
 *
 * Renders individual seats with interaction and visual states for ordering.
 */

import React from 'react';
import type { EditorSeat } from './types';

// =============================================================================
// TYPES
// =============================================================================

interface SeatRendererProps {
  seat: EditorSeat;
  tableRotation: number;  // Parent table rotation (to counter-rotate seat label)
  isSelected: boolean;
  isHighlighted: boolean; // For order entry - which seat is active
  hasItems: boolean;      // Does this seat have order items?
  onClick?: () => void;
  onDoubleClick?: () => void; // Open seat details
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SeatRenderer({
  seat,
  tableRotation,
  isSelected,
  isHighlighted,
  hasItems,
  onClick,
  onDoubleClick,
}: SeatRendererProps) {
  const seatSize = 20;

  // Determine colors based on state
  const getColors = () => {
    if (hasItems) {
      // Seat has order items - show filled
      return {
        backgroundColor: isHighlighted ? '#4CAF50' : '#66BB6A',
        borderColor: '#2e7d32',
        textColor: '#fff',
      };
    } else {
      // Empty seat
      return {
        backgroundColor: '#ffffff',
        borderColor: '#9E9E9E',
        textColor: '#666',
      };
    }
  };

  const colors = getColors();

  // Selection ring
  const selectionRing = isSelected ? (
    <div
      style={{
        position: 'absolute',
        left: -4,
        top: -4,
        width: seatSize + 8,
        height: seatSize + 8,
        borderRadius: '50%',
        border: '2px solid #3498db',
        boxShadow: '0 0 8px rgba(52, 152, 219, 0.8)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  // Highlighted glow (pulsing animation for active seat during ordering)
  const highlightGlow = isHighlighted ? (
    <div
      style={{
        position: 'absolute',
        left: -6,
        top: -6,
        width: seatSize + 12,
        height: seatSize + 12,
        borderRadius: '50%',
        backgroundColor: 'rgba(255, 193, 7, 0.3)',
        animation: 'pulse 1.5s ease-in-out infinite',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  return (
    <>
      {/* CSS Animation for pulsing glow */}
      {isHighlighted && (
        <style>
          {`
            @keyframes pulse {
              0%, 100% {
                transform: scale(1);
                opacity: 0.8;
              }
              50% {
                transform: scale(1.2);
                opacity: 0.4;
              }
            }
          `}
        </style>
      )}

      {/* Seat circle container */}
      <div
        onClick={onClick ? (e) => {
          e.stopPropagation();
          onClick();
        } : undefined}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
        style={{
          position: 'relative',
          width: seatSize,
          height: seatSize,
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        {/* Highlight glow (behind) */}
        {highlightGlow}

        {/* Selection ring (middle) */}
        {selectionRing}

        {/* Seat circle (front) */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: seatSize,
            height: seatSize,
            borderRadius: '50%',
            backgroundColor: colors.backgroundColor,
            border: `2px solid ${colors.borderColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: colors.textColor,
            boxShadow: hasItems ? '0 2px 4px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.2)',
            // Counter-rotate label to keep it upright
            transform: `rotate(-${tableRotation}deg)`,
            transition: 'all 0.2s ease',
          }}
          title={`Seat ${seat.label}${hasItems ? ' (Has items)' : ''}${isHighlighted ? ' (Active)' : ''}`}
        >
          {seat.label}
        </div>
      </div>
    </>
  );
}

export default SeatRenderer;

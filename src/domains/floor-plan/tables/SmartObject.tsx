/**
 * GWI POS - Floor Plan Domain
 * Layer 2: Smart Object Component
 *
 * Renders non-dining objects like pool tables, dart boards, decorations, etc.
 */

'use client';

import React from 'react';
import type { Table as TableType, ObjectType } from '../shared/types';

interface SmartObjectProps {
  object: TableType;
  pixelsPerFoot: number;
  isSelected?: boolean;
  onSelect?: (objectId: string) => void;
  onDragStart?: (objectId: string, event: React.PointerEvent) => void;
}

/**
 * Get icon/visual representation for entertainment objects
 */
function getObjectIcon(objectType: ObjectType): string {
  switch (objectType) {
    case 'pool_table':
      return '🎱';
    case 'dart_board':
      return '🎯';
    case 'karaoke':
      return '🎤';
    case 'shuffleboard':
      return '🏐';
    case 'arcade':
      return '🕹️';
    case 'bowling_lane':
      return '🎳';
    case 'cornhole':
      return '🌽';
    case 'portable_planter':
      return '🪴';
    case 'portable_divider':
      return '🚧';
    case 'host_stand':
      return '🎫';
    case 'wait_station':
      return '⚙️';
    case 'pos_terminal':
      return '💻';
    case 'dj_booth':
      return '🎧';
    case 'coat_check':
      return '🧥';
    case 'high_chair_storage':
      return '🪑';
    default:
      return '📦';
  }
}

/**
 * Get background color based on object category
 */
function getObjectColor(category: string, customColor?: string | null): string {
  if (customColor) return customColor;

  switch (category) {
    case 'entertainment':
      return '#7C3AED'; // Purple
    case 'decorative':
      return '#10B981'; // Green
    case 'service':
      return '#F59E0B'; // Orange
    default:
      return '#6B7280'; // Gray
  }
}

/**
 * SmartObject Component
 * Renders entertainment, decorative, and service objects
 */
export function SmartObject({
  object,
  pixelsPerFoot,
  isSelected,
  onSelect,
  onDragStart,
}: SmartObjectProps) {
  const widthPx = object.width * pixelsPerFoot;
  const heightPx = object.height * pixelsPerFoot;
  const xPx = object.positionX * pixelsPerFoot;
  const yPx = object.positionY * pixelsPerFoot;

  const color = getObjectColor(object.category, object.color);
  const icon = getObjectIcon(object.objectType);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(object.id);
    }
    if (onDragStart) {
      onDragStart(object.id, e);
    }
  };

  return (
    <g
      style={{
        transform: `translate(${xPx}px, ${yPx}px) rotate(${object.rotation}deg)`,
        transformOrigin: `${widthPx / 2}px ${heightPx / 2}px`,
        cursor: 'move',
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Object shape (rounded rectangle) */}
      <rect
        x="0"
        y="0"
        width={widthPx}
        height={heightPx}
        rx="8"
        fill={color}
        stroke={isSelected ? '#3B82F6' : color}
        strokeWidth={isSelected ? '3' : '2'}
        opacity={isSelected ? 0.9 : 0.7}
        style={{
          filter: isSelected ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.8))' : undefined,
        }}
      />

      {/* Icon */}
      <text
        x={widthPx / 2}
        y={heightPx / 2 - 10}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="24"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {icon}
      </text>

      {/* Object label */}
      <text
        x={widthPx / 2}
        y={heightPx / 2 + 15}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize="12"
        fontWeight="600"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {object.label}
      </text>

      {/* Entertainment config indicator (if applicable) */}
      {object.entertainmentConfig && (
        <g>
          <circle
            cx={widthPx - 12}
            cy="12"
            r="8"
            fill="rgba(255, 255, 255, 0.9)"
            stroke={color}
            strokeWidth="1.5"
          />
          <text
            x={widthPx - 12}
            y="12"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fontWeight="bold"
            fill={color}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            $
          </text>
        </g>
      )}
    </g>
  );
}

export default SmartObject;

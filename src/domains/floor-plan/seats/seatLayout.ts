/**
 * GWI POS - Floor Plan Domain
 * Layer 3: Seat Layout Engine
 *
 * Auto-positions seats around tables based on shape.
 * All positions are in feet relative to table center.
 */

import type { TableShape } from '../shared/types';

export interface SeatPosition {
  offsetX: number; // feet from table center
  offsetY: number; // feet from table center
  angle: number; // degrees, facing toward center
}

/**
 * Generate seat positions for a table based on shape and count
 */
export function generateSeatPositions(
  shape: TableShape,
  count: number,
  tableWidth: number,
  tableHeight: number
): SeatPosition[] {
  switch (shape) {
    case 'circle':
      return generateCircularSeats(count, tableWidth, tableHeight);

    case 'square':
    case 'rectangle':
      return generateRectangularSeats(count, tableWidth, tableHeight);

    case 'booth':
      return generateCircularSeats(count, tableWidth, tableHeight);

    case 'bar':
    default:
      // Default to circular distribution
      return generateCircularSeats(count, tableWidth, tableHeight);
  }
}

/**
 * Generate seats in a circle around the table (for round/oval tables)
 *
 * Example (8 seats):
 *      1
 *   8     2
 *  7   ●   3
 *   6     4
 *      5
 */
function generateCircularSeats(
  count: number,
  tableWidth: number,
  tableHeight: number
): SeatPosition[] {
  const seats: SeatPosition[] = [];
  const radiusX = tableWidth / 2 + 1.5; // 1.5 feet clearance
  const radiusY = tableHeight / 2 + 1.5;

  // Start at top (270 degrees / -90 degrees from right)
  const startAngle = -Math.PI / 2;

  for (let i = 0; i < count; i++) {
    const angle = startAngle + (i * 2 * Math.PI) / count;

    const offsetX = radiusX * Math.cos(angle);
    const offsetY = radiusY * Math.sin(angle);

    // Calculate angle facing toward center (in degrees)
    const facingAngle = ((angle + Math.PI) * 180) / Math.PI;

    seats.push({
      offsetX: Number(offsetX.toFixed(2)),
      offsetY: Number(offsetY.toFixed(2)),
      angle: Number(facingAngle.toFixed(1)),
    });
  }

  return seats;
}

/**
 * Generate seats distributed along edges of rectangle
 *
 * Example (6 seats):
 *     1   2
 *   6  ████  3
 *     5   4
 */
function generateRectangularSeats(
  count: number,
  tableWidth: number,
  tableHeight: number
): SeatPosition[] {
  const seats: SeatPosition[] = [];
  const clearance = 1.5; // feet

  // Calculate perimeter and distribute seats
  const perimeter = 2 * (tableWidth + tableHeight);
  const spacing = perimeter / count;

  // Determine how many seats per side based on side length
  const topCount = Math.round((tableWidth / perimeter) * count);
  const rightCount = Math.round((tableHeight / perimeter) * count);
  const bottomCount = Math.round((tableWidth / perimeter) * count);
  const leftCount = count - topCount - rightCount - bottomCount;

  // Top edge (left to right)
  for (let i = 0; i < topCount; i++) {
    const x = -tableWidth / 2 + (tableWidth / (topCount + 1)) * (i + 1);
    const y = -tableHeight / 2 - clearance;
    seats.push({
      offsetX: Number(x.toFixed(2)),
      offsetY: Number(y.toFixed(2)),
      angle: 180, // facing down (toward center)
    });
  }

  // Right edge (top to bottom)
  for (let i = 0; i < rightCount; i++) {
    const x = tableWidth / 2 + clearance;
    const y = -tableHeight / 2 + (tableHeight / (rightCount + 1)) * (i + 1);
    seats.push({
      offsetX: Number(x.toFixed(2)),
      offsetY: Number(y.toFixed(2)),
      angle: 270, // facing left (toward center)
    });
  }

  // Bottom edge (right to left)
  for (let i = 0; i < bottomCount; i++) {
    const x = tableWidth / 2 - (tableWidth / (bottomCount + 1)) * (i + 1);
    const y = tableHeight / 2 + clearance;
    seats.push({
      offsetX: Number(x.toFixed(2)),
      offsetY: Number(y.toFixed(2)),
      angle: 0, // facing up (toward center)
    });
  }

  // Left edge (bottom to top)
  for (let i = 0; i < leftCount; i++) {
    const x = -tableWidth / 2 - clearance;
    const y = tableHeight / 2 - (tableHeight / (leftCount + 1)) * (i + 1);
    seats.push({
      offsetX: Number(x.toFixed(2)),
      offsetY: Number(y.toFixed(2)),
      angle: 90, // facing right (toward center)
    });
  }

  return seats;
}

/**
 * Generate seats around hexagon table
 */
function generateHexagonSeats(
  count: number,
  tableWidth: number,
  tableHeight: number
): SeatPosition[] {
  // For hexagons, use circular distribution with slight adjustment
  return generateCircularSeats(count, tableWidth, tableHeight);
}

/**
 * Generate booth seating (seats on 3 sides, back against wall)
 *
 * Example (4 seats):
 *   ████████
 *   1  2  3  4
 *   (open side only)
 */
export function generateBoothSeats(
  count: number,
  tableWidth: number,
  tableHeight: number
): SeatPosition[] {
  const seats: SeatPosition[] = [];
  const clearance = 1.5;

  // All seats on the open (front) side
  const y = tableHeight / 2 + clearance;

  for (let i = 0; i < count; i++) {
    const x = -tableWidth / 2 + (tableWidth / (count + 1)) * (i + 1);
    seats.push({
      offsetX: Number(x.toFixed(2)),
      offsetY: Number(y.toFixed(2)),
      angle: 0, // facing up (toward table)
    });
  }

  return seats;
}

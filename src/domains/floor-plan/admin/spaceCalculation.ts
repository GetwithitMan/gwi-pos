/**
 * GWI POS - Floor Plan Domain
 * Space Calculation - Pure Math Functions
 *
 * Extracted from EditorCanvas.tsx. These are pure functions that calculate
 * available space around tables and compress seats to fit.
 */

import { FloorCanvasAPI } from '../canvas';
import type { Fixture } from '../shared/types';
import type { EditorTable, EditorSeat } from './types';
import {
  SEAT_BOUNDARY_DISTANCE,
  SEAT_RADIUS,
  SEAT_MIN_DISTANCE,
} from '@/lib/floorplan/constants';

// Available space around a table (in pixels)
export interface AvailableSpace {
  top: number;    // pixels to nearest obstacle above
  bottom: number; // pixels to nearest obstacle below
  left: number;   // pixels to nearest obstacle left
  right: number;  // pixels to nearest obstacle right
}

/**
 * Calculate available space around a table (in pixels).
 */
export function calculateAvailableSpace(
  tableId: string,
  tablePosX: number,
  tablePosY: number,
  tableWidth: number,
  tableHeight: number,
  tableRotation: number,
  tableList: EditorTable[],
  fixtureList: Fixture[]
): AvailableSpace {
  // Default to maximum boundary if no obstacles nearby
  const defaultSpace = SEAT_BOUNDARY_DISTANCE + SEAT_RADIUS;
  let topSpace = defaultSpace;
  let bottomSpace = defaultSpace;
  let leftSpace = defaultSpace;
  let rightSpace = defaultSpace;

  // For simplicity, assume rectangular bounding box (ignore rotation for obstacle distance)
  const tableTop = tablePosY;
  const tableBottom = tablePosY + tableHeight;
  const tableLeft = tablePosX;
  const tableRight = tablePosX + tableWidth;

  // Check distance to other tables
  for (const otherTable of tableList) {
    if (otherTable.id === tableId) continue;

    const otherTop = otherTable.posY;
    const otherBottom = otherTable.posY + otherTable.height;
    const otherLeft = otherTable.posX;
    const otherRight = otherTable.posX + otherTable.width;

    // Check if tables are aligned horizontally (check top/bottom space)
    if (!(tableRight < otherLeft || tableLeft > otherRight)) {
      // Tables overlap horizontally, check vertical distance
      if (otherBottom <= tableTop) {
        // Other table is above
        const distance = tableTop - otherBottom;
        topSpace = Math.min(topSpace, distance);
      } else if (otherTop >= tableBottom) {
        // Other table is below
        const distance = otherTop - tableBottom;
        bottomSpace = Math.min(bottomSpace, distance);
      }
    }

    // Check if tables are aligned vertically (check left/right space)
    if (!(tableBottom < otherTop || tableTop > otherBottom)) {
      // Tables overlap vertically, check horizontal distance
      if (otherRight <= tableLeft) {
        // Other table is to the left
        const distance = tableLeft - otherRight;
        leftSpace = Math.min(leftSpace, distance);
      } else if (otherLeft >= tableRight) {
        // Other table is to the right
        const distance = otherLeft - tableRight;
        rightSpace = Math.min(rightSpace, distance);
      }
    }
  }

  // Check distance to fixtures
  for (const fixture of fixtureList) {
    if (fixture.geometry.type === 'rectangle') {
      const fx = FloorCanvasAPI.feetToPixels(fixture.geometry.position.x);
      const fy = FloorCanvasAPI.feetToPixels(fixture.geometry.position.y);
      const fw = FloorCanvasAPI.feetToPixels(fixture.geometry.width);
      const fh = FloorCanvasAPI.feetToPixels(fixture.geometry.height);

      const fixtureTop = fy;
      const fixtureBottom = fy + fh;
      const fixtureLeft = fx;
      const fixtureRight = fx + fw;

      // Check horizontal alignment
      if (!(tableRight < fixtureLeft || tableLeft > fixtureRight)) {
        if (fixtureBottom <= tableTop) {
          const distance = tableTop - fixtureBottom;
          topSpace = Math.min(topSpace, distance);
        } else if (fixtureTop >= tableBottom) {
          const distance = fixtureTop - tableBottom;
          bottomSpace = Math.min(bottomSpace, distance);
        }
      }

      // Check vertical alignment
      if (!(tableBottom < fixtureTop || tableTop > fixtureBottom)) {
        if (fixtureRight <= tableLeft) {
          const distance = tableLeft - fixtureRight;
          leftSpace = Math.min(leftSpace, distance);
        } else if (fixtureLeft >= tableRight) {
          const distance = fixtureLeft - tableRight;
          rightSpace = Math.min(rightSpace, distance);
        }
      }
    }
    // Simplified: treat circles and lines as not affecting space for now
    // (more complex geometry would require more sophisticated calculations)
  }

  return {
    top: Math.max(0, topSpace),
    bottom: Math.max(0, bottomSpace),
    left: Math.max(0, leftSpace),
    right: Math.max(0, rightSpace),
  };
}

/**
 * Compress seats to fit within available space.
 */
export function compressSeatsToFit(
  tableId: string,
  tableSeats: EditorSeat[],
  table: EditorTable,
  availableSpace: AvailableSpace
): EditorSeat[] {
  if (tableSeats.length === 0) return tableSeats;

  const halfWidth = table.width / 2;
  const halfHeight = table.height / 2;

  return tableSeats.map((seat) => {
    const absX = Math.abs(seat.relativeX);
    const absY = Math.abs(seat.relativeY);

    // Determine which side the seat is on
    const normalizedX = absX / halfWidth;
    const normalizedY = absY / halfHeight;

    let newRelativeX = seat.relativeX;
    let newRelativeY = seat.relativeY;

    // Calculate dynamic offset for each side based on available space
    const baseOffset = 25; // Default offset from table edge

    if (normalizedY >= normalizedX) {
      // Seat is on top or bottom edge
      const direction = seat.relativeY >= 0 ? 1 : -1;
      const availableOnSide = direction > 0 ? availableSpace.bottom : availableSpace.top;

      // Calculate dynamic offset (compressed if space is tight)
      const dynamicOffset = Math.max(
        SEAT_MIN_DISTANCE,
        Math.min(baseOffset, availableOnSide - SEAT_RADIUS)
      );

      // Apply dynamic offset
      newRelativeY = direction * (halfHeight + dynamicOffset);
    } else {
      // Seat is on left or right edge
      const direction = seat.relativeX >= 0 ? 1 : -1;
      const availableOnSide = direction > 0 ? availableSpace.right : availableSpace.left;

      // Calculate dynamic offset (compressed if space is tight)
      const dynamicOffset = Math.max(
        SEAT_MIN_DISTANCE,
        Math.min(baseOffset, availableOnSide - SEAT_RADIUS)
      );

      // Apply dynamic offset
      newRelativeX = direction * (halfWidth + dynamicOffset);
    }

    return {
      ...seat,
      relativeX: Math.round(newRelativeX),
      relativeY: Math.round(newRelativeY),
    };
  });
}

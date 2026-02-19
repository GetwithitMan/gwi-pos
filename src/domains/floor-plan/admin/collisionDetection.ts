/**
 * GWI POS - Floor Plan Domain
 * Collision Detection - Pure Math Functions
 *
 * Extracted from EditorCanvas.tsx. These are pure functions that check
 * for collisions between tables, fixtures, and seats.
 */

import { FloorCanvasAPI } from '../canvas';
import type { Fixture } from '../shared/types';
import type { EditorTable, EditorSeat } from './types';
import {
  SEAT_RADIUS,
  SEAT_COLLISION_RADIUS,
} from '@/lib/floorplan/constants';

/**
 * Check if a table would collide with any fixture.
 */
export function checkTableFixtureCollision(
  tablePosX: number,  // in pixels
  tablePosY: number,  // in pixels
  tableWidth: number, // in pixels
  tableHeight: number, // in pixels
  fixtureList: Fixture[]
): boolean {
  for (const fixture of fixtureList) {
    if (fixture.geometry.type === 'rectangle') {
      // Convert fixture position from feet to pixels
      const fx = FloorCanvasAPI.feetToPixels(fixture.geometry.position.x);
      const fy = FloorCanvasAPI.feetToPixels(fixture.geometry.position.y);
      const fw = FloorCanvasAPI.feetToPixels(fixture.geometry.width);
      const fh = FloorCanvasAPI.feetToPixels(fixture.geometry.height);

      // AABB collision check
      if (tablePosX < fx + fw &&
          tablePosX + tableWidth > fx &&
          tablePosY < fy + fh &&
          tablePosY + tableHeight > fy) {
        return true;
      }
    } else if (fixture.geometry.type === 'circle') {
      // Convert circle center and radius from feet to pixels
      const cx = FloorCanvasAPI.feetToPixels(fixture.geometry.center.x);
      const cy = FloorCanvasAPI.feetToPixels(fixture.geometry.center.y);
      const cr = FloorCanvasAPI.feetToPixels(fixture.geometry.radius);

      // Simple bounding box check for circle
      if (tablePosX < cx + cr &&
          tablePosX + tableWidth > cx - cr &&
          tablePosY < cy + cr &&
          tablePosY + tableHeight > cy - cr) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a table would collide with any other table.
 */
export function checkTableCollision(
  tablePosX: number,   // in pixels
  tablePosY: number,   // in pixels
  tableWidth: number,  // in pixels
  tableHeight: number, // in pixels
  tableList: EditorTable[],
  excludeTableId?: string  // Table being moved (exclude from collision check)
): boolean {
  for (const table of tableList) {
    // Skip the table being moved
    if (excludeTableId && table.id === excludeTableId) {
      continue;
    }

    // AABB collision check
    if (tablePosX < table.posX + table.width &&
        tablePosX + tableWidth > table.posX &&
        tablePosY < table.posY + table.height &&
        tablePosY + tableHeight > table.posY) {
      return true; // Collision detected
    }
  }
  return false;
}

/**
 * Check if a seat position collides with other seats on the same table.
 */
export function checkSeatCollision(
  posX: number,
  posY: number,
  tableId: string,
  seats: EditorSeat[],
  tables: EditorTable[],
  excludeSeatId?: string
): boolean {
  const tableSeats = seats.filter(s => s.tableId === tableId && s.id !== excludeSeatId);
  const table = tables.find(t => t.id === tableId);
  if (!table) return false;

  const tableCenterX = table.posX + table.width / 2;
  const tableCenterY = table.posY + table.height / 2;

  for (const seat of tableSeats) {
    // Calculate absolute position of existing seat
    const seatAbsX = tableCenterX + seat.relativeX;
    const seatAbsY = tableCenterY + seat.relativeY;

    // Check distance between seat centers
    const distance = Math.hypot(posX - seatAbsX, posY - seatAbsY);

    // Collision if distance < 2 * SEAT_COLLISION_RADIUS (seats touching)
    if (distance < SEAT_COLLISION_RADIUS * 2 + 4) { // Using smaller collision radius
      return true;
    }
  }
  return false;
}

/**
 * Check if any seat of a table would collide with obstacles at a given table position.
 */
export function checkSeatsObstacleCollision(
  tableId: string,
  newTablePosX: number,
  newTablePosY: number,
  tableWidth: number,
  tableHeight: number,
  tableRotation: number,
  seats: EditorSeat[],
  tableList: EditorTable[],
  fixtureList: Fixture[]
): boolean {
  // Get seats for this table
  const tableSeats = seats.filter(s => s.tableId === tableId);
  if (tableSeats.length === 0) return false;

  const tableCenterX = newTablePosX + tableWidth / 2;
  const tableCenterY = newTablePosY + tableHeight / 2;
  const rotation = tableRotation * Math.PI / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Check each seat against all obstacles
  for (const seat of tableSeats) {
    // Calculate absolute seat position at the new table location
    const rotatedX = seat.relativeX * cos - seat.relativeY * sin;
    const rotatedY = seat.relativeX * sin + seat.relativeY * cos;
    const seatAbsX = tableCenterX + rotatedX;
    const seatAbsY = tableCenterY + rotatedY;

    // Check against other tables (exclude current table)
    for (const otherTable of tableList) {
      if (otherTable.id === tableId) continue;

      // Simple AABB check with seat radius
      if (seatAbsX + SEAT_RADIUS > otherTable.posX &&
          seatAbsX - SEAT_RADIUS < otherTable.posX + otherTable.width &&
          seatAbsY + SEAT_RADIUS > otherTable.posY &&
          seatAbsY - SEAT_RADIUS < otherTable.posY + otherTable.height) {
        return true; // Collision with another table
      }

      // Check against seats of other tables
      const otherTableSeats = seats.filter(s => s.tableId === otherTable.id);
      const otherTableCenterX = otherTable.posX + otherTable.width / 2;
      const otherTableCenterY = otherTable.posY + otherTable.height / 2;
      const otherRotation = (otherTable.rotation || 0) * Math.PI / 180;
      const otherCos = Math.cos(otherRotation);
      const otherSin = Math.sin(otherRotation);

      for (const otherSeat of otherTableSeats) {
        const otherRotatedX = otherSeat.relativeX * otherCos - otherSeat.relativeY * otherSin;
        const otherRotatedY = otherSeat.relativeX * otherSin + otherSeat.relativeY * otherCos;
        const otherSeatAbsX = otherTableCenterX + otherRotatedX;
        const otherSeatAbsY = otherTableCenterY + otherRotatedY;

        const distance = Math.hypot(seatAbsX - otherSeatAbsX, seatAbsY - otherSeatAbsY);
        if (distance < SEAT_COLLISION_RADIUS * 2 + 4) {
          return true; // Collision with seat from another table
        }
      }
    }

    // Check against fixtures
    for (const fixture of fixtureList) {
      if (fixture.geometry.type === 'rectangle') {
        const fx = FloorCanvasAPI.feetToPixels(fixture.geometry.position.x);
        const fy = FloorCanvasAPI.feetToPixels(fixture.geometry.position.y);
        const fw = FloorCanvasAPI.feetToPixels(fixture.geometry.width);
        const fh = FloorCanvasAPI.feetToPixels(fixture.geometry.height);

        if (seatAbsX + SEAT_RADIUS > fx &&
            seatAbsX - SEAT_RADIUS < fx + fw &&
            seatAbsY + SEAT_RADIUS > fy &&
            seatAbsY - SEAT_RADIUS < fy + fh) {
          return true; // Collision with fixture
        }
      } else if (fixture.geometry.type === 'circle') {
        const cx = FloorCanvasAPI.feetToPixels(fixture.geometry.center.x);
        const cy = FloorCanvasAPI.feetToPixels(fixture.geometry.center.y);
        const cr = FloorCanvasAPI.feetToPixels(fixture.geometry.radius);

        const dist = Math.hypot(seatAbsX - cx, seatAbsY - cy);
        if (dist < cr + SEAT_RADIUS) {
          return true; // Collision with circular fixture
        }
      }
      // Lines (walls) - simplified bounding box check
      else if (fixture.geometry.type === 'line') {
        const { start, end } = fixture.geometry;
        const thickness = fixture.thickness || 0.5;
        const x1 = FloorCanvasAPI.feetToPixels(Math.min(start.x, end.x) - thickness);
        const x2 = FloorCanvasAPI.feetToPixels(Math.max(start.x, end.x) + thickness);
        const y1 = FloorCanvasAPI.feetToPixels(Math.min(start.y, end.y) - thickness);
        const y2 = FloorCanvasAPI.feetToPixels(Math.max(start.y, end.y) + thickness);

        if (seatAbsX + SEAT_RADIUS > x1 &&
            seatAbsX - SEAT_RADIUS < x2 &&
            seatAbsY + SEAT_RADIUS > y1 &&
            seatAbsY - SEAT_RADIUS < y2) {
          return true; // Collision with wall
        }
      }
    }
  }

  return false; // No collisions
}

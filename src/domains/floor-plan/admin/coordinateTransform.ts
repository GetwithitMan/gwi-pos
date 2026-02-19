/**
 * GWI POS - Floor Plan Domain
 * Coordinate Transform - Pure Math Functions
 *
 * Extracted from EditorCanvas.tsx. These are utility functions for
 * coordinate system conversions and angle calculations.
 */

import { FloorCanvasAPI } from '../canvas';
import type { Point } from '../shared/types';

/**
 * Convert screen position to floor position (feet), with optional grid snapping.
 */
export function screenToFloor(
  screenX: number,
  screenY: number,
  canvasEl: HTMLDivElement | null,
  zoom: number,
  gridSizeFeet?: number
): Point {
  if (!canvasEl) return { x: 0, y: 0 };
  const rect = canvasEl.getBoundingClientRect();
  // Account for zoom when converting screen coords to canvas coords
  const x = (screenX - rect.left) / zoom;
  const y = (screenY - rect.top) / zoom;
  const position: Point = {
    x: FloorCanvasAPI.pixelsToFeet(x),
    y: FloorCanvasAPI.pixelsToFeet(y),
  };
  // Snap to grid
  if (gridSizeFeet) {
    return FloorCanvasAPI.snapToGrid(position, gridSizeFeet);
  }
  return position;
}

/**
 * Calculate angle from table center to mouse position.
 * Returns degrees where 0 = up.
 */
export function calculateAngle(tableCenter: Point, mousePos: Point): number {
  const dx = mousePos.x - tableCenter.x;
  const dy = mousePos.y - tableCenter.y;
  return Math.atan2(dy, dx) * (180 / Math.PI) + 90; // 0 degrees = up
}

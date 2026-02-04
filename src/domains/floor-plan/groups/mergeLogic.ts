/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Merge Logic
 *
 * Handles snap/magnet calculations for physical table merging
 */

import { Point, Table } from '../shared/types';
import { MergeDetection, MERGE_CONSTANTS } from './types';

/**
 * Detect if dragging table can merge with target table
 */
export function detectMergeOpportunity(
  draggingTable: Table,
  targetTable: Table,
  dragPosition: Point
): MergeDetection {
  // Can't merge with self
  if (draggingTable.id === targetTable.id) {
    return {
      canMerge: false,
      snapPosition: null,
      snapEdge: null,
      snapDistance: Infinity,
    };
  }

  // Can't merge if tables are in different rooms
  if (draggingTable.floorPlanId !== targetTable.floorPlanId) {
    return {
      canMerge: false,
      snapPosition: null,
      snapEdge: null,
      snapDistance: Infinity,
    };
  }

  // Check each edge for snap opportunity
  const edges: Array<'top' | 'bottom' | 'left' | 'right'> = [
    'top',
    'bottom',
    'left',
    'right',
  ];

  let closestEdge: typeof edges[number] | null = null;
  let closestDistance = Infinity;
  let closestSnapPosition: Point | null = null;

  for (const edge of edges) {
    const snapPos = calculateSnapPosition(draggingTable, targetTable, edge, dragPosition);
    if (!snapPos) continue;

    const distance = getDistance(dragPosition, snapPos);

    if (distance < closestDistance && distance <= MERGE_CONSTANTS.SNAP_DISTANCE_FEET) {
      closestDistance = distance;
      closestEdge = edge;
      closestSnapPosition = snapPos;
    }
  }

  return {
    canMerge: closestEdge !== null,
    snapPosition: closestSnapPosition,
    snapEdge: closestEdge,
    snapDistance: closestDistance,
  };
}

/**
 * Calculate snap position for a specific edge alignment
 */
export function calculateSnapPosition(
  draggingTable: Table,
  targetTable: Table,
  edge: 'top' | 'bottom' | 'left' | 'right',
  currentPosition?: Point
): Point | null {
  const target = {
    x: targetTable.positionX,
    y: targetTable.positionY,
    width: targetTable.width,
    height: targetTable.height,
  };

  const dragging = {
    width: draggingTable.width,
    height: draggingTable.height,
  };

  let snapX: number;
  let snapY: number;

  switch (edge) {
    case 'top':
      // Dragging table snaps to top edge of target (above it)
      snapX = target.x;
      snapY = target.y - dragging.height;
      break;

    case 'bottom':
      // Dragging table snaps to bottom edge of target (below it)
      snapX = target.x;
      snapY = target.y + target.height;
      break;

    case 'left':
      // Dragging table snaps to left edge of target (left of it)
      snapX = target.x - dragging.width;
      snapY = target.y;
      break;

    case 'right':
      // Dragging table snaps to right edge of target (right of it)
      snapX = target.x + target.width;
      snapY = target.y;
      break;
  }

  // Check alignment tolerance (tables should be roughly aligned)
  if (currentPosition) {
    const alignmentOk = checkAlignment(
      { x: snapX, y: snapY },
      currentPosition,
      edge
    );
    if (!alignmentOk) {
      return null;
    }
  }

  return { x: snapX, y: snapY };
}

/**
 * Check if tables are aligned enough to snap
 */
function checkAlignment(
  snapPos: Point,
  currentPos: Point,
  edge: 'top' | 'bottom' | 'left' | 'right'
): boolean {
  const tolerance = MERGE_CONSTANTS.SNAP_ALIGN_TOLERANCE;

  if (edge === 'top' || edge === 'bottom') {
    // For vertical edges, check horizontal alignment
    return Math.abs(snapPos.x - currentPos.x) <= tolerance;
  } else {
    // For horizontal edges, check vertical alignment
    return Math.abs(snapPos.y - currentPos.y) <= tolerance;
  }
}

/**
 * Calculate distance between two points
 */
function getDistance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if two tables are adjacent (touching edges)
 */
export function areTablesAdjacent(table1: Table, table2: Table): boolean {
  const t1 = {
    left: table1.positionX,
    right: table1.positionX + table1.width,
    top: table1.positionY,
    bottom: table1.positionY + table1.height,
  };

  const t2 = {
    left: table2.positionX,
    right: table2.positionX + table2.width,
    top: table2.positionY,
    bottom: table2.positionY + table2.height,
  };

  const tolerance = 0.1; // Small tolerance for floating point

  // Check if touching on any edge
  const touchingTop = Math.abs(t1.bottom - t2.top) < tolerance;
  const touchingBottom = Math.abs(t1.top - t2.bottom) < tolerance;
  const touchingLeft = Math.abs(t1.right - t2.left) < tolerance;
  const touchingRight = Math.abs(t1.left - t2.right) < tolerance;

  // Check if there's overlap on the perpendicular axis
  const horizontalOverlap =
    (t1.left <= t2.right && t1.right >= t2.left) ||
    (t2.left <= t1.right && t2.right >= t1.left);
  const verticalOverlap =
    (t1.top <= t2.bottom && t1.bottom >= t2.top) ||
    (t2.top <= t1.bottom && t2.bottom >= t1.top);

  return (
    ((touchingTop || touchingBottom) && horizontalOverlap) ||
    ((touchingLeft || touchingRight) && verticalOverlap)
  );
}

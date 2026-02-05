/**
 * GWI POS - Floor Plan Domain
 * Snap Engine for Table Combining
 *
 * Calculates snap positions when dragging tables near each other.
 * Tables snap to edges with configurable offset tolerance.
 */

import type { SnapEdge, SnapPreview, SnapConfig } from './types';

export interface TableRect {
  id: string;
  x: number; // posX (top-left corner)
  y: number; // posY (top-left corner)
  width: number;
  height: number;
}

const DEFAULT_CONFIG: SnapConfig = {
  snapTriggerDistance: 30,
  maxOffsetPercent: 0.5,
  minOverlap: 20,
};

/**
 * Get the center point of a table
 */
function getCenter(table: TableRect): { x: number; y: number } {
  return {
    x: table.x + table.width / 2,
    y: table.y + table.height / 2,
  };
}

/**
 * Get the edges of a table as line segments
 */
function getEdges(table: TableRect): Record<SnapEdge, { start: number; end: number; position: number }> {
  return {
    top: { start: table.x, end: table.x + table.width, position: table.y },
    bottom: { start: table.x, end: table.x + table.width, position: table.y + table.height },
    left: { start: table.y, end: table.y + table.height, position: table.x },
    right: { start: table.y, end: table.y + table.height, position: table.x + table.width },
  };
}

/**
 * Calculate overlap between two ranges
 */
function getRangeOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): { overlap: number; offset: number } {
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);
  const overlap = Math.max(0, overlapEnd - overlapStart);

  // Offset is how far the centers are apart along this axis
  const center1 = (start1 + end1) / 2;
  const center2 = (start2 + end2) / 2;
  const offset = center1 - center2;

  return { overlap, offset };
}

/**
 * Calculate snap position for dragging table to target's edge
 */
function calculateSnapToEdge(
  dragged: TableRect,
  target: TableRect,
  edge: SnapEdge,
  config: SnapConfig
): SnapPreview | null {
  const targetEdges = getEdges(target);
  const draggedCenter = getCenter(dragged);

  let snapX: number;
  let snapY: number;
  let edgeOffset: number;
  let overlap: number;

  switch (edge) {
    case 'right': {
      // Snap dragged table to the RIGHT of target
      snapX = target.x + target.width; // Dragged table's left edge touches target's right edge

      // Calculate vertical alignment - try to center, but respect current position
      const vertOverlap = getRangeOverlap(
        dragged.y, dragged.y + dragged.height,
        target.y, target.y + target.height
      );
      overlap = vertOverlap.overlap;
      edgeOffset = vertOverlap.offset;

      // Keep vertical position unless it would cause no overlap
      snapY = dragged.y;
      if (overlap < config.minOverlap) {
        // Adjust to ensure minimum overlap
        if (dragged.y > target.y + target.height - config.minOverlap) {
          snapY = target.y + target.height - config.minOverlap - dragged.height;
        } else if (dragged.y + dragged.height < target.y + config.minOverlap) {
          snapY = target.y + config.minOverlap;
        }
      }
      break;
    }

    case 'left': {
      // Snap dragged table to the LEFT of target
      snapX = target.x - dragged.width;

      const vertOverlap = getRangeOverlap(
        dragged.y, dragged.y + dragged.height,
        target.y, target.y + target.height
      );
      overlap = vertOverlap.overlap;
      edgeOffset = vertOverlap.offset;
      snapY = dragged.y;

      if (overlap < config.minOverlap) {
        if (dragged.y > target.y + target.height - config.minOverlap) {
          snapY = target.y + target.height - config.minOverlap - dragged.height;
        } else if (dragged.y + dragged.height < target.y + config.minOverlap) {
          snapY = target.y + config.minOverlap;
        }
      }
      break;
    }

    case 'bottom': {
      // Snap dragged table to the BOTTOM of target
      snapY = target.y + target.height;

      const horizOverlap = getRangeOverlap(
        dragged.x, dragged.x + dragged.width,
        target.x, target.x + target.width
      );
      overlap = horizOverlap.overlap;
      edgeOffset = horizOverlap.offset;
      snapX = dragged.x;

      if (overlap < config.minOverlap) {
        if (dragged.x > target.x + target.width - config.minOverlap) {
          snapX = target.x + target.width - config.minOverlap - dragged.width;
        } else if (dragged.x + dragged.width < target.x + config.minOverlap) {
          snapX = target.x + config.minOverlap;
        }
      }
      break;
    }

    case 'top': {
      // Snap dragged table to the TOP of target
      snapY = target.y - dragged.height;

      const horizOverlap = getRangeOverlap(
        dragged.x, dragged.x + dragged.width,
        target.x, target.x + target.width
      );
      overlap = horizOverlap.overlap;
      edgeOffset = horizOverlap.offset;
      snapX = dragged.x;

      if (overlap < config.minOverlap) {
        if (dragged.x > target.x + target.width - config.minOverlap) {
          snapX = target.x + target.width - config.minOverlap - dragged.width;
        } else if (dragged.x + dragged.width < target.x + config.minOverlap) {
          snapX = target.x + config.minOverlap;
        }
      }
      break;
    }
  }

  // Check if offset is within tolerance
  const smallerDimension = Math.min(
    edge === 'left' || edge === 'right' ? dragged.height : dragged.width,
    edge === 'left' || edge === 'right' ? target.height : target.width
  );
  const maxOffset = smallerDimension * config.maxOffsetPercent;
  const isValidOffset = Math.abs(edgeOffset) <= maxOffset;

  // Calculate distance from current position to snap position
  const snapDistance = Math.sqrt(
    (snapX - dragged.x) ** 2 + (snapY - dragged.y) ** 2
  );

  // Calculate actual edge-to-edge distance (how far apart the tables are)
  let edgeToEdgeDistance: number;
  switch (edge) {
    case 'right':
      // Dragged table's left edge to target's right edge
      edgeToEdgeDistance = dragged.x - (target.x + target.width);
      break;
    case 'left':
      // Dragged table's right edge to target's left edge
      edgeToEdgeDistance = target.x - (dragged.x + dragged.width);
      break;
    case 'bottom':
      // Dragged table's top edge to target's bottom edge
      edgeToEdgeDistance = dragged.y - (target.y + target.height);
      break;
    case 'top':
      // Dragged table's bottom edge to target's top edge
      edgeToEdgeDistance = target.y - (dragged.y + dragged.height);
      break;
  }

  // Tables must be close (within snap trigger distance) AND have valid offset/overlap
  // edgeToEdgeDistance can be negative (overlapping) or positive (gap)
  // We allow snapping when the gap is small OR tables are slightly overlapping
  const isCloseEnough = edgeToEdgeDistance < config.snapTriggerDistance && edgeToEdgeDistance > -config.snapTriggerDistance;

  return {
    targetTableId: target.id,
    targetEdge: edge,
    snapPosition: { x: snapX, y: snapY },
    edgeOffset,
    snapDistance,
    isValid: isValidOffset && overlap >= config.minOverlap && isCloseEnough,
  };
}

/**
 * Find the best snap position for a dragged table
 *
 * @param draggedTable - The table being dragged (with current drag position)
 * @param targetTables - All potential target tables
 * @param config - Snap configuration
 * @returns Best snap preview, or null if no valid snap
 */
export function findBestSnap(
  draggedTable: TableRect,
  targetTables: TableRect[],
  config: Partial<SnapConfig> = {}
): SnapPreview | null {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const draggedCenter = getCenter(draggedTable);

  let bestSnap: SnapPreview | null = null;
  let bestDistance = Infinity;

  for (const target of targetTables) {
    // Skip self
    if (target.id === draggedTable.id) continue;

    // Quick distance check - skip if too far
    const targetCenter = getCenter(target);
    const roughDistance = Math.sqrt(
      (draggedCenter.x - targetCenter.x) ** 2 +
      (draggedCenter.y - targetCenter.y) ** 2
    );

    // If centers are too far apart, skip detailed calculation
    const maxReach = Math.max(draggedTable.width, draggedTable.height, target.width, target.height);
    if (roughDistance > maxReach + fullConfig.snapTriggerDistance * 2) {
      continue;
    }

    // Check all four edges
    const edges: SnapEdge[] = ['top', 'bottom', 'left', 'right'];

    for (const edge of edges) {
      const snap = calculateSnapToEdge(draggedTable, target, edge, fullConfig);

      if (snap && snap.isValid && snap.snapDistance < fullConfig.snapTriggerDistance) {
        if (snap.snapDistance < bestDistance) {
          bestDistance = snap.snapDistance;
          bestSnap = snap;
        }
      }
    }
  }

  return bestSnap;
}

/**
 * Get CSS transform for snap preview animation
 */
export function getSnapPreviewStyle(
  originalPosition: { x: number; y: number },
  snapPosition: { x: number; y: number }
): React.CSSProperties {
  const dx = snapPosition.x - originalPosition.x;
  const dy = snapPosition.y - originalPosition.y;

  return {
    transform: `translate(${dx}px, ${dy}px)`,
    transition: 'transform 0.15s ease-out',
  };
}

/**
 * Check if two tables would be validly connected at a snap position
 */
export function validateConnection(
  table1: TableRect,
  table2: TableRect,
  config: Partial<SnapConfig> = {}
): { isValid: boolean; edge: SnapEdge | null; overlap: number } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Check each possible connection
  const edges: SnapEdge[] = ['top', 'bottom', 'left', 'right'];

  for (const edge of edges) {
    const snap = calculateSnapToEdge(table1, table2, edge, fullConfig);
    if (snap && snap.isValid && snap.snapDistance < 5) {
      // Tables are touching
      return {
        isValid: true,
        edge,
        overlap: Math.abs(snap.edgeOffset),
      };
    }
  }

  return { isValid: false, edge: null, overlap: 0 };
}

/**
 * Drag-to-Combine Utilities
 *
 * Handles gesture detection and target finding for drag-to-combine.
 */

export interface DragState {
  isDragging: boolean;
  draggedTableId: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  offsetX: number; // Offset from table center to pointer
  offsetY: number;
}

export interface DropTarget {
  tableId: string;
  tableName: string;
  distance: number; // Distance from dragged table center to target center
  edge: 'top' | 'bottom' | 'left' | 'right'; // Closest edge
}

export interface TableBounds {
  id: string;
  name: string;
  x: number; // posX
  y: number; // posY
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * Convert table data to bounds for hit testing
 */
export function getTableBounds(table: {
  id: string;
  name: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
}): TableBounds {
  return {
    id: table.id,
    name: table.name,
    x: table.posX,
    y: table.posY,
    width: table.width,
    height: table.height,
    centerX: table.posX + table.width / 2,
    centerY: table.posY + table.height / 2,
  };
}

/**
 * Find the closest edge of target table to the dragged table
 */
function findClosestEdge(
  draggedCenter: { x: number; y: number },
  target: TableBounds
): 'top' | 'bottom' | 'left' | 'right' {
  const dx = draggedCenter.x - target.centerX;
  const dy = draggedCenter.y - target.centerY;

  // Determine which edge is closest based on angle
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy > 0 ? 'bottom' : 'top';
  }
}

/**
 * Calculate distance between two points
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Check if a point is within a table's bounds (with padding)
 */
export function isPointInTable(
  x: number,
  y: number,
  table: TableBounds,
  padding: number = 0
): boolean {
  return (
    x >= table.x - padding &&
    x <= table.x + table.width + padding &&
    y >= table.y - padding &&
    y <= table.y + table.height + padding
  );
}

/**
 * Find potential drop target for a dragged table
 *
 * @param draggedTableId - ID of the table being dragged
 * @param dragX - Current X position of dragged table center
 * @param dragY - Current Y position of dragged table center
 * @param allTables - All tables to check against
 * @param snapDistance - Max distance to consider a valid drop target (pixels)
 * @returns DropTarget if found, null otherwise
 */
export function findDropTarget(
  draggedTableId: string,
  dragX: number,
  dragY: number,
  allTables: Array<{
    id: string;
    name: string;
    posX: number;
    posY: number;
    width: number;
    height: number;
    virtualGroupId?: string | null;
    combinedWithId?: string | null;
  }>,
  snapDistance: number = 60 // pixels
): DropTarget | null {
  let closest: DropTarget | null = null;
  let minDist = Infinity;

  for (const table of allTables) {
    // Skip the dragged table itself
    if (table.id === draggedTableId) continue;

    // NOTE: We DO allow dropping onto tables in virtual groups
    // This enables adding more tables to an existing group

    // Skip tables that are physically combined (database-level combining)
    if (table.combinedWithId) continue;

    const bounds = getTableBounds(table);

    // Calculate distance from drag position to table edge (not center)
    // This makes it easier to "connect" tables
    const edgeDistX = Math.max(0, Math.abs(dragX - bounds.centerX) - bounds.width / 2);
    const edgeDistY = Math.max(0, Math.abs(dragY - bounds.centerY) - bounds.height / 2);
    const edgeDist = Math.sqrt(edgeDistX ** 2 + edgeDistY ** 2);

    if (edgeDist < snapDistance && edgeDist < minDist) {
      minDist = edgeDist;
      closest = {
        tableId: table.id,
        tableName: table.name,
        distance: edgeDist,
        edge: findClosestEdge({ x: dragX, y: dragY }, bounds),
      };
    }
  }

  return closest;
}

/**
 * Create initial drag state
 */
export function createDragState(
  tableId: string,
  tableCenterX: number,
  tableCenterY: number,
  pointerX: number,
  pointerY: number
): DragState {
  return {
    isDragging: true,
    draggedTableId: tableId,
    startX: pointerX,
    startY: pointerY,
    currentX: pointerX,
    currentY: pointerY,
    offsetX: pointerX - tableCenterX,
    offsetY: pointerY - tableCenterY,
  };
}

/**
 * Update drag state with new pointer position
 */
export function updateDragState(
  state: DragState,
  pointerX: number,
  pointerY: number
): DragState {
  return {
    ...state,
    currentX: pointerX,
    currentY: pointerY,
  };
}

/**
 * Get the visual position for the dragged table
 */
export function getDraggedTablePosition(state: DragState): { x: number; y: number } {
  return {
    x: state.currentX - state.offsetX,
    y: state.currentY - state.offsetY,
  };
}

/**
 * Reset drag state
 */
export function resetDragState(): DragState {
  return {
    isDragging: false,
    draggedTableId: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    offsetX: 0,
    offsetY: 0,
  };
}

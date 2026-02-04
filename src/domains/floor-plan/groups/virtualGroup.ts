/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Virtual Group Selection
 *
 * Handles long-hold selection flow for creating virtual groups
 */

import { VirtualGroupSelection, MERGE_CONSTANTS } from './types';

// Global selection state
let selectionState: VirtualGroupSelection = {
  isSelecting: false,
  selectedTableIds: [],
  startedAt: null,
};

// Long-hold timer reference
let longHoldTimer: NodeJS.Timeout | null = null;

// Callbacks for selection changes
type SelectionChangeCallback = (state: VirtualGroupSelection) => void;
const selectionChangeCallbacks: Set<SelectionChangeCallback> = new Set();

/**
 * Register a callback for selection state changes
 */
export function onSelectionChange(callback: SelectionChangeCallback): () => void {
  selectionChangeCallbacks.add(callback);
  // Return unsubscribe function
  return () => {
    selectionChangeCallbacks.delete(callback);
  };
}

/**
 * Notify all callbacks of state change
 */
function notifySelectionChange(): void {
  selectionChangeCallbacks.forEach((cb) => cb({ ...selectionState }));
}

/**
 * Start long-hold gesture on a table
 */
export function startLongHold(
  tableId: string,
  onLongHoldComplete: () => void
): void {
  // Clear any existing timer
  if (longHoldTimer) {
    clearTimeout(longHoldTimer);
  }

  // Start new timer
  longHoldTimer = setTimeout(() => {
    startVirtualSelection(tableId);
    onLongHoldComplete();
  }, MERGE_CONSTANTS.LONG_HOLD_DURATION_MS);
}

/**
 * Cancel long-hold gesture (e.g., on pointer up or move)
 */
export function cancelLongHold(): void {
  if (longHoldTimer) {
    clearTimeout(longHoldTimer);
    longHoldTimer = null;
  }
}

/**
 * Start virtual group selection mode
 */
export function startVirtualSelection(tableId: string): void {
  selectionState = {
    isSelecting: true,
    selectedTableIds: [tableId],
    startedAt: new Date(),
  };
  notifySelectionChange();
}

/**
 * Add table to current virtual selection
 */
export function addToVirtualSelection(tableId: string): void {
  if (!selectionState.isSelecting) {
    return;
  }

  if (!selectionState.selectedTableIds.includes(tableId)) {
    selectionState.selectedTableIds.push(tableId);
    notifySelectionChange();
  }
}

/**
 * Remove table from current virtual selection
 */
export function removeFromVirtualSelection(tableId: string): void {
  if (!selectionState.isSelecting) {
    return;
  }

  const index = selectionState.selectedTableIds.indexOf(tableId);
  if (index > -1) {
    selectionState.selectedTableIds.splice(index, 1);
    notifySelectionChange();
  }
}

/**
 * Toggle table in virtual selection
 */
export function toggleVirtualSelection(tableId: string): void {
  if (selectionState.selectedTableIds.includes(tableId)) {
    removeFromVirtualSelection(tableId);
  } else {
    addToVirtualSelection(tableId);
  }
}

/**
 * Get current virtual selection state
 */
export function getVirtualSelectionState(): VirtualGroupSelection {
  return { ...selectionState };
}

/**
 * Check if currently in selection mode
 */
export function isInSelectionMode(): boolean {
  return selectionState.isSelecting;
}

/**
 * Check if a table is selected
 */
export function isTableSelected(tableId: string): boolean {
  return selectionState.selectedTableIds.includes(tableId);
}

/**
 * Get selected table IDs
 */
export function getSelectedTableIds(): string[] {
  return [...selectionState.selectedTableIds];
}

/**
 * Get count of selected tables
 */
export function getSelectedCount(): number {
  return selectionState.selectedTableIds.length;
}

/**
 * Clear selection and exit selection mode
 */
export function cancelVirtualSelection(): void {
  selectionState = {
    isSelecting: false,
    selectedTableIds: [],
    startedAt: null,
  };
  notifySelectionChange();
}

/**
 * Confirm virtual group creation (returns selected IDs and clears state)
 */
export function confirmVirtualGroup(): string[] {
  const selectedIds = [...selectionState.selectedTableIds];

  // Clear selection state
  cancelVirtualSelection();

  return selectedIds;
}

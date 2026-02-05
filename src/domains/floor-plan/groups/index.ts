/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Public API
 */

// API Service
export { tableGroupAPI, type TableGroupAPI } from './tableGroupAPI';

// Types
export type {
  MergeDetection,
  VirtualGroupSelection,
  CreateGroupParams,
  MergeResult,
  ColorFamilyName,
  TableColorAssignment,
  SnapEdge,
  SnapPreview,
  SnapConfig,
  TableForPerimeter,
  PerimeterSeatResult,
} from './types';
export { MERGE_CONSTANTS } from './types';

// Merge Logic
export {
  detectMergeOpportunity,
  calculateSnapPosition,
  areTablesAdjacent,
} from './mergeLogic';

// Virtual Group Selection
export {
  startLongHold,
  cancelLongHold,
  startVirtualSelection,
  addToVirtualSelection,
  removeFromVirtualSelection,
  toggleVirtualSelection,
  getVirtualSelectionState,
  isInSelectionMode,
  isTableSelected,
  getSelectedTableIds,
  getSelectedCount,
  cancelVirtualSelection,
  confirmVirtualGroup,
  onSelectionChange,
} from './virtualGroup';

// Color Palette
export {
  COLOR_FAMILIES,
  getColorFamilyNames,
  getColorFamily,
  getColorFamilyForGroup,
  getTableColor,
  getSeatColor,
  getGroupOutlineColor,
  assignColorsToGroup,
  createColorLookup,
  getColorWithOpacity,
  getGroupGlowStyle,
  getTableBorderStyle,
  type ColorFamily,
} from './colorPalette';

// React Components
export { TableGroup } from './TableGroup';
export { CrossRoomBadge, CrossRoomBadgeCompact } from './CrossRoomBadge';

// Perimeter Seat Renumbering
export * from './perimeterSeats';

// Drag-to-Combine
export * from './dragCombine';

// Snap-to-Edge
export * from './snapEngine';

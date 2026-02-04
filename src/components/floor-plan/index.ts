// Floor Plan Components (Skill 106/107 + T017 Premium UI)
export { InteractiveFloorPlan } from './InteractiveFloorPlan'
export { TableShape } from './TableShape'
export { SeatDot } from './SeatDot'
export { SectionBackground } from './SectionBackground'

// Premium UI Components (T017 + T023)
// FloorPlanHome is THE main order screen - floor plan with inline ordering
export { FloorPlanHome } from './FloorPlanHome'
export { TableNode } from './TableNode'
export { TableInfoPanel } from './TableInfoPanel'
export { CategoriesBar } from './CategoriesBar'

// Unified Floor Plan (T019 - Consolidation)
// UnifiedFloorPlan is the shared component for admin and POS modes
export { UnifiedFloorPlan } from './UnifiedFloorPlan'
export { FloorPlanTable } from './FloorPlanTable'
export { SeatNode, TableSeats } from './SeatNode'
export { TableEditPanel } from './panels/TableEditPanel'
export { PropertiesSidebar } from './PropertiesSidebar'
export { RoomTabs } from './RoomTabs'
export { AddRoomModal } from './AddRoomModal'
export { VirtualGroupManagerModal } from './VirtualGroupManagerModal'
export { SectionSettings } from './SectionSettings'
export { RoomReorderModal } from './RoomReorderModal'

// Seat Components (Skill 121 - Atomic Seat Management)
export { SeatOrbiter, SeatBar, SeatStatusLegend } from './SeatOrbiter'

// Entertainment Visuals
export { EntertainmentVisual, ENTERTAINMENT_VISUAL_OPTIONS } from './entertainment-visuals'
export type { EntertainmentVisualType } from './entertainment-visuals'
export { AddEntertainmentPalette } from './AddEntertainmentPalette'
export { FloorPlanEntertainment } from './FloorPlanEntertainment'

// V2 Floor Plan Components (Clean architecture with server-side geometry)
export { FloorPlanHomeV2 } from './FloorPlanHomeV2'
export { FloorPlanTableV2 } from './FloorPlanTableV2'
export { VirtualGroupToolbar } from './VirtualGroupToolbar'
export { OrderPanelV2 } from './OrderPanelV2'
export { MenuSelectorV2 } from './MenuSelectorV2'
export {
  useFloorPlanStore as useFloorPlanStoreV2,
  type FloorPlanTable as FloorPlanTableV2Type,
  type FloorPlanSeat as FloorPlanSeatV2,
  type OrderItem as OrderItemV2,
  type ActiveOrder as ActiveOrderV2,
} from './useFloorPlanStore'

export {
  useFloorPlanStore,
  type FloorPlanTable as FloorPlanTableType,
  type FloorPlanSeat,
  type FloorPlanSection,
  type FloorPlanElement,
  type TableStatus,
  type ElementStatus,
  type SeatPattern,
} from './use-floor-plan'

/**
 * Floor Plan Domain
 *
 * Manages WHERE everything is and WHO sits where.
 *
 * Layers:
 * - L1: Floor Canvas (rooms, grid, fixtures)
 * - L2: Tables & Smart Objects (tables, entertainment)
 * - L3: Seats (auto-positioned around objects)
 * - L4: Table Groups (physical merge, virtual combine)
 * - L5: Admin & Persistence (blueprint vs live state)
 * - L6: Staff Roles (sections, assignments)
 * - L7: Status Engine (15-status state machine)
 * - L8: Entertainment (timed rentals, sessions)
 * - L9: Waitlist (queue management)
 *
 * This domain NEVER handles order logic directly.
 * It communicates with Order Management through the floor-to-order bridge.
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type {
  Table,
  TableShape,
  TableStatus,
  Seat,
  SeatPosition,
  Room,
  FloorPlan,
  Fixture,
  FixtureType,
  TableGroup,
  GroupColor,
  Section,
  SectionAssignment,
  StatusTransition,
  StatusTrigger,
  TimedRental,
  EntertainmentType,
  RentalStatus,
  WaitlistEntry,
  WaitlistStatus,
  WaitlistPreferences,
} from './types'

// =============================================================================
// PUBLIC HOOKS
// =============================================================================

export { useFloorPlan } from './hooks/useFloorPlan'
export { useSeating } from './hooks/useSeating'
export { useTableGroups } from './hooks/useTableGroups'

// =============================================================================
// PUBLIC SERVICES
// =============================================================================

// Table Service (L2)
export {
  getTablesForLocation,
  getTableById,
  getTablesForSection,
  updateTablePosition,
  updateTableStatus,
  toTableRect,
  toTableRectArray,
  getPrimaryTableId,
  getPrimaryTable,
  isPhysicalGroup,
  isVirtualGroup,
  isPrimaryTable,
} from './services/table-service'

// Seat Service (L3)
export {
  getSeatsForTable,
  getSeatById,
  autoGenerateSeats,
  addVirtualSeat,
  updateSeatOccupancy,
  calculateSeatBalance,
  determineSeatStatus,
  SEAT_STATUS_COLORS,
  SEAT_STATUS_BG_COLORS,
  SEAT_STATUS_GLOW,
} from './services/seat-service'

export type { SeatStatus, SeatInfo, OrderItemForSeat, PaymentForSeat } from './services/seat-service'

// Group Service (L4)
export {
  getGroupsForLocation,
  getGroupById,
  createVirtualGroup,
  createPhysicalGroup,
  dissolveGroup,
  addTableToGroup,
  removeTableFromGroup,
} from './services/group-service'

// Status Engine (L7)
export {
  isValidTransition,
  getValidNextStatuses,
  getNextStatusForTrigger,
  isAutomaticTransition,
  getTransitionTimeout,
  getStatusDisplay,
  isDiningState,
  canSeatGuests,
  needsAttention,
} from './services/status-engine'

// =============================================================================
// PUBLIC COMPONENTS (to be migrated)
// =============================================================================

// Components will be migrated incrementally
// export { FloorPlanCanvas } from './components/FloorPlanCanvas'
// export { TableNode } from './components/TableNode'
// export { SeatNode } from './components/SeatNode'

// =============================================================================
// CONSTANTS
// =============================================================================

export const TABLE_STATUSES = [
  'available',
  'seating',
  'occupied',
  'ordering',
  'food_pending',
  'food_served',
  'dessert',
  'check_requested',
  'check_dropped',
  'paid',
  'dirty',
  'bussing',
  'reserved',
  'blocked',
  'combined',
] as const

export const ENTERTAINMENT_TYPES = [
  'pool',
  'darts',
  'karaoke',
  'arcade',
  'bowling',
  'shuffleboard',
] as const

export const GROUP_COLORS = [
  'blue',
  'green',
  'orange',
  'purple',
  'pink',
  'yellow',
  'cyan',
  'red',
] as const

export const TABLE_SHAPES = [
  'square',
  'round',
  'rectangle',
  'oval',
  'booth',
  'bar_seat',
  'high_top',
  'custom',
] as const

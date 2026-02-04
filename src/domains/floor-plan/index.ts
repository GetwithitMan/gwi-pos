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

export type { Table, TableShape, TableStatus } from './types'
export type { Seat, SeatPosition } from './types'
export type { Room, FloorPlan } from './types'
export type { TableGroup, GroupColor } from './types'
export type { Section, SectionAssignment } from './types'
export type { WaitlistEntry, WaitlistStatus } from './types'
export type { TimedRental, RentalStatus, EntertainmentType } from './types'

// =============================================================================
// PUBLIC HOOKS
// =============================================================================

// These will be implemented as we migrate existing hooks
// export { useFloorPlan } from './hooks/useFloorPlan'
// export { useTableStatus } from './hooks/useTableStatus'
// export { useSeating } from './hooks/useSeating'
// export { useWaitlist } from './hooks/useWaitlist'
// export { useEntertainment } from './hooks/useEntertainment'

// =============================================================================
// PUBLIC COMPONENTS
// =============================================================================

// These will be implemented as we migrate existing components
// export { FloorPlanCanvas } from './components/FloorPlanCanvas'
// export { TableNode } from './components/TableNode'
// export { SeatNode } from './components/SeatNode'
// export { WaitlistPanel } from './components/WaitlistPanel'

// =============================================================================
// PUBLIC SERVICES
// =============================================================================

// These will be implemented as we migrate existing lib functions
// export { FloorPlanService } from './services/FloorPlanService'
// export { TableService } from './services/TableService'
// export { SeatService } from './services/SeatService'
// export { StatusEngine } from './services/StatusEngine'
// export { EntertainmentService } from './services/EntertainmentService'

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

/**
 * Floor Plan Domain Types
 *
 * These types define the public contract for the Floor Plan domain.
 * Other domains should import types from the domain index, not directly from here.
 */

// =============================================================================
// L1: FLOOR CANVAS
// =============================================================================

export interface Room {
  id: string
  locationId: string
  name: string
  sortOrder: number
  gridWidth: number
  gridHeight: number
  cellSize: number
  isActive: boolean
}

export interface FloorPlan {
  id: string
  locationId: string
  name: string
  isDefault: boolean
  rooms: Room[]
}

export interface Fixture {
  id: string
  roomId: string
  type: FixtureType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  metadata?: Record<string, unknown>
}

export type FixtureType =
  | 'wall'
  | 'bar_counter'
  | 'pillar'
  | 'railing'
  | 'door'
  | 'fire_exit'
  | 'ada_path'
  | 'window'
  | 'stage'

// =============================================================================
// L2: TABLES & SMART OBJECTS
// =============================================================================

export interface Table {
  id: string
  roomId: string
  name: string
  number: number
  shape: TableShape
  x: number
  y: number
  width: number
  height: number
  rotation: number
  capacity: number
  minCapacity: number
  status: TableStatus
  isActive: boolean
  isEntertainment: boolean
  entertainmentType?: EntertainmentType
}

export type TableShape =
  | 'square'
  | 'round'
  | 'rectangle'
  | 'oval'
  | 'booth'
  | 'bar_seat'
  | 'high_top'
  | 'custom'

export type TableStatus =
  | 'available'
  | 'seating'
  | 'occupied'
  | 'ordering'
  | 'food_pending'
  | 'food_served'
  | 'dessert'
  | 'check_requested'
  | 'check_dropped'
  | 'paid'
  | 'dirty'
  | 'bussing'
  | 'reserved'
  | 'blocked'
  | 'combined'

// =============================================================================
// L3: SEATS
// =============================================================================

export interface Seat {
  id: string
  tableId: string
  number: number
  position: SeatPosition
  isVirtual: boolean
  isOccupied: boolean
  guestId?: string
  orderId?: string
}

export interface SeatPosition {
  angle: number      // Degrees around table center
  distance: number   // Distance from table edge
  x: number          // Computed X position
  y: number          // Computed Y position
}

// =============================================================================
// L4: TABLE GROUPS
// =============================================================================

export interface TableGroup {
  id: string
  locationId: string
  name?: string
  color: GroupColor
  isVirtual: boolean  // true = virtual combine, false = physical merge
  tableIds: string[]
  primaryTableId: string
  createdAt: Date
  createdBy: string
}

export type GroupColor =
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'pink'
  | 'yellow'
  | 'cyan'
  | 'red'

// =============================================================================
// L6: STAFF ROLES
// =============================================================================

export interface Section {
  id: string
  locationId: string
  name: string
  color: string
  tableIds: string[]
  isActive: boolean
}

export interface SectionAssignment {
  id: string
  sectionId: string
  employeeId: string
  shiftId?: string
  assignedAt: Date
  assignedBy: string
}

// =============================================================================
// L7: STATUS ENGINE
// =============================================================================

export interface StatusTransition {
  from: TableStatus
  to: TableStatus
  trigger: StatusTrigger
  automatic: boolean
  timeoutMinutes?: number
}

export type StatusTrigger =
  | 'manual'
  | 'guest_seated'
  | 'order_created'
  | 'order_sent'
  | 'food_ready'
  | 'food_delivered'
  | 'check_requested'
  | 'check_printed'
  | 'payment_complete'
  | 'table_cleared'
  | 'timeout'

// =============================================================================
// L8: ENTERTAINMENT
// =============================================================================

export interface TimedRental {
  id: string
  tableId: string
  locationId: string
  type: EntertainmentType
  status: RentalStatus
  startedAt?: Date
  pausedAt?: Date
  endedAt?: Date
  totalMinutes: number
  pausedMinutes: number
  rate: number
  overtimeRate?: number
  overtimeThreshold?: number
  linkedOrderId?: string
  guestName?: string
  guestPhone?: string
}

export type EntertainmentType =
  | 'pool'
  | 'darts'
  | 'karaoke'
  | 'arcade'
  | 'bowling'
  | 'shuffleboard'

export type RentalStatus =
  | 'available'
  | 'reserved'
  | 'active'
  | 'paused'
  | 'overtime'
  | 'completed'

// =============================================================================
// L9: WAITLIST
// =============================================================================

export interface WaitlistEntry {
  id: string
  locationId: string
  guestName: string
  guestPhone?: string
  partySize: number
  status: WaitlistStatus
  preferences: WaitlistPreferences
  estimatedWaitMinutes?: number
  quotedWaitMinutes?: number
  addedAt: Date
  notifiedAt?: Date
  seatedAt?: Date
  cancelledAt?: Date
  assignedTableId?: string
  notes?: string
}

export type WaitlistStatus =
  | 'waiting'
  | 'notified'
  | 'claiming'
  | 'seated'
  | 'cancelled'
  | 'no_show'

export interface WaitlistPreferences {
  preferredSection?: string
  outdoorOk: boolean
  barOk: boolean
  boothPreferred: boolean
  highChairNeeded: boolean
  wheelchairAccessible: boolean
  vip: boolean
}

/**
 * GWI POS - Floor Plan Domain
 * Shared Types
 *
 * These types are used across all layers of the Floor Plan domain.
 * Do not modify without Domain PM approval.
 */

// Re-export collision detection types and functions
export * from './collisionDetection'

// =============================================================================
// COORDINATE SYSTEM
// =============================================================================

export interface Point {
  x: number; // feet from top-left
  y: number;
}

export interface Dimensions {
  width: number; // feet
  height: number;
}

// =============================================================================
// LAYER 1: FLOOR CANVAS
// =============================================================================

export type RoomType = 'indoor' | 'outdoor' | 'bar' | 'private' | 'patio';

export interface FloorPlan {
  id: string;
  locationId: string;
  name: string;
  type: RoomType;
  widthFeet: number;
  heightFeet: number;
  gridSizeFeet: number; // Snap grid (e.g., 0.5 = 6 inch grid)
  isActive: boolean;
  sortOrder: number;
}

export type FixtureType =
  | 'wall'
  | 'half_wall'
  | 'pillar'
  | 'bar_counter'
  | 'service_counter'
  | 'window'
  | 'door'
  | 'railing'
  | 'stairs'
  | 'stage_platform'
  | 'dance_floor'
  | 'kitchen_boundary'
  | 'restroom'
  | 'fire_exit'
  | 'ada_path'
  | 'planter_builtin'
  | 'custom_fixture';

export type FixtureCategory =
  | 'barrier' // Blocks placement AND movement (walls, pillars)
  | 'surface' // Objects can snap to it (bar counter)
  | 'zone' // Defines area, doesn't block (dance floor)
  | 'passage' // Allows movement (doors, stairs)
  | 'clearance' // Must stay clear (fire exit, ADA path)
  | 'decorative'; // Visual only

export type FixtureGeometry =
  | { type: 'line'; start: Point; end: Point }
  | {
      type: 'rectangle';
      position: Point;
      width: number;
      height: number;
      rotation: number;
    }
  | { type: 'circle'; center: Point; radius: number }
  | { type: 'polygon'; points: Point[] }
  | {
      type: 'arc';
      center: Point;
      radius: number;
      startAngle: number;
      endAngle: number;
    };

export interface Fixture {
  id: string;
  floorPlanId: string;
  roomId: string;
  type: FixtureType;
  category: FixtureCategory;
  label: string;
  geometry: FixtureGeometry;
  color: string;
  opacity: number;
  thickness: number; // Wall thickness in feet
  height: 'full' | 'half' | 'counter' | null;
  blocksPlacement: boolean;
  blocksMovement: boolean;
  snapTarget: boolean; // Can objects snap TO this?
  isActive: boolean;
}

// =============================================================================
// LAYER 2: TABLES & OBJECTS
// =============================================================================

export type ObjectType =
  // Seatable (dining)
  | 'dining_table'
  | 'booth'
  | 'bar_stool'
  | 'bar_rail'
  | 'high_top'
  | 'communal_table'
  // Entertainment
  | 'pool_table'
  | 'dart_board'
  | 'karaoke'
  | 'shuffleboard'
  | 'arcade'
  | 'bowling_lane'
  | 'cornhole'
  // Non-interactive
  | 'portable_planter'
  | 'portable_divider'
  | 'host_stand'
  | 'wait_station'
  | 'pos_terminal'
  | 'dj_booth'
  | 'coat_check'
  | 'high_chair_storage';

export type ObjectCategory = 'seatable' | 'entertainment' | 'decorative' | 'service';

export type TableShape = 'square' | 'rectangle' | 'circle' | 'booth' | 'bar';

export interface EntertainmentConfig {
  hourlyRate: number;
  minimumMinutes: number;
  overtimeMultiplier: number;
  requiresDeposit: boolean;
  depositAmount: number;
}

export interface Table {
  id: string;
  locationId: string;
  floorPlanId: string;
  sectionId: string | null;

  // Identity
  label: string;
  objectType: ObjectType;
  category: ObjectCategory;
  shape: TableShape;

  // Position & size (in feet)
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number; // degrees

  // Capacity
  minCapacity: number;
  maxCapacity: number;
  defaultCapacity: number;

  // State
  isActive: boolean;
  isReservable: boolean;
  sortOrder: number;

  // Visual
  color: string | null; // Override color (from status)

  // Entertainment-specific
  entertainmentConfig: EntertainmentConfig | null;
}

// =============================================================================
// LAYER 3: SEATS
// =============================================================================

export interface Seat {
  id: string;
  tableId: string;
  locationId: string;

  seatNumber: number; // Display number (1, 2, 3...)
  positionIndex: number; // Position around table (0-N)

  // Position relative to table center
  offsetX: number; // feet from table center
  offsetY: number;
  angle: number; // degrees from table center

  // State
  isOccupied: boolean;
  isVirtual: boolean; // Added during service, removed on close
  orderId: string | null; // Future: per-seat ticketing
  guestName: string | null;

  isActive: boolean;
}

// =============================================================================
// LAYER 6: STAFF
// =============================================================================

export type StaffRole = 'hostess' | 'server' | 'bartender' | 'busser' | 'manager' | 'food_runner';

export interface StaffAssignment {
  id: string;
  staffId: string;
  staffName: string;
  role: StaffRole;
  sectionId: string | null;
  tableIds: string[];
  shiftStart: Date;
  shiftEnd: Date | null;
  isActive: boolean;
}

export interface Section {
  id: string;
  name: string;
  roomId: string;
  tableIds: string[];
  assignedStaffId: string | null;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

// =============================================================================
// LAYER 7: TABLE STATUS
// =============================================================================

export type TableStatus =
  | 'available'
  | 'reserved'
  | 'seating'
  | 'seated'
  | 'occupied'
  | 'ordering'
  | 'food_pending'
  | 'food_served'
  | 'check_requested'
  | 'check_dropped'
  | 'paid'
  | 'dirty'
  | 'bussing'
  | 'blocked'
  | 'closed';

export const STATUS_COLORS: Record<TableStatus, string> = {
  available: '#FFFFFF',
  reserved: '#F0E6FF',
  seating: '#FFF9C4',
  seated: '#E3F2FD',
  occupied: '#E3F2FD',
  ordering: '#BBDEFB',
  food_pending: '#FFE0B2',
  food_served: '#C8E6C9',
  check_requested: '#FFCDD2',
  check_dropped: '#EF9A9A',
  paid: '#A5D6A7',
  dirty: '#D7CCC8',
  bussing: '#FFCC80',
  blocked: '#9E9E9E',
  closed: '#616161',
};

// Valid status transitions
export const STATUS_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  available: ['reserved', 'seating', 'blocked'],
  reserved: ['seating', 'available'],
  seating: ['seated', 'available'],
  seated: ['ordering', 'occupied'],
  occupied: ['ordering'],
  ordering: ['food_pending'],
  food_pending: ['food_served'],
  food_served: ['check_requested'],
  check_requested: ['check_dropped'],
  check_dropped: ['paid'],
  paid: ['dirty'],
  dirty: ['bussing'],
  bussing: ['available'],
  blocked: ['available'],
  closed: ['available'],
};

// =============================================================================
// LAYER 8: ENTERTAINMENT
// =============================================================================

export type EntertainmentStatus = 'available' | 'reserved' | 'in_use' | 'overtime' | 'maintenance' | 'closed';

export interface EntertainmentSession {
  id: string;
  objectId: string;
  guestName: string;
  guestCount: number;

  startedAt: Date;
  endedAt: Date | null;
  bookedMinutes: number;
  pausedAt: Date | null;
  totalPausedSeconds: number;

  linkedTableId: string | null;
  linkedTicketId: string | null;
  depositCollected: number;

  status: 'active' | 'paused' | 'overtime' | 'ended';
}

export interface EntertainmentPricing {
  objectId: string;
  baseRatePerHour: number;
  minimumMinutes: number;
  overtimeMultiplier: number;
  happyHourRate: number | null;
  happyHourStart: string | null;
  happyHourEnd: string | null;
}

// =============================================================================
// LAYER 9: WAITLIST
// =============================================================================

export type WaitlistStatus = 'waiting' | 'notified' | 'seated' | 'no_show' | 'cancelled' | 'expired';

export interface SeatingPreference {
  indoor: boolean;
  outdoor: boolean;
  bar: boolean;
  booth: boolean;
  highTop: boolean;
  accessible: boolean;
  quietArea: boolean;
  nearEntertainment: boolean;
  specificRoom: string | null;
  specificServer: string | null;
}

export interface WaitlistEntry {
  id: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  seatingPreference: SeatingPreference;

  addedAt: Date;
  estimatedWaitMinutes: number;
  quotedWaitMinutes: number;
  position: number;

  status: WaitlistStatus;

  notifiedAt: Date | null;
  seatedAt: Date | null;
  seatedTableId: string | null;

  notes: string;
  vipFlag: boolean;
  addedBy: string;
}

// =============================================================================
// ALERTS
// =============================================================================

export type AlertType =
  | 'long_wait' // Table has been in status too long
  | 'check_needed' // Guest waiting for check
  | 'busser_needed' // Table needs bussing
  | 'overtime' // Entertainment overtime
  | 'waitlist_ready' // Waitlist guest ready
  | 'reservation_arriving'; // Reservation arriving soon

export interface Alert {
  id: string;
  type: AlertType;
  tableId: string | null;
  message: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

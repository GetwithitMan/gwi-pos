/**
 * GWI POS - Floor Plan Domain
 * Layer 3: Seats API
 *
 * Manages seats around tables. Auto-positions seats based on table shape,
 * handles virtual seats (added during service), and seat renumbering when tables merge.
 */

import type { Seat, TableShape } from '../shared/types';
import { TableAPI } from '../tables';
import { generateSeatPositions, generateBoothSeats } from './seatLayout';

// =============================================================================
// STATE (In production, this would come from the database)
// =============================================================================

let seats: Map<string, Seat> = new Map();

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * Create a new seat
 */
export function createSeat(data: Omit<Seat, 'id'>): Seat {
  const id = `seat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const seat: Seat = {
    id,
    ...data,
  };
  seats.set(id, seat);
  return seat;
}

/**
 * Get a seat by ID
 */
export function getSeat(seatId: string): Seat | null {
  return seats.get(seatId) ?? null;
}

/**
 * Update a seat
 */
export function updateSeat(seatId: string, updates: Partial<Seat>): void {
  const seat = seats.get(seatId);
  if (seat) {
    seats.set(seatId, { ...seat, ...updates });
  }
}

/**
 * Delete a seat
 */
export function deleteSeat(seatId: string): void {
  seats.delete(seatId);
}

// =============================================================================
// QUERY METHODS
// =============================================================================

/**
 * Get all seats for a table
 */
export function getSeatsForTable(tableId: string): Seat[] {
  return Array.from(seats.values())
    .filter((s) => s.tableId === tableId && s.isActive)
    .sort((a, b) => a.seatNumber - b.seatNumber);
}

/**
 * Get occupied seats for a table
 */
export function getOccupiedSeats(tableId: string): Seat[] {
  return getSeatsForTable(tableId).filter((s) => s.isOccupied);
}

/**
 * Get available (unoccupied) seats for a table
 */
export function getAvailableSeats(tableId: string): Seat[] {
  return getSeatsForTable(tableId).filter((s) => !s.isOccupied);
}

// =============================================================================
// AUTO-LAYOUT
// =============================================================================

/**
 * Generate seats for a table with auto-positioning
 */
export function generateSeatsForTable(
  tableId: string,
  count: number,
  shape: TableShape
): Seat[] {
  // Get table info for dimensions
  const table = TableAPI.getTable(tableId);
  if (!table) {
    throw new Error(`Table not found: ${tableId}`);
  }

  // Generate positions based on shape
  let positions;
  if (table.objectType === 'booth') {
    positions = generateBoothSeats(count, table.width, table.height);
  } else {
    positions = generateSeatPositions(shape, count, table.width, table.height);
  }

  // Create seat objects
  const newSeats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    const pos = positions[i];
    const seat = createSeat({
      tableId,
      locationId: table.locationId,
      seatNumber: i + 1,
      positionIndex: i,
      offsetX: pos.offsetX,
      offsetY: pos.offsetY,
      angle: pos.angle,
      isOccupied: false,
      isVirtual: false,
      orderId: null,
      guestName: null,
      isActive: true,
    });
    newSeats.push(seat);
  }

  return newSeats;
}

/**
 * Reposition seats for a table (recalculate based on current table dimensions)
 */
export function repositionSeats(tableId: string): void {
  const table = TableAPI.getTable(tableId);
  if (!table) return;

  const existingSeats = getSeatsForTable(tableId);
  const count = existingSeats.length;

  if (count === 0) return;

  // Generate new positions
  let positions;
  if (table.objectType === 'booth') {
    positions = generateBoothSeats(count, table.width, table.height);
  } else {
    positions = generateSeatPositions(table.shape, count, table.width, table.height);
  }

  // Update each seat with new position
  for (let i = 0; i < count; i++) {
    const seat = existingSeats[i];
    const pos = positions[i];
    updateSeat(seat.id, {
      offsetX: pos.offsetX,
      offsetY: pos.offsetY,
      angle: pos.angle,
      positionIndex: i,
    });
  }
}

// =============================================================================
// VIRTUAL SEATS
// =============================================================================

/**
 * Add a virtual seat to a table (added during service, removed on close)
 */
export function addVirtualSeat(tableId: string): Seat {
  const table = TableAPI.getTable(tableId);
  if (!table) {
    throw new Error(`Table not found: ${tableId}`);
  }

  const existingSeats = getSeatsForTable(tableId);
  const nextSeatNumber = existingSeats.length + 1;

  // Position virtual seat at a reasonable location
  // For now, place it at the end of the current seat arrangement
  const lastSeat = existingSeats[existingSeats.length - 1];
  let offsetX = 0;
  let offsetY = 0;
  let angle = 0;

  if (lastSeat) {
    // Place near last seat with slight offset
    offsetX = lastSeat.offsetX + 1;
    offsetY = lastSeat.offsetY + 1;
    angle = lastSeat.angle;
  } else {
    // First seat, place at default position
    offsetX = 0;
    offsetY = table.height / 2 + 1.5;
    angle = 0;
  }

  const seat = createSeat({
    tableId,
    locationId: table.locationId,
    seatNumber: nextSeatNumber,
    positionIndex: nextSeatNumber - 1,
    offsetX,
    offsetY,
    angle,
    isOccupied: false,
    isVirtual: true,
    orderId: null,
    guestName: null,
    isActive: true,
  });

  return seat;
}

/**
 * Remove a virtual seat
 */
export function removeVirtualSeat(seatId: string): void {
  const seat = seats.get(seatId);
  if (!seat || !seat.isVirtual) {
    throw new Error('Can only remove virtual seats');
  }
  deleteSeat(seatId);
}

/**
 * Clear all virtual seats for a table
 */
export function clearVirtualSeats(tableId: string): void {
  const tableSeats = getSeatsForTable(tableId);
  for (const seat of tableSeats) {
    if (seat.isVirtual) {
      deleteSeat(seat.id);
    }
  }
}

// =============================================================================
// OCCUPANCY
// =============================================================================

/**
 * Set a seat's occupied state
 */
export function setSeatOccupied(
  seatId: string,
  occupied: boolean,
  guestName?: string
): void {
  updateSeat(seatId, {
    isOccupied: occupied,
    guestName: guestName ?? null,
  });
}

// =============================================================================
// MERGE HANDLING
// =============================================================================

/**
 * Renumber seats for merged tables (sequential across all tables)
 * Returns a map of seatId -> new seat number
 */
export function renumberSeatsForMerge(tableIds: string[]): Map<string, number> {
  const renumberMap = new Map<string, number>();
  let currentNumber = 1;

  // Collect all seats from all tables
  for (const tableId of tableIds) {
    const tableSeats = getSeatsForTable(tableId);

    // Sort by current position index to maintain order
    tableSeats.sort((a, b) => a.positionIndex - b.positionIndex);

    // Renumber sequentially
    for (const seat of tableSeats) {
      renumberMap.set(seat.id, currentNumber);
      updateSeat(seat.id, { seatNumber: currentNumber });
      currentNumber++;
    }
  }

  return renumberMap;
}

/**
 * Handle seat displacement when tables are merged at seam edge
 * (Future implementation - for now just reposition seats)
 */
export function handleSeamEdgeDisplacement(
  table1Id: string,
  table2Id: string
): void {
  // For now, just reposition seats for both tables
  repositionSeats(table1Id);
  repositionSeats(table2Id);
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize seats from the database
 */
export function initializeSeats(seatList: Seat[]): void {
  seats.clear();
  for (const seat of seatList) {
    seats.set(seat.id, seat);
  }
}

/**
 * Clear all seats (for testing)
 */
export function clearAll(): void {
  seats.clear();
}

// =============================================================================
// EXPORT THE API
// =============================================================================

export const SeatAPI = {
  // CRUD
  createSeat,
  getSeat,
  updateSeat,
  deleteSeat,

  // Queries
  getSeatsForTable,
  getOccupiedSeats,
  getAvailableSeats,

  // Auto-layout
  generateSeatsForTable,
  repositionSeats,

  // Virtual seats
  addVirtualSeat,
  removeVirtualSeat,
  clearVirtualSeats,

  // Occupancy
  setSeatOccupied,

  // Merge handling
  renumberSeatsForMerge,
  handleSeamEdgeDisplacement,

  // Initialization
  initializeSeats,
  clearAll,
};

export default SeatAPI;

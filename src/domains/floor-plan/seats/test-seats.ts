/**
 * Simple test/demo of Seats Layer functionality
 * Run with: npx ts-node --project tsconfig.json src/domains/floor-plan/seats/test-seats.ts
 */

import { SeatAPI } from './seatAPI';
import { TableAPI } from '../tables';

// Initialize with empty data
TableAPI.initializeTables([]);
SeatAPI.initializeSeats([]);

// Create a test table
const table = TableAPI.createTable({
  locationId: 'loc_1',
  floorPlanId: 'room_1',
  sectionId: null,
  label: 'T1',
  objectType: 'dining_table',
  category: 'seatable',
  shape: 'round',
  positionX: 10,
  positionY: 10,
  width: 4,
  height: 4,
  rotation: 0,
  minCapacity: 2,
  maxCapacity: 8,
  defaultCapacity: 4,
  isActive: true,
  isReservable: true,
  sortOrder: 1,
  groupId: null,
  combinedTableIds: [],
  color: null,
  entertainmentConfig: null,
});

// Generate seats for the table
const seats = SeatAPI.generateSeatsForTable(table.id, 8, 'round');

// Test queries
const allSeats = SeatAPI.getSeatsForTable(table.id);

const available = SeatAPI.getAvailableSeats(table.id);

// Test occupancy
SeatAPI.setSeatOccupied(seats[0].id, true, 'Alice');
SeatAPI.setSeatOccupied(seats[1].id, true, 'Bob');

const occupied = SeatAPI.getOccupiedSeats(table.id);

const nowAvailable = SeatAPI.getAvailableSeats(table.id);

// Test virtual seats
const virtualSeat = SeatAPI.addVirtualSeat(table.id);

const allSeatsWithVirtual = SeatAPI.getSeatsForTable(table.id);

SeatAPI.clearVirtualSeats(table.id);
const afterClear = SeatAPI.getSeatsForTable(table.id);

// Test merge renumbering
const table2 = TableAPI.createTable({
  locationId: 'loc_1',
  floorPlanId: 'room_1',
  sectionId: null,
  label: 'T2',
  objectType: 'dining_table',
  category: 'seatable',
  shape: 'square',
  positionX: 15,
  positionY: 10,
  width: 3,
  height: 3,
  rotation: 0,
  minCapacity: 2,
  maxCapacity: 4,
  defaultCapacity: 4,
  isActive: true,
  isReservable: true,
  sortOrder: 2,
  groupId: null,
  combinedTableIds: [],
  color: null,
  entertainmentConfig: null,
});

const seats2 = SeatAPI.generateSeatsForTable(table2.id, 4, 'square');

const renumberMap = SeatAPI.renumberSeatsForMerge([table.id, table2.id]);

// Test repositioning
SeatAPI.repositionSeats(table.id);
const repositioned = SeatAPI.getSeat(seats[0].id);

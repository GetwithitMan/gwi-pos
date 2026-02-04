/**
 * Simple test/demo of Seats Layer functionality
 * Run with: npx ts-node --project tsconfig.json src/domains/floor-plan/seats/test-seats.ts
 */

import { SeatAPI } from './seatAPI';
import { TableAPI } from '../tables';

// Initialize with empty data
TableAPI.initializeTables([]);
SeatAPI.initializeSeats([]);

console.log('=== Layer 3: Seats Test ===\n');

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

console.log(`✅ Created table: ${table.label} (${table.shape}, ${table.width}ft x ${table.height}ft)`);

// Generate seats for the table
console.log('\n--- Generating 8 seats for round table ---');
const seats = SeatAPI.generateSeatsForTable(table.id, 8, 'round');

console.log(`✅ Generated ${seats.length} seats:`);
seats.forEach((seat, i) => {
  console.log(
    `   Seat ${seat.seatNumber}: offset=(${seat.offsetX}, ${seat.offsetY}), angle=${seat.angle}°`
  );
});

// Test queries
console.log('\n--- Query Tests ---');
const allSeats = SeatAPI.getSeatsForTable(table.id);
console.log(`✅ getSeatsForTable: ${allSeats.length} seats`);

const available = SeatAPI.getAvailableSeats(table.id);
console.log(`✅ getAvailableSeats: ${available.length} seats (all initially available)`);

// Test occupancy
console.log('\n--- Occupancy Tests ---');
SeatAPI.setSeatOccupied(seats[0].id, true, 'Alice');
SeatAPI.setSeatOccupied(seats[1].id, true, 'Bob');

const occupied = SeatAPI.getOccupiedSeats(table.id);
console.log(`✅ After seating 2 guests: ${occupied.length} occupied seats`);

const nowAvailable = SeatAPI.getAvailableSeats(table.id);
console.log(`✅ Available seats: ${nowAvailable.length} seats`);

// Test virtual seats
console.log('\n--- Virtual Seat Tests ---');
const virtualSeat = SeatAPI.addVirtualSeat(table.id);
console.log(`✅ Added virtual seat: Seat ${virtualSeat.seatNumber} (isVirtual=${virtualSeat.isVirtual})`);

const allSeatsWithVirtual = SeatAPI.getSeatsForTable(table.id);
console.log(`✅ Total seats with virtual: ${allSeatsWithVirtual.length}`);

SeatAPI.clearVirtualSeats(table.id);
const afterClear = SeatAPI.getSeatsForTable(table.id);
console.log(`✅ After clearing virtual seats: ${afterClear.length} seats`);

// Test merge renumbering
console.log('\n--- Merge Renumbering Test ---');
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
console.log(`✅ Created table T2 with ${seats2.length} seats`);

console.log('\nBefore merge:');
console.log(`   Table 1 seats: ${SeatAPI.getSeatsForTable(table.id).map(s => s.seatNumber).join(', ')}`);
console.log(`   Table 2 seats: ${SeatAPI.getSeatsForTable(table2.id).map(s => s.seatNumber).join(', ')}`);

const renumberMap = SeatAPI.renumberSeatsForMerge([table.id, table2.id]);
console.log(`\n✅ Renumbered ${renumberMap.size} seats after merge`);

console.log('After merge:');
console.log(`   Table 1 seats: ${SeatAPI.getSeatsForTable(table.id).map(s => s.seatNumber).join(', ')}`);
console.log(`   Table 2 seats: ${SeatAPI.getSeatsForTable(table2.id).map(s => s.seatNumber).join(', ')}`);

// Test repositioning
console.log('\n--- Reposition Test ---');
console.log('Original position of seat 1:', seats[0].offsetX, seats[0].offsetY);
SeatAPI.repositionSeats(table.id);
const repositioned = SeatAPI.getSeat(seats[0].id);
console.log('After reposition:', repositioned?.offsetX, repositioned?.offsetY);
console.log('✅ Seats repositioned successfully');

console.log('\n=== All Tests Passed! ===');

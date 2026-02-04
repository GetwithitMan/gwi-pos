/**
 * GWI POS - Floor Plan Domain
 * Layer 3: Seats - Public Exports
 */

// API
export { SeatAPI, default as seatAPI } from './seatAPI';
export type {
  createSeat,
  getSeat,
  updateSeat,
  deleteSeat,
  getSeatsForTable,
  getOccupiedSeats,
  getAvailableSeats,
  generateSeatsForTable,
  repositionSeats,
  addVirtualSeat,
  removeVirtualSeat,
  clearVirtualSeats,
  setSeatOccupied,
  renumberSeatsForMerge,
  handleSeamEdgeDisplacement,
  initializeSeats,
  clearAll,
} from './seatAPI';

// Layout engine
export {
  generateSeatPositions,
  generateBoothSeats,
  type SeatPosition,
} from './seatLayout';

// Component
export { Seat, default as SeatComponent } from './Seat';

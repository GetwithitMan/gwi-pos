/**
 * GWI POS - Floor Plan Domain
 * Layer 1: Floor Canvas
 *
 * Public exports for the canvas layer.
 */

export { FloorCanvas, RoomSelector } from './FloorCanvas';
export { FloorCanvasAPI, default as floorCanvasAPI } from './floorCanvasAPI';

// Re-export types used by this layer
export type {
  FloorPlan,
  Fixture,
  FixtureType,
  FixtureCategory,
  FixtureGeometry,
  Point,
  RoomType,
} from '../shared/types';

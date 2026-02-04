/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Merge Logic Tests
 */

import { Table } from '../../shared/types';
import {
  detectMergeOpportunity,
  calculateSnapPosition,
  areTablesAdjacent,
} from '../mergeLogic';

// Helper to create a mock table
function createTable(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): Table {
  return {
    id,
    locationId: 'loc-1',
    floorPlanId: 'room-1',
    sectionId: null,
    label: id,
    objectType: 'dining_table',
    category: 'seatable',
    shape: 'square',
    positionX: x,
    positionY: y,
    width,
    height,
    rotation: 0,
    minCapacity: 2,
    maxCapacity: 4,
    defaultCapacity: 4,
    isActive: true,
    isReservable: true,
    sortOrder: 0,
    groupId: null,
    combinedTableIds: [],
    color: null,
    entertainmentConfig: null,
  };
}

describe('Merge Logic', () => {
  describe('detectMergeOpportunity', () => {
    it('should detect snap to right edge', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 4, 0, 3, 3);
      const dragPos = { x: 3.5, y: 0 };

      const detection = detectMergeOpportunity(table1, table2, dragPos);

      expect(detection.canMerge).toBe(true);
      expect(detection.snapEdge).toBe('left');
      expect(detection.snapPosition).toBeDefined();
    });

    it('should detect snap to bottom edge', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 0, 4, 3, 3);
      const dragPos = { x: 0, y: 3.5 };

      const detection = detectMergeOpportunity(table1, table2, dragPos);

      expect(detection.canMerge).toBe(true);
      expect(detection.snapEdge).toBe('top');
      expect(detection.snapPosition).toBeDefined();
    });

    it('should not detect merge if too far', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 10, 0, 3, 3);
      const dragPos = { x: 3, y: 0 };

      const detection = detectMergeOpportunity(table1, table2, dragPos);

      expect(detection.canMerge).toBe(false);
    });

    it('should not merge with self', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const dragPos = { x: 0, y: 0 };

      const detection = detectMergeOpportunity(table1, table1, dragPos);

      expect(detection.canMerge).toBe(false);
    });

    it('should not merge tables in different rooms', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 3, 0, 3, 3);
      table2.floorPlanId = 'room-2';
      const dragPos = { x: 3, y: 0 };

      const detection = detectMergeOpportunity(table1, table2, dragPos);

      expect(detection.canMerge).toBe(false);
    });
  });

  describe('calculateSnapPosition', () => {
    it('should calculate snap to right edge', () => {
      const target = createTable('t1', 0, 0, 3, 3);
      const dragging = createTable('t2', 5, 0, 3, 3);

      const snapPos = calculateSnapPosition(dragging, target, 'right');

      expect(snapPos).toEqual({ x: 3, y: 0 });
    });

    it('should calculate snap to left edge', () => {
      const target = createTable('t1', 5, 0, 3, 3);
      const dragging = createTable('t2', 0, 0, 3, 3);

      const snapPos = calculateSnapPosition(dragging, target, 'left');

      expect(snapPos).toEqual({ x: 2, y: 0 });
    });

    it('should calculate snap to bottom edge', () => {
      const target = createTable('t1', 0, 0, 3, 3);
      const dragging = createTable('t2', 0, 5, 3, 3);

      const snapPos = calculateSnapPosition(dragging, target, 'bottom');

      expect(snapPos).toEqual({ x: 0, y: 3 });
    });

    it('should calculate snap to top edge', () => {
      const target = createTable('t1', 0, 5, 3, 3);
      const dragging = createTable('t2', 0, 0, 3, 3);

      const snapPos = calculateSnapPosition(dragging, target, 'top');

      expect(snapPos).toEqual({ x: 0, y: 2 });
    });
  });

  describe('areTablesAdjacent', () => {
    it('should detect horizontal adjacency', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 3, 0, 3, 3);

      expect(areTablesAdjacent(table1, table2)).toBe(true);
    });

    it('should detect vertical adjacency', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 0, 3, 3, 3);

      expect(areTablesAdjacent(table1, table2)).toBe(true);
    });

    it('should not detect if not touching', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 5, 0, 3, 3);

      expect(areTablesAdjacent(table1, table2)).toBe(false);
    });

    it('should not detect if only corners touch', () => {
      const table1 = createTable('t1', 0, 0, 3, 3);
      const table2 = createTable('t2', 3, 3, 3, 3);

      expect(areTablesAdjacent(table1, table2)).toBe(false);
    });
  });
});

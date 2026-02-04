/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - API Tests
 */

import { tableGroupAPI } from '../tableGroupAPI';
import { clearColorAssignments } from '../colorPalette';

describe('TableGroupAPI', () => {
  beforeEach(() => {
    // Clear all groups and color assignments before each test
    tableGroupAPI.clearAll();
    clearColorAssignments();
  });

  describe('Physical Merge', () => {
    it('should create a physical merge group', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      expect(group).toBeDefined();
      expect(group.id).toBeDefined();
      expect(group.isVirtual).toBe(false);
      expect(group.tableIds).toEqual(['table-1', 'table-2']);
      expect(group.color).toBeDefined();
    });

    it('should not allow merging less than 2 tables', () => {
      expect(() => {
        tableGroupAPI.createPhysicalMerge(['table-1']);
      }).toThrow('Physical merge requires at least 2 tables');
    });

    it('should not allow merging already grouped tables', () => {
      tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      expect(() => {
        tableGroupAPI.createPhysicalMerge(['table-1', 'table-3']);
      }).toThrow('Table table-1 is already in a group');
    });
  });

  describe('Virtual Group', () => {
    it('should create a virtual group', () => {
      const group = tableGroupAPI.createVirtualGroup(['table-1', 'table-3']);

      expect(group).toBeDefined();
      expect(group.id).toBeDefined();
      expect(group.isVirtual).toBe(true);
      expect(group.tableIds).toEqual(['table-1', 'table-3']);
      expect(group.color).toBeDefined();
    });

    it('should not allow grouping less than 2 tables', () => {
      expect(() => {
        tableGroupAPI.createVirtualGroup(['table-1']);
      }).toThrow('Virtual group requires at least 2 tables');
    });
  });

  describe('Dissolve Group', () => {
    it('should dissolve a group', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      tableGroupAPI.dissolveGroup(group.id);

      expect(tableGroupAPI.getGroup(group.id)).toBeNull();
      expect(tableGroupAPI.getGroupForTable('table-1')).toBeNull();
      expect(tableGroupAPI.getGroupForTable('table-2')).toBeNull();
    });

    it('should throw if group not found', () => {
      expect(() => {
        tableGroupAPI.dissolveGroup('non-existent');
      }).toThrow('Group non-existent not found');
    });
  });

  describe('Queries', () => {
    it('should get group by ID', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      const found = tableGroupAPI.getGroup(group.id);
      expect(found).toEqual(group);
    });

    it('should get group for table', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      const found1 = tableGroupAPI.getGroupForTable('table-1');
      const found2 = tableGroupAPI.getGroupForTable('table-2');

      expect(found1).toEqual(group);
      expect(found2).toEqual(group);
    });

    it('should return null for ungrouped table', () => {
      const found = tableGroupAPI.getGroupForTable('table-1');
      expect(found).toBeNull();
    });

    it('should get all active groups', () => {
      const group1 = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);
      const group2 = tableGroupAPI.createVirtualGroup(['table-3', 'table-4']);

      const allGroups = tableGroupAPI.getAllActiveGroups();

      expect(allGroups).toHaveLength(2);
      expect(allGroups).toContainEqual(group1);
      expect(allGroups).toContainEqual(group2);
    });
  });

  describe('Membership', () => {
    it('should add table to group', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      tableGroupAPI.addTableToGroup(group.id, 'table-3');

      const updated = tableGroupAPI.getGroup(group.id);
      expect(updated?.tableIds).toEqual(['table-1', 'table-2', 'table-3']);
    });

    it('should remove table from group', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2', 'table-3']);

      tableGroupAPI.removeTableFromGroup(group.id, 'table-3');

      const updated = tableGroupAPI.getGroup(group.id);
      expect(updated?.tableIds).toEqual(['table-1', 'table-2']);
    });

    it('should dissolve group when only 1 table remains', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      tableGroupAPI.removeTableFromGroup(group.id, 'table-2');

      // Group should be dissolved
      expect(tableGroupAPI.getGroup(group.id)).toBeNull();
    });
  });

  describe('Properties', () => {
    it('should set group identifier', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      tableGroupAPI.setGroupIdentifier(group.id, 'Smith-8PM');

      const updated = tableGroupAPI.getGroup(group.id);
      expect(updated?.identifier).toBe('Smith-8PM');
    });

    it('should set group color', () => {
      const group = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      tableGroupAPI.setGroupColor(group.id, '#FF0000');

      const updated = tableGroupAPI.getGroup(group.id);
      expect(updated?.color).toBe('#FF0000');
    });
  });

  describe('Color Cycling', () => {
    it('should assign different colors to groups', () => {
      const group1 = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);
      const group2 = tableGroupAPI.createPhysicalMerge(['table-3', 'table-4']);

      expect(group1.color).not.toBe(group2.color);
    });

    it('should release color on dissolve', () => {
      const group1 = tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);
      const color1 = group1.color;

      tableGroupAPI.dissolveGroup(group1.id);

      const group2 = tableGroupAPI.createPhysicalMerge(['table-3', 'table-4']);

      // Should reuse the released color
      expect(group2.color).toBe(color1);
    });
  });

  describe('Initialization', () => {
    it('should initialize groups from array', () => {
      const mockGroups = [
        {
          id: 'group-1',
          locationId: 'loc-1',
          tableIds: ['table-1', 'table-2'],
          primaryTableId: 'table-1',
          isVirtual: false,
          color: '#E74C3C',
          identifier: 'Group 1',
          combinedCapacity: 8,
          isActive: true,
          createdAt: new Date(),
          createdBy: 'staff-1',
        },
      ];

      tableGroupAPI.initializeGroups(mockGroups);

      const loaded = tableGroupAPI.getGroup('group-1');
      expect(loaded).toEqual(mockGroups[0]);
      expect(tableGroupAPI.getGroupForTable('table-1')).toEqual(mockGroups[0]);
    });

    it('should clear all on initialization', () => {
      tableGroupAPI.createPhysicalMerge(['table-1', 'table-2']);

      tableGroupAPI.initializeGroups([]);

      expect(tableGroupAPI.getAllActiveGroups()).toHaveLength(0);
    });
  });
});

/**
 * GWI POS - Floor Plan Domain
 * Layer 4: Table Groups - Virtual Group Selection Tests
 */

import {
  startVirtualSelection,
  addToVirtualSelection,
  removeFromVirtualSelection,
  toggleVirtualSelection,
  isInSelectionMode,
  isTableSelected,
  getSelectedTableIds,
  getSelectedCount,
  cancelVirtualSelection,
  confirmVirtualGroup,
  onSelectionChange,
} from '../virtualGroup';

describe('Virtual Group Selection', () => {
  beforeEach(() => {
    // Cancel any active selection before each test
    cancelVirtualSelection();
  });

  describe('Selection Mode', () => {
    it('should start selection mode', () => {
      startVirtualSelection('table-1');

      expect(isInSelectionMode()).toBe(true);
      expect(isTableSelected('table-1')).toBe(true);
      expect(getSelectedTableIds()).toEqual(['table-1']);
    });

    it('should add tables to selection', () => {
      startVirtualSelection('table-1');
      addToVirtualSelection('table-2');
      addToVirtualSelection('table-3');

      expect(getSelectedCount()).toBe(3);
      expect(getSelectedTableIds()).toEqual(['table-1', 'table-2', 'table-3']);
    });

    it('should not add duplicate tables', () => {
      startVirtualSelection('table-1');
      addToVirtualSelection('table-2');
      addToVirtualSelection('table-2'); // Duplicate

      expect(getSelectedCount()).toBe(2);
      expect(getSelectedTableIds()).toEqual(['table-1', 'table-2']);
    });

    it('should remove tables from selection', () => {
      startVirtualSelection('table-1');
      addToVirtualSelection('table-2');
      addToVirtualSelection('table-3');

      removeFromVirtualSelection('table-2');

      expect(getSelectedCount()).toBe(2);
      expect(getSelectedTableIds()).toEqual(['table-1', 'table-3']);
    });

    it('should toggle table selection', () => {
      startVirtualSelection('table-1');

      toggleVirtualSelection('table-2');
      expect(isTableSelected('table-2')).toBe(true);

      toggleVirtualSelection('table-2');
      expect(isTableSelected('table-2')).toBe(false);
    });
  });

  describe('Cancel Selection', () => {
    it('should cancel selection and clear state', () => {
      startVirtualSelection('table-1');
      addToVirtualSelection('table-2');

      cancelVirtualSelection();

      expect(isInSelectionMode()).toBe(false);
      expect(getSelectedCount()).toBe(0);
      expect(getSelectedTableIds()).toEqual([]);
    });
  });

  describe('Confirm Group', () => {
    it('should return selected IDs and clear state', () => {
      startVirtualSelection('table-1');
      addToVirtualSelection('table-2');
      addToVirtualSelection('table-3');

      const selectedIds = confirmVirtualGroup();

      expect(selectedIds).toEqual(['table-1', 'table-2', 'table-3']);
      expect(isInSelectionMode()).toBe(false);
      expect(getSelectedCount()).toBe(0);
    });
  });

  describe('Selection Change Callbacks', () => {
    it('should notify callbacks on selection changes', () => {
      const callback = jest.fn();
      const unsubscribe = onSelectionChange(callback);

      startVirtualSelection('table-1');
      expect(callback).toHaveBeenCalledWith({
        isSelecting: true,
        selectedTableIds: ['table-1'],
        startedAt: expect.any(Date),
      });

      addToVirtualSelection('table-2');
      expect(callback).toHaveBeenCalledWith({
        isSelecting: true,
        selectedTableIds: ['table-1', 'table-2'],
        startedAt: expect.any(Date),
      });

      unsubscribe();
      callback.mockClear();

      // Should not be called after unsubscribe
      addToVirtualSelection('table-3');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple callbacks', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      onSelectionChange(callback1);
      onSelectionChange(callback2);

      startVirtualSelection('table-1');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('Query Functions', () => {
    it('should check if table is selected', () => {
      startVirtualSelection('table-1');
      addToVirtualSelection('table-2');

      expect(isTableSelected('table-1')).toBe(true);
      expect(isTableSelected('table-2')).toBe(true);
      expect(isTableSelected('table-3')).toBe(false);
    });

    it('should return selected count', () => {
      expect(getSelectedCount()).toBe(0);

      startVirtualSelection('table-1');
      expect(getSelectedCount()).toBe(1);

      addToVirtualSelection('table-2');
      expect(getSelectedCount()).toBe(2);
    });

    it('should return empty when not selecting', () => {
      expect(isInSelectionMode()).toBe(false);
      expect(getSelectedTableIds()).toEqual([]);
      expect(getSelectedCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle adding when not in selection mode', () => {
      addToVirtualSelection('table-1');

      expect(isInSelectionMode()).toBe(false);
      expect(getSelectedCount()).toBe(0);
    });

    it('should handle removing when not in selection mode', () => {
      removeFromVirtualSelection('table-1');

      expect(isInSelectionMode()).toBe(false);
      expect(getSelectedCount()).toBe(0);
    });

    it('should handle removing non-existent table', () => {
      startVirtualSelection('table-1');

      removeFromVirtualSelection('table-99');

      expect(getSelectedCount()).toBe(1);
      expect(getSelectedTableIds()).toEqual(['table-1']);
    });
  });
});

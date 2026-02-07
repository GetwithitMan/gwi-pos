'use client'

/**
 * useFloorPlan Hook
 *
 * Main hook for floor plan state management.
 * Wraps the existing Zustand store and adds domain-specific functionality.
 */

import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type { Table, TableStatus, Section } from '../types'
import * as TableService from '../services/table-service'
import * as StatusEngine from '../services/status-engine'
import { logger } from '@/lib/logger'

// =============================================================================
// STORE TYPES
// =============================================================================

interface FloorPlanState {
  // Data
  tables: Table[]
  sections: Section[]
  isLoading: boolean
  error: string | null

  // Selection
  selectedTableId: string | null
  selectedSectionId: string | null

  // View
  zoom: number
  panX: number
  panY: number

  // Actions
  setTables: (tables: Table[]) => void
  setSections: (sections: Section[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  selectTable: (tableId: string | null) => void
  selectSection: (sectionId: string | null) => void
  setZoom: (zoom: number) => void
  setPan: (x: number, y: number) => void
  updateTableStatus: (tableId: string, status: TableStatus) => void
  updateTablePosition: (tableId: string, x: number, y: number) => void
}

// =============================================================================
// STORE
// =============================================================================

const useFloorPlanStore = create<FloorPlanState>((set) => ({
  // Initial state
  tables: [],
  sections: [],
  isLoading: false,
  error: null,
  selectedTableId: null,
  selectedSectionId: null,
  zoom: 1,
  panX: 0,
  panY: 0,

  // Actions
  setTables: (tables) => set({ tables }),
  setSections: (sections) => set({ sections }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  selectTable: (selectedTableId) => set({ selectedTableId }),
  selectSection: (selectedSectionId) => set({ selectedSectionId }),
  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(2, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),

  updateTableStatus: (tableId, status) =>
    set((state) => ({
      tables: state.tables.map((t) =>
        t.id === tableId ? { ...t, status } : t
      ),
    })),

  updateTablePosition: (tableId, x, y) =>
    set((state) => ({
      tables: state.tables.map((t) =>
        t.id === tableId ? { ...t, x, y } : t
      ),
    })),
}))

// =============================================================================
// HOOK
// =============================================================================

export function useFloorPlan(locationId?: string) {
  const store = useFloorPlanStore()

  // Load tables on mount
  useEffect(() => {
    if (!locationId) return

    const loadTables = async () => {
      store.setLoading(true)
      store.setError(null)

      try {
        const tables = await TableService.getTablesForLocation(locationId)
        store.setTables(tables)
      } catch (error) {
        store.setError(error instanceof Error ? error.message : 'Failed to load tables')
      } finally {
        store.setLoading(false)
      }
    }

    loadTables()
  }, [locationId])

  // Get selected table
  const selectedTable = store.selectedTableId
    ? store.tables.find((t) => t.id === store.selectedTableId) || null
    : null

  // Get tables for current section
  const tablesInSection = store.selectedSectionId
    ? store.tables.filter((t) => t.sectionId === store.selectedSectionId)
    : store.tables

  // Update table status (with validation)
  const changeTableStatus = useCallback(
    async (tableId: string, newStatus: TableStatus) => {
      const table = store.tables.find((t) => t.id === tableId)
      if (!table) return false

      // Validate transition
      if (!StatusEngine.isValidTransition(table.status, newStatus)) {
        logger.warn(`Invalid status transition: ${table.status} -> ${newStatus}`)
        return false
      }

      // Optimistic update
      store.updateTableStatus(tableId, newStatus)

      try {
        await TableService.updateTableStatus(tableId, newStatus)
        return true
      } catch (error) {
        // Revert on failure
        store.updateTableStatus(tableId, table.status)
        return false
      }
    },
    [store.tables]
  )

  // Move table position
  const moveTable = useCallback(
    async (tableId: string, x: number, y: number) => {
      const table = store.tables.find((t) => t.id === tableId)
      if (!table) return false

      // Optimistic update
      store.updateTablePosition(tableId, x, y)

      try {
        await TableService.updateTablePosition(tableId, x, y)
        return true
      } catch (error) {
        // Revert on failure
        store.updateTablePosition(tableId, table.x, table.y)
        return false
      }
    },
    [store.tables]
  )

  // Zoom controls
  const zoomIn = useCallback(() => {
    store.setZoom(store.zoom + 0.1)
  }, [store.zoom])

  const zoomOut = useCallback(() => {
    store.setZoom(store.zoom - 0.1)
  }, [store.zoom])

  const resetZoom = useCallback(() => {
    store.setZoom(1)
    store.setPan(0, 0)
  }, [])

  // Get status info
  const getTableStatusInfo = useCallback((tableId: string) => {
    const table = store.tables.find((t) => t.id === tableId)
    if (!table) return null

    return {
      ...StatusEngine.getStatusDisplay(table.status),
      validNextStatuses: StatusEngine.getValidNextStatuses(table.status),
      isDining: StatusEngine.isDiningState(table.status),
      canSeat: StatusEngine.canSeatGuests(table.status),
      needsAttention: StatusEngine.needsAttention(table.status),
    }
  }, [store.tables])

  return {
    // State
    tables: store.tables,
    sections: store.sections,
    isLoading: store.isLoading,
    error: store.error,
    selectedTable,
    selectedTableId: store.selectedTableId,
    selectedSectionId: store.selectedSectionId,
    tablesInSection,
    zoom: store.zoom,
    panX: store.panX,
    panY: store.panY,

    // Actions
    selectTable: store.selectTable,
    selectSection: store.selectSection,
    changeTableStatus,
    moveTable,
    zoomIn,
    zoomOut,
    resetZoom,
    setPan: store.setPan,

    // Utilities
    getTableStatusInfo,
  }
}

export default useFloorPlan

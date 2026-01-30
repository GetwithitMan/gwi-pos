import { create } from 'zustand'

// Table status types
export type TableStatus = 'available' | 'occupied' | 'reserved' | 'dirty' | 'in_use'

// Table data from API
export interface FloorPlanTable {
  id: string
  name: string
  capacity: number
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  shape: 'rectangle' | 'circle' | 'square' | 'booth' | 'bar'
  status: TableStatus
  section: { id: string; name: string; color: string } | null
  combinedWithId: string | null
  combinedTableIds: string[] | null
  originalName: string | null
  originalPosX: number | null
  originalPosY: number | null
  isLocked: boolean  // Locked items cannot be moved (bolted down furniture)
  currentOrder: {
    id: string
    orderNumber: number
    guestCount: number
    total: number
    openedAt: string
    server: string
    items?: Array<{
      id: string
      name: string
      quantity: number
      price: number
    }>
  } | null
  seats: FloorPlanSeat[]
}

export interface FloorPlanSeat {
  id: string
  label: string
  seatNumber: number
  relativeX: number
  relativeY: number
  angle: number
  seatType: string
}

export interface FloorPlanSection {
  id: string
  name: string
  color: string
  posX: number
  posY: number
  width: number
  height: number
}

// Undo action for combines
interface UndoAction {
  type: 'combine'
  sourceTableId: string
  targetTableId: string
  timestamp: number
}

interface FloorPlanState {
  // Data
  tables: FloorPlanTable[]
  sections: FloorPlanSection[]

  // View state
  viewportX: number
  viewportY: number
  zoom: number

  // Selection state
  selectedTableId: string | null
  draggedTableId: string | null
  dropTargetTableId: string | null

  // Info panel
  infoPanelTableId: string | null

  // Combine indicator
  showCombineIndicator: boolean
  combinePosition: { x: number; y: number } | null

  // Seat visualization
  showSeats: boolean
  selectedSeat: { tableId: string; seatNumber: number } | null

  // Flash messages for tables (e.g., "OPEN ORDER" on reset skip)
  flashingTables: Map<string, { message: string; expiresAt: number }>

  // Undo stack (30-second window)
  undoStack: UndoAction[]

  // Loading state
  isLoading: boolean
  error: string | null

  // Actions
  setTables: (tables: FloorPlanTable[]) => void
  setSections: (sections: FloorPlanSection[]) => void

  // View actions
  setViewport: (x: number, y: number) => void
  setZoom: (zoom: number) => void
  pan: (deltaX: number, deltaY: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void

  // Selection actions
  selectTable: (tableId: string | null) => void
  openInfoPanel: (tableId: string) => void
  closeInfoPanel: () => void

  // Drag & drop actions
  startDrag: (tableId: string) => void
  updateDragTarget: (targetTableId: string | null, position?: { x: number; y: number }) => void
  endDrag: () => void

  // Combine/Split actions
  addUndoAction: (action: UndoAction) => void
  popUndoAction: () => UndoAction | null
  clearExpiredUndos: () => void

  // Seat visualization actions
  toggleShowSeats: () => void
  setShowSeats: (show: boolean) => void
  selectSeat: (tableId: string, seatNumber: number) => void
  clearSelectedSeat: () => void

  // Flash message actions
  flashTableMessage: (tableId: string, message: string, durationMs?: number) => void
  clearExpiredFlashes: () => void

  // Data actions
  updateTableStatus: (tableId: string, status: TableStatus) => void
  updateTablePosition: (tableId: string, posX: number, posY: number) => void
  refreshTable: (tableId: string, tableData: Partial<FloorPlanTable>) => void

  // Loading
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

const UNDO_WINDOW_MS = 30000 // 30 seconds

export const useFloorPlanStore = create<FloorPlanState>((set, get) => ({
  // Initial data
  tables: [],
  sections: [],

  // Initial view state
  viewportX: 0,
  viewportY: 0,
  zoom: 1,

  // Initial selection state
  selectedTableId: null,
  draggedTableId: null,
  dropTargetTableId: null,

  // Info panel
  infoPanelTableId: null,

  // Combine indicator
  showCombineIndicator: false,
  combinePosition: null,

  // Seat visualization
  showSeats: false,
  selectedSeat: null,

  // Flash messages
  flashingTables: new Map(),

  // Undo stack
  undoStack: [],

  // Loading state
  isLoading: false,
  error: null,

  // Data setters
  setTables: (tables) => set({ tables }),
  setSections: (sections) => set({ sections }),

  // View actions
  setViewport: (x, y) => set({ viewportX: x, viewportY: y }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(2, zoom)) }),

  pan: (deltaX, deltaY) => {
    const { viewportX, viewportY } = get()
    set({
      viewportX: viewportX + deltaX,
      viewportY: viewportY + deltaY,
    })
  },

  zoomIn: () => {
    const { zoom } = get()
    set({ zoom: Math.min(2, zoom + 0.1) })
  },

  zoomOut: () => {
    const { zoom } = get()
    set({ zoom: Math.max(0.25, zoom - 0.1) })
  },

  resetView: () => set({ viewportX: 0, viewportY: 0, zoom: 1 }),

  // Selection actions
  selectTable: (tableId) => set({ selectedTableId: tableId }),
  openInfoPanel: (tableId) => set({ infoPanelTableId: tableId, selectedTableId: tableId }),
  closeInfoPanel: () => set({ infoPanelTableId: null }),

  // Drag & drop actions
  startDrag: (tableId) => {
    console.log('[STORE] startDrag called:', tableId)
    set({
      draggedTableId: tableId,
      selectedTableId: tableId,
    })
  },

  updateDragTarget: (targetTableId, position) => {
    const { draggedTableId } = get()
    // Can't drop on self
    if (targetTableId === draggedTableId) {
      set({
        dropTargetTableId: null,
        showCombineIndicator: false,
        combinePosition: null,
      })
      return
    }

    set({
      dropTargetTableId: targetTableId,
      showCombineIndicator: targetTableId !== null,
      combinePosition: position || null,
    })
  },

  endDrag: () => set({
    draggedTableId: null,
    dropTargetTableId: null,
    showCombineIndicator: false,
    combinePosition: null,
  }),

  // Undo actions
  addUndoAction: (action) => {
    const { undoStack } = get()
    set({ undoStack: [...undoStack, action] })
  },

  popUndoAction: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return null

    const now = Date.now()
    // Find the most recent valid undo (within 30 seconds)
    const validUndos = undoStack.filter(u => now - u.timestamp < UNDO_WINDOW_MS)

    if (validUndos.length === 0) {
      set({ undoStack: [] })
      return null
    }

    const lastUndo = validUndos[validUndos.length - 1]
    set({ undoStack: validUndos.slice(0, -1) })
    return lastUndo
  },

  clearExpiredUndos: () => {
    const { undoStack } = get()
    const now = Date.now()
    const validUndos = undoStack.filter(u => now - u.timestamp < UNDO_WINDOW_MS)
    if (validUndos.length !== undoStack.length) {
      set({ undoStack: validUndos })
    }
  },

  // Seat visualization actions
  toggleShowSeats: () => {
    const { showSeats } = get()
    set({ showSeats: !showSeats })
  },

  setShowSeats: (show) => set({ showSeats: show }),

  selectSeat: (tableId, seatNumber) => {
    set({ selectedSeat: { tableId, seatNumber } })
  },

  clearSelectedSeat: () => set({ selectedSeat: null }),

  // Flash message actions
  flashTableMessage: (tableId, message, durationMs = 2000) => {
    const { flashingTables } = get()
    const newFlashes = new Map(flashingTables)
    newFlashes.set(tableId, {
      message,
      expiresAt: Date.now() + durationMs,
    })
    set({ flashingTables: newFlashes })
  },

  clearExpiredFlashes: () => {
    const { flashingTables } = get()
    const now = Date.now()
    let hasExpired = false
    for (const [, flash] of flashingTables) {
      if (flash.expiresAt <= now) {
        hasExpired = true
        break
      }
    }
    if (hasExpired) {
      const newFlashes = new Map<string, { message: string; expiresAt: number }>()
      for (const [id, flash] of flashingTables) {
        if (flash.expiresAt > now) {
          newFlashes.set(id, flash)
        }
      }
      set({ flashingTables: newFlashes })
    }
  },

  // Data updates
  updateTableStatus: (tableId, status) => {
    const { tables } = get()
    set({
      tables: tables.map(t =>
        t.id === tableId ? { ...t, status } : t
      ),
    })
  },

  updateTablePosition: (tableId, posX, posY) => {
    const { tables } = get()
    set({
      tables: tables.map(t =>
        t.id === tableId ? { ...t, posX, posY } : t
      ),
    })
  },

  refreshTable: (tableId, tableData) => {
    const { tables } = get()
    set({
      tables: tables.map(t =>
        t.id === tableId ? { ...t, ...tableData } : t
      ),
    })
  },

  // Loading
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))

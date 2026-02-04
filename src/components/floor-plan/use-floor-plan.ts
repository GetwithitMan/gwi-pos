import { create } from 'zustand'

// Table status types
export type TableStatus = 'available' | 'occupied' | 'reserved' | 'dirty' | 'in_use'

// Table data from API
// Seat patterns for partial coverage
export type SeatPattern =
  | 'all_around'    // Default - seats on all sides
  | 'front_only'    // Bar/counter style - seats on one side
  | 'three_sides'   // Against wall - no seats on one side
  | 'two_sides'     // Corner booth - seats on two adjacent sides
  | 'inside'        // Booth interior - seats inside the table

export interface FloorPlanTable {
  id: string
  name: string
  abbreviation: string | null  // Short display name for floor plan: "T1", "B3"
  capacity: number
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  shape: 'rectangle' | 'circle' | 'square' | 'booth' | 'bar'
  seatPattern: SeatPattern  // How seats are distributed around the table
  status: TableStatus
  section: { id: string; name: string; color: string } | null
  combinedWithId: string | null
  combinedTableIds: string[] | null
  originalName: string | null
  originalPosX: number | null
  originalPosY: number | null
  isLocked: boolean  // Locked items cannot be moved (bolted down furniture)
  // Virtual combine fields
  virtualGroupId: string | null
  virtualGroupPrimary: boolean
  virtualGroupColor: string | null
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

// Floor plan element types (entertainment, decorations, etc.)
export type ElementStatus = 'available' | 'in_use' | 'reserved' | 'maintenance'

export interface FloorPlanElement {
  id: string
  name: string
  abbreviation: string | null
  elementType: string // 'entertainment' | 'decoration' | etc.
  visualType: string // 'pool_table' | 'dartboard' | etc.
  linkedMenuItemId: string | null
  linkedMenuItem: {
    id: string
    name: string
    price: number
    itemType: string
    entertainmentStatus: string | null
    blockTimeMinutes: number | null
  } | null
  sectionId: string | null
  section: { id: string; name: string; color: string } | null
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  fillColor: string | null
  strokeColor: string | null
  opacity: number
  status: ElementStatus
  currentOrderId: string | null
  sessionStartedAt: string | null
  sessionExpiresAt: string | null
  isLocked: boolean
  isVisible: boolean
  waitlistCount: number
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
  elements: FloorPlanElement[]

  // View state
  viewportX: number
  viewportY: number
  zoom: number

  // Selection state
  selectedTableId: string | null
  selectedElementId: string | null
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

  // Virtual combine mode
  virtualCombineMode: boolean
  virtualCombineSelectedIds: Set<string>
  virtualCombinePrimaryId: string | null

  // Loading state
  isLoading: boolean
  error: string | null

  // Actions
  setTables: (tables: FloorPlanTable[]) => void
  setSections: (sections: FloorPlanSection[]) => void
  setElements: (elements: FloorPlanElement[]) => void

  // View actions
  setViewport: (x: number, y: number) => void
  setZoom: (zoom: number) => void
  pan: (deltaX: number, deltaY: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void

  // Selection actions
  selectTable: (tableId: string | null) => void
  selectElement: (elementId: string | null) => void
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
  batchUpdatePositions: (updates: Array<{ id: string; posX: number; posY: number; width?: number; height?: number }>) => void
  refreshTable: (tableId: string, tableData: Partial<FloorPlanTable>) => void

  // Loading
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  // Virtual combine actions
  startVirtualCombineMode: (tableId: string) => void
  toggleVirtualCombineSelection: (tableId: string) => void
  cancelVirtualCombineMode: () => void
  setVirtualCombinePrimary: (tableId: string) => void
  clearVirtualCombineMode: () => void
  updateTablesWithVirtualGroup: (updates: Array<{ id: string; virtualGroupId: string | null; virtualGroupPrimary: boolean; virtualGroupColor: string | null }>) => void

  // Seat management actions
  removeSeatAt: (tableId: string, index: number) => void
  addSeatToTable: (tableId: string, seat: FloorPlanSeat) => void
  updateSeatPosition: (tableId: string, seatIndex: number, relativeX: number, relativeY: number) => void

  // Room/Section management actions
  addSection: (section: FloorPlanSection) => void
  updateSection: (sectionId: string, updates: Partial<FloorPlanSection>) => void
  deleteSection: (sectionId: string) => void
  reorderSections: (sections: FloorPlanSection[]) => void

  // Element management actions
  addElement: (element: FloorPlanElement) => void
  updateElement: (elementId: string, updates: Partial<FloorPlanElement>) => void
  updateElementPosition: (elementId: string, posX: number, posY: number) => void
  updateElementSize: (elementId: string, width: number, height: number) => void
  deleteElement: (elementId: string) => void
}

const UNDO_WINDOW_MS = 300000 // 5 minutes

export const useFloorPlanStore = create<FloorPlanState>((set, get) => ({
  // Initial data
  tables: [],
  sections: [],
  elements: [],

  // Initial view state
  viewportX: 0,
  viewportY: 0,
  zoom: 1,

  // Initial selection state
  selectedTableId: null,
  selectedElementId: null,
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

  // Virtual combine mode
  virtualCombineMode: false,
  virtualCombineSelectedIds: new Set(),
  virtualCombinePrimaryId: null,

  // Loading state
  isLoading: false,
  error: null,

  // Data setters
  setTables: (tables) => set({ tables }),
  setSections: (sections) => set({ sections }),
  setElements: (elements) => set({ elements }),

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
  selectTable: (tableId) => set({ selectedTableId: tableId, selectedElementId: null }),
  selectElement: (elementId) => set({ selectedElementId: elementId, selectedTableId: null }),
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

  // Batch position update (for drag-and-drop saves)
  batchUpdatePositions: (updates: Array<{ id: string; posX: number; posY: number; width?: number; height?: number }>) => {
    const { tables } = get()
    const updateMap = new Map(updates.map(u => [u.id, u]))
    set({
      tables: tables.map(t => {
        const update = updateMap.get(t.id)
        if (!update) return t
        return {
          ...t,
          posX: update.posX,
          posY: update.posY,
          ...(update.width !== undefined && { width: update.width }),
          ...(update.height !== undefined && { height: update.height }),
        }
      }),
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

  // Virtual combine actions
  startVirtualCombineMode: (tableId) => {
    console.log('[VirtualCombine Store] startVirtualCombineMode called with tableId:', tableId)
    set({
      virtualCombineMode: true,
      virtualCombineSelectedIds: new Set([tableId]),
      virtualCombinePrimaryId: tableId,
      selectedTableId: tableId,
      // Close any open info panel
      infoPanelTableId: null,
    })
    console.log('[VirtualCombine Store] Virtual combine mode started, primary table:', tableId)
  },

  toggleVirtualCombineSelection: (tableId) => {
    const { virtualCombineSelectedIds, virtualCombinePrimaryId } = get()
    console.log('[VirtualCombine Store] toggleVirtualCombineSelection called:', { tableId, currentSelectedIds: Array.from(virtualCombineSelectedIds), primaryId: virtualCombinePrimaryId })

    const newSet = new Set(virtualCombineSelectedIds)

    if (newSet.has(tableId)) {
      // Don't allow removing the primary table
      if (tableId === virtualCombinePrimaryId) {
        console.log('[VirtualCombine Store] Cannot remove primary table')
        return
      }
      newSet.delete(tableId)
      console.log('[VirtualCombine Store] Removed table from selection')
    } else {
      newSet.add(tableId)
      console.log('[VirtualCombine Store] Added table to selection')
    }

    console.log('[VirtualCombine Store] New selected IDs:', Array.from(newSet))
    set({ virtualCombineSelectedIds: newSet })
  },

  cancelVirtualCombineMode: () => {
    set({
      virtualCombineMode: false,
      virtualCombineSelectedIds: new Set(),
      virtualCombinePrimaryId: null,
    })
  },

  setVirtualCombinePrimary: (tableId) => {
    const { virtualCombineSelectedIds } = get()
    // Can only set primary if table is selected
    if (!virtualCombineSelectedIds.has(tableId)) return
    set({ virtualCombinePrimaryId: tableId })
  },

  clearVirtualCombineMode: () => {
    set({
      virtualCombineMode: false,
      virtualCombineSelectedIds: new Set(),
      virtualCombinePrimaryId: null,
    })
  },

  updateTablesWithVirtualGroup: (updates) => {
    const { tables } = get()
    const updateMap = new Map(updates.map(u => [u.id, u]))

    set({
      tables: tables.map(t => {
        const update = updateMap.get(t.id)
        if (update) {
          return {
            ...t,
            virtualGroupId: update.virtualGroupId,
            virtualGroupPrimary: update.virtualGroupPrimary,
            virtualGroupColor: update.virtualGroupColor,
          }
        }
        return t
      }),
    })
  },

  // Seat management actions
  removeSeatAt: (tableId, index) => {
    const { tables } = get()
    set({
      tables: tables.map((t) => {
        if (t.id !== tableId) return t

        // 1. Remove the seat from the array
        const remaining = [...(t.seats || [])]
        remaining.splice(index, 1)

        // 2. Re-index remaining seats to be consecutive 1, 2, 3...
        const reindexed = remaining.map((s, i) => ({
          ...s,
          seatNumber: i + 1,
          // Reset custom positions so seats auto-redistribute
          relativeX: 0,
          relativeY: 0,
        }))

        return {
          ...t,
          seats: reindexed,
          capacity: reindexed.length,
        }
      }),
    })
  },

  addSeatToTable: (tableId, seat) => {
    const { tables } = get()
    set({
      tables: tables.map((t) => {
        if (t.id !== tableId) return t
        const newSeats = [...(t.seats || []), seat]
        return {
          ...t,
          seats: newSeats,
          capacity: newSeats.length,
        }
      }),
    })
  },

  updateSeatPosition: (tableId, seatIndex, relativeX, relativeY) => {
    const { tables } = get()
    set({
      tables: tables.map((t) => {
        if (t.id !== tableId) return t
        const updatedSeats = (t.seats || []).map((s, i) =>
          i === seatIndex ? { ...s, relativeX, relativeY } : s
        )
        return {
          ...t,
          seats: updatedSeats,
        }
      }),
    })
  },

  // Room/Section management actions
  addSection: (section) => {
    const { sections } = get()
    set({ sections: [...sections, section] })
  },

  updateSection: (sectionId, updates) => {
    const { sections, tables } = get()
    set({
      sections: sections.map((s) =>
        s.id === sectionId ? { ...s, ...updates } : s
      ),
      // Also update any tables that reference this section
      tables: tables.map((t) =>
        t.section?.id === sectionId
          ? { ...t, section: { ...t.section, ...updates } }
          : t
      ),
    })
  },

  deleteSection: (sectionId) => {
    const { sections, tables } = get()
    set({
      sections: sections.filter((s) => s.id !== sectionId),
      // Clear section reference from tables in this section
      tables: tables.map((t) =>
        t.section?.id === sectionId ? { ...t, section: null } : t
      ),
    })
  },

  reorderSections: (reorderedSections) => {
    set({ sections: reorderedSections })
  },

  // Element management actions
  addElement: (element) => {
    const { elements } = get()
    set({ elements: [...elements, element] })
  },

  updateElement: (elementId, updates) => {
    const { elements } = get()
    set({
      elements: elements.map((el) =>
        el.id === elementId ? { ...el, ...updates } : el
      ),
    })
  },

  updateElementPosition: (elementId, posX, posY) => {
    const { elements } = get()
    set({
      elements: elements.map((el) =>
        el.id === elementId ? { ...el, posX, posY } : el
      ),
    })
  },

  updateElementSize: (elementId, width, height) => {
    const { elements } = get()
    set({
      elements: elements.map((el) =>
        el.id === elementId ? { ...el, width, height } : el
      ),
    })
  },

  deleteElement: (elementId) => {
    const { elements, selectedElementId } = get()
    set({
      elements: elements.filter((el) => el.id !== elementId),
      selectedElementId: selectedElementId === elementId ? null : selectedElementId,
    })
  },
}))

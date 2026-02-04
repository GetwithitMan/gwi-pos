// src/components/floor-plan/useFloorPlanStore.ts
'use client'

import { create } from 'zustand'

export type TableStatus = 'available' | 'occupied' | 'dirty' | 'reserved'

export interface FloorPlanSeat {
  id: string
  tableId: string
  label: string
  seatNumber: number
  relativeX: number
  relativeY: number
  angle: number
}

export interface FloorPlanTable {
  id: string
  name: string
  sectionId: string | null
  posX: number
  posY: number
  width: number
  height: number
  status: TableStatus
  capacity: number
  combinedWithId: string | null
  combinedTableIds: string[] | null
  virtualGroupId: string | null
  virtualGroupPrimary: boolean
  virtualGroupColor: string | null
  // Current open order for this table (if any)
  currentOrder: {
    id: string
    orderNumber: number
    total: number
    openedAt: string
    server: string
  } | null
}

export type ViewMode = 'service' | 'admin'
export type OrderType = 'dine_in' | 'bar_tab' | 'takeout' | 'delivery'

// Order item shape (matches what API returns)
export interface OrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: { id: string; name: string; price: number }[]
  specialNotes?: string
  seatNumber?: number | null
  sourceTableId?: string | null
  courseNumber?: number
  courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
  isHeld?: boolean
  sentToKitchen?: boolean
  status?: 'active' | 'voided' | 'comped'
  blockTimeMinutes?: number
}

// Active order state
export interface ActiveOrder {
  id: string | null
  orderNumber: string | null
  tableId: string | null
  orderType: OrderType
  guestCount: number
}

interface FloorPlanState {
  locationId: string | null
  viewMode: ViewMode
  tables: FloorPlanTable[]
  seats: FloorPlanSeat[]
  selectedTableId: string | null
  selectedTableIds: string[] // Multi-select for virtual grouping
  selectedSeatId: string | null

  // Order state
  activeOrder: ActiveOrder | null
  orderItems: OrderItem[]
  showOrderPanel: boolean
  activeSeatNumber: number | null // For assigning items to specific seat
  activeSourceTableId: string | null // For combined tables - which table is the item from

  setLocation(locationId: string): void
  setViewMode(mode: ViewMode): void
  setTables(tables: FloorPlanTable[]): void
  setSeats(seats: FloorPlanSeat[]): void

  selectTable(tableId: string | null): void
  toggleTableSelection(tableId: string, addToSelection: boolean): void
  clearTableSelection(): void
  selectSeat(seatId: string | null): void

  // Order actions
  openOrderPanel(tableId: string | null, orderType: OrderType): void
  closeOrderPanel(): void
  setActiveOrder(order: ActiveOrder | null): void
  setOrderItems(items: OrderItem[]): void
  addOrderItem(item: OrderItem): void
  updateOrderItem(itemId: string, updates: Partial<OrderItem>): void
  removeOrderItem(itemId: string): void
  setActiveSeat(seatNumber: number | null, sourceTableId?: string | null): void
  clearOrder(): void

  updateTablePosition(tableId: string, posX: number, posY: number): void
  applyCombineResult(payload: {
    table: {
      id: string
      name: string
      capacity: number
      status: TableStatus
      combinedTableIds: string[] | null
    }
    sourceTable: { id: string; posX: number; posY: number }
    shiftedTables: Record<string, { posX: number; posY: number }>
    seats: FloorPlanSeat[]
  }): void

  applySeatReflow(seats: FloorPlanSeat[]): void
  applyVirtualGroupUpdate(payload: {
    virtualGroupId: string
    tableIds: string[]
    primaryTableId?: string
    color?: string | null
    removedTableIds?: string[]
    dissolved?: boolean
  }): void
}

export const useFloorPlanStore = create<FloorPlanState>((set) => ({
  locationId: null,
  viewMode: 'service',
  tables: [],
  seats: [],
  selectedTableId: null,
  selectedTableIds: [],
  selectedSeatId: null,

  // Order state
  activeOrder: null,
  orderItems: [],
  showOrderPanel: false,
  activeSeatNumber: null,
  activeSourceTableId: null,

  setLocation(locationId) {
    set({ locationId })
  },

  setViewMode(viewMode) {
    set({ viewMode })
  },

  setTables(tables) {
    set({ tables })
  },

  setSeats(seats) {
    set({ seats })
  },

  selectTable(tableId) {
    set({
      selectedTableId: tableId,
      selectedTableIds: tableId ? [tableId] : [],
      selectedSeatId: null,
    })
  },

  toggleTableSelection(tableId, addToSelection) {
    set(state => {
      if (addToSelection) {
        // Shift/Ctrl click - toggle in multi-select
        const isSelected = state.selectedTableIds.includes(tableId)
        const newIds = isSelected
          ? state.selectedTableIds.filter(id => id !== tableId)
          : [...state.selectedTableIds, tableId]
        return {
          selectedTableIds: newIds,
          selectedTableId: newIds.length === 1 ? newIds[0] : null,
          selectedSeatId: null,
        }
      } else {
        // Normal click - single select
        return {
          selectedTableId: tableId,
          selectedTableIds: [tableId],
          selectedSeatId: null,
        }
      }
    })
  },

  clearTableSelection() {
    set({
      selectedTableId: null,
      selectedTableIds: [],
      selectedSeatId: null,
    })
  },

  selectSeat(seatId) {
    set({ selectedSeatId: seatId })
  },

  // Order actions
  openOrderPanel(tableId, orderType) {
    set(state => {
      // Find the table to get guest count
      const table = tableId ? state.tables.find(t => t.id === tableId) : null
      const guestCount = table?.capacity || 1

      return {
        showOrderPanel: true,
        activeOrder: {
          id: null,
          orderNumber: null,
          tableId,
          orderType,
          guestCount,
        },
        // Clear items when opening fresh panel without existing order
        orderItems: [],
        activeSeatNumber: null,
        activeSourceTableId: null,
      }
    })
  },

  closeOrderPanel() {
    set({
      showOrderPanel: false,
      activeOrder: null,
      orderItems: [],
      activeSeatNumber: null,
      activeSourceTableId: null,
    })
  },

  setActiveOrder(order) {
    set({ activeOrder: order })
  },

  setOrderItems(items) {
    set({ orderItems: items })
  },

  addOrderItem(item) {
    set(state => ({
      orderItems: [...state.orderItems, item],
    }))
  },

  updateOrderItem(itemId, updates) {
    set(state => ({
      orderItems: state.orderItems.map(item =>
        item.id === itemId ? { ...item, ...updates } : item
      ),
    }))
  },

  removeOrderItem(itemId) {
    set(state => ({
      orderItems: state.orderItems.filter(item => item.id !== itemId),
    }))
  },

  setActiveSeat(seatNumber, sourceTableId = null) {
    set({
      activeSeatNumber: seatNumber,
      activeSourceTableId: sourceTableId,
    })
  },

  clearOrder() {
    set({
      activeOrder: null,
      orderItems: [],
      activeSeatNumber: null,
      activeSourceTableId: null,
    })
  },

  updateTablePosition(tableId, posX, posY) {
    set(state => ({
      tables: state.tables.map(t =>
        t.id === tableId ? { ...t, posX, posY } : t
      ),
    }))
  },

  applyCombineResult(payload) {
    const { table, sourceTable, shiftedTables, seats } = payload
    set(state => {
      const tables = state.tables.map(t => {
        // Updated primary
        if (t.id === table.id) {
          return {
            ...t,
            name: table.name,
            capacity: table.capacity,
            status: table.status,
            combinedTableIds: table.combinedTableIds,
          }
        }
        // Source table moved + combinedWith
        if (t.id === sourceTable.id) {
          return {
            ...t,
            posX: sourceTable.posX,
            posY: sourceTable.posY,
            combinedWithId: table.id,
          }
        }
        // Shifted tables
        const shift = shiftedTables[t.id]
        if (shift) {
          return {
            ...t,
            posX: shift.posX,
            posY: shift.posY,
          }
        }
        return t
      })

      return {
        tables,
        seats,
      }
    })
  },

  applySeatReflow(seats) {
    set({ seats })
  },

  applyVirtualGroupUpdate({
    virtualGroupId,
    tableIds,
    primaryTableId,
    color,
    removedTableIds,
    dissolved,
  }) {
    set(state => {
      let tables = [...state.tables]

      if (dissolved) {
        tables = tables.map(t =>
          t.virtualGroupId === virtualGroupId
            ? {
                ...t,
                virtualGroupId: null,
                virtualGroupPrimary: false,
                virtualGroupColor: null,
              }
            : t
        )
      } else {
        // Apply additions/updates
        tables = tables.map(t => {
          if (tableIds.includes(t.id)) {
            return {
              ...t,
              virtualGroupId,
              virtualGroupPrimary: primaryTableId
                ? t.id === primaryTableId
                : t.virtualGroupPrimary,
              virtualGroupColor: color ?? t.virtualGroupColor ?? '#38bdf8',
            }
          }
          if (removedTableIds?.includes(t.id)) {
            return {
              ...t,
              virtualGroupId: null,
              virtualGroupPrimary: false,
              virtualGroupColor: null,
            }
          }
          return t
        })
      }

      return { tables }
    })
  },
}))

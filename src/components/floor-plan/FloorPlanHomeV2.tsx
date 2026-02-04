// src/components/floor-plan/FloorPlanHomeV2.tsx
'use client'

import React, { useEffect, useRef, useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { useFloorPlanStore, FloorPlanTable as TableType, OrderItem } from './useFloorPlanStore'
import { FloorPlanTableV2 } from './FloorPlanTableV2'
import { VirtualGroupToolbar } from './VirtualGroupToolbar'
import { OrderPanelV2 } from './OrderPanelV2'
import { MenuSelectorV2 } from './MenuSelectorV2'
import { calculateMagneticSnap, type TableRect } from '@/lib/table-geometry'
import type { MenuItem, PizzaOrderConfig } from '@/types'

interface FloorPlanHomeProps {
  locationId: string
  employeeId?: string
  mode?: 'service' | 'admin'
  // Payment callback
  onOpenPayment?: (orderId: string) => void
  // Modifier modal callback
  onOpenModifiers?: (
    item: MenuItem,
    onComplete: (modifiers: { id: string; name: string; price: number }[]) => void,
    existingModifiers?: { id: string; name: string; price: number }[]
  ) => void
  // Timed rental selection callback
  onOpenTimedRental?: (
    item: MenuItem,
    onComplete: (price: number, blockMinutes: number) => void
  ) => void
  // Pizza builder callback
  onOpenPizzaBuilder?: (
    item: MenuItem,
    onComplete: (config: PizzaOrderConfig) => void
  ) => void
}

/**
 * FloorPlanHomeV2 - Clean floor plan with integrated ordering.
 *
 * Features:
 * - /api/floor-plan to load tables + seats
 * - /api/tables/combine for physical combining
 * - /api/tables/seats/reflow for add/remove seats
 * - /api/tables/virtual-group for virtual linking
 * - Order panel integration with table click
 *
 * Click behavior:
 * - Normal click: Open order panel for table
 * - Shift/Ctrl + click: Multi-select for virtual grouping
 */
export const FloorPlanHomeV2: React.FC<FloorPlanHomeProps> = ({
  locationId,
  employeeId,
  mode = 'service',
  onOpenPayment,
  onOpenModifiers,
  onOpenTimedRental,
  onOpenPizzaBuilder,
}) => {
  const {
    tables,
    seats,
    viewMode,
    selectedTableIds,
    showOrderPanel,
    activeOrder,
    setViewMode,
    setLocation,
    setTables,
    setSeats,
    updateTablePosition,
    applyCombineResult,
    applySeatReflow,
    toggleTableSelection,
    clearTableSelection,
    openOrderPanel,
    closeOrderPanel,
    setActiveOrder,
    setOrderItems,
  } = useFloorPlanStore()

  // Toast-like feedback state (simple inline)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isLoadingOrder, setIsLoadingOrder] = useState(false)

  const dragStartRef = useRef<{ tableId: string; x: number; y: number } | null>(
    null
  )

  // Clear feedback after delay
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [feedback])

  useEffect(() => {
    setLocation(locationId)
    setViewMode(mode)
  }, [locationId, mode, setLocation, setViewMode])

  /**
   * Resolve the primary table for ordering.
   * - If table is in a virtual group, return the virtual primary
   * - If table is physically combined into another, return that primary
   * - Otherwise return the table itself
   */
  const resolvePrimaryTable = useCallback((table: TableType): TableType => {
    const currentTables = useFloorPlanStore.getState().tables

    // If in a virtual group and not the primary, find the primary
    if (table.virtualGroupId && !table.virtualGroupPrimary) {
      const virtualPrimary = currentTables.find(
        t => t.virtualGroupId === table.virtualGroupId && t.virtualGroupPrimary
      )
      if (virtualPrimary) return virtualPrimary
    }

    // If physically combined into another table, find that primary
    if (table.combinedWithId) {
      const physicalPrimary = currentTables.find(t => t.id === table.combinedWithId)
      if (physicalPrimary) return physicalPrimary
    }

    return table
  }, [])

  /**
   * Load existing order for a table.
   */
  const loadExistingOrder = useCallback(async (orderId: string, orderNumber: string, tableId: string) => {
    setIsLoadingOrder(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (!res.ok) {
        setFeedback({ type: 'error', message: 'Failed to load order' })
        return
      }

      const data = await res.json()

      // Set order in store
      setActiveOrder({
        id: orderId,
        orderNumber,
        tableId,
        orderType: data.orderType || 'dine_in',
        guestCount: data.guestCount || 1,
      })

      // Map items to store format
      const items: OrderItem[] = (data.items || []).map((item: {
        id: string
        menuItemId: string
        name: string
        price: number
        quantity: number
        modifiers?: { id: string; name: string; price: number }[]
        specialNotes?: string
        seatNumber?: number
        sourceTableId?: string
        courseNumber?: number
        courseStatus?: string
        isHeld?: boolean
        kitchenStatus?: string
        status?: string
        blockTimeMinutes?: number
      }) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.name || 'Unknown',
        price: Number(item.price) || 0,
        quantity: item.quantity,
        modifiers: (item.modifiers || []).map(m => ({
          id: m.id,
          name: m.name || '',
          price: Number(m.price) || 0,
        })),
        specialNotes: item.specialNotes,
        seatNumber: item.seatNumber,
        sourceTableId: item.sourceTableId,
        courseNumber: item.courseNumber,
        courseStatus: item.courseStatus as OrderItem['courseStatus'],
        isHeld: item.isHeld,
        sentToKitchen: item.kitchenStatus !== 'pending' && item.kitchenStatus !== undefined,
        status: item.status as OrderItem['status'],
        blockTimeMinutes: item.blockTimeMinutes,
      }))

      setOrderItems(items)
    } catch (err) {
      console.error('Load order error:', err)
      setFeedback({ type: 'error', message: 'Failed to load order' })
    } finally {
      setIsLoadingOrder(false)
    }
  }, [setActiveOrder, setOrderItems])

  // Handle table click - opens order or multi-selects
  const handleTableClick = useCallback(async (
    e: React.MouseEvent,
    table: TableType
  ) => {
    e.stopPropagation()
    const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey

    if (addToSelection) {
      // Multi-select mode for virtual grouping
      toggleTableSelection(table.id, true)
      return
    }

    // Single click - open order panel for this table
    clearTableSelection()

    // Resolve primary table (virtual or physical)
    const primaryTable = resolvePrimaryTable(table)

    // Open order panel for dine-in
    openOrderPanel(primaryTable.id, 'dine_in')

    // Check if table has an existing order
    if (primaryTable.currentOrder) {
      // Load the existing order
      await loadExistingOrder(
        primaryTable.currentOrder.id,
        String(primaryTable.currentOrder.orderNumber),
        primaryTable.id
      )
    }
  }, [toggleTableSelection, clearTableSelection, resolvePrimaryTable, openOrderPanel, loadExistingOrder])

  // Click on canvas background clears selection and closes order panel
  const handleCanvasClick = useCallback(() => {
    clearTableSelection()
    // Don't close order panel on canvas click - user can use X button
  }, [clearTableSelection])

  // Load tables + seats once
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/floor-plan?locationId=${locationId}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        setTables(data.tables as TableType[])
        setSeats(data.seats)
      } catch (err) {
        console.error('FloorPlanHomeV2 load error', err)
      }
    }
    load()
  }, [locationId, setTables, setSeats])

  const handleDragStart = (table: TableType) => {
    dragStartRef.current = {
      tableId: table.id,
      x: table.posX,
      y: table.posY,
    }
  }

  const handleDragEnd = async (
    table: TableType,
    info: { point: { x: number; y: number } }
  ) => {
    const start = dragStartRef.current
    if (!start || start.tableId !== table.id) return

    // Calculate delta from drag start and apply to original position
    const deltaX = info.point.x - start.x
    const deltaY = info.point.y - start.y
    const newX = start.x + deltaX
    const newY = start.y + deltaY

    // Compute magnetic snap against other tables
    const otherTables: TableRect[] = useFloorPlanStore
      .getState()
      .tables.filter(t => t.id !== table.id)
      .map(t => ({
        id: t.id,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
      }))

    const snap = calculateMagneticSnap(
      {
        id: table.id,
        x: newX,
        y: newY,
        width: table.width,
        height: table.height,
      },
      otherTables
    )

    const finalX = Math.round(snap.x)
    const finalY = Math.round(snap.y)

    // Update local position
    updateTablePosition(table.id, finalX, finalY)

    // If we snapped onto another table, offer to combine (simple heuristic)
    if (snap.snapTargetId) {
      try {
        const allTablesPayload = useFloorPlanStore.getState().tables.map(t => ({
          id: t.id,
          posX: t.posX,
          posY: t.posY,
          width: t.width,
          height: t.height,
        }))

        const res = await fetch('/api/tables/combine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceTableId: table.id,
            targetTableId: snap.snapTargetId,
            locationId,
            dropX: finalX,
            dropY: finalY,
            allTables: allTablesPayload,
          }),
        })

        const data = await res.json()
        if (res.ok && data.data) {
          applyCombineResult({
            table: data.data.table,
            sourceTable: data.data.sourceTable,
            shiftedTables: data.data.shiftedTables ?? {},
            seats: data.data.seats ?? seats,
          })
        } else {
          console.error('Combine failed', data)
        }
      } catch (err) {
        console.error('Combine API error', err)
      }
    }
  }

  const handleAddSeat = async (tableIds: string[]) => {
    if (!tableIds.length) return
    const currentSeats = seats.filter(s => tableIds.includes(s.tableId))
    const nextCount = currentSeats.length + 1

    try {
      const res = await fetch('/api/tables/seats/reflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          tableIds,
          seatCount: nextCount,
        }),
      })
      const data = await res.json()
      if (res.ok && data.data) {
        applySeatReflow(data.data.seats)
      } else {
        console.error('Seat reflow failed', data)
      }
    } catch (err) {
      console.error('Seat reflow error', err)
    }
  }

  const handleRemoveSeat = async (tableIds: string[]) => {
    if (!tableIds.length) return
    const currentSeats = seats.filter(s => tableIds.includes(s.tableId))
    const nextCount = Math.max(currentSeats.length - 1, 0)

    try {
      const res = await fetch('/api/tables/seats/reflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          tableIds,
          seatCount: nextCount,
        }),
      })
      const data = await res.json()
      if (res.ok && data.data) {
        applySeatReflow(data.data.seats)
      } else {
        console.error('Seat reflow failed', data)
      }
    } catch (err) {
      console.error('Seat reflow error', err)
    }
  }

  return (
    <div
      className="relative w-full h-full bg-slate-900 overflow-hidden"
      onClick={handleCanvasClick}
    >
      {/* Simple background grid */}
      <div className="absolute inset-0 pointer-events-none opacity-40">
        {Array.from({ length: 50 }).map((_, i) => (
          <React.Fragment key={i}>
            <div
              className="absolute border-t border-slate-800"
              style={{ top: i * 40, left: 0, right: 0 }}
            />
            <div
              className="absolute border-l border-slate-800"
              style={{ left: i * 40, top: 0, bottom: 0 }}
            />
          </React.Fragment>
        ))}
      </div>

      {/* Instructions hint */}
      {selectedTableIds.length === 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-slate-500 text-xs">
          Click table to select. Shift+Click to multi-select for linking.
        </div>
      )}

      {/* Tables */}
      {tables.map(table => {
        const isSelected = selectedTableIds.includes(table.id)
        return (
          <motion.div
            key={table.id}
            drag={mode === 'admin'}
            dragMomentum={false}
            style={{ position: 'absolute' }}
            onDragStart={() => handleDragStart(table)}
            onDragEnd={(_, info) => handleDragEnd(table, info)}
            onClick={(e) => handleTableClick(e, table)}
          >
            <FloorPlanTableV2
              table={table}
              mode={viewMode}
              isMultiSelected={isSelected}
              onAddSeat={handleAddSeat}
              onRemoveSeat={handleRemoveSeat}
            />
          </motion.div>
        )
      })}

      {/* Virtual Group Toolbar - shows when tables selected (and order panel not open) */}
      {!showOrderPanel && (
        <VirtualGroupToolbar
          locationId={locationId}
          onSuccess={(msg) => setFeedback({ type: 'success', message: msg })}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}

      {/* Order Panel - slides in from right */}
      <OrderPanelV2
        locationId={locationId}
        employeeId={employeeId}
        onOpenPayment={onOpenPayment}
        onSuccess={(msg) => setFeedback({ type: 'success', message: msg })}
        onError={(msg) => setFeedback({ type: 'error', message: msg })}
      />

      {/* Menu Selector - shows at bottom when order panel is open */}
      <MenuSelectorV2
        locationId={locationId}
        onItemSelect={(item) => {
          // Item was added to order via MenuSelectorV2
          console.log('Item selected:', item.name)
        }}
        onOpenModifiers={onOpenModifiers}
        onOpenTimedRental={onOpenTimedRental}
        onOpenPizzaBuilder={onOpenPizzaBuilder}
      />

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`absolute top-4 ${showOrderPanel ? 'right-[400px]' : 'right-4'} px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Loading overlay when fetching order */}
      {isLoadingOrder && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-slate-800 px-6 py-4 rounded-xl text-white">
            Loading order...
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, FloorPlanTable, FloorPlanSection, SeatPattern } from './use-floor-plan'
import { TableNode } from './TableNode'
import { TableInfoPanel } from './TableInfoPanel'
import { TableEditPanel } from './panels/TableEditPanel'
import { RoomTabs } from './RoomTabs'
import { calculateAttachSide, calculateAttachPosition } from './table-positioning'
import './styles/floor-plan.css'
import { logger } from '@/lib/logger'
import { useSocket } from '@/hooks/useSocket'
import { toast } from '@/stores/toast-store'

type FloorPlanMode = 'admin' | 'pos'

interface UnifiedFloorPlanProps {
  mode: FloorPlanMode
  locationId: string
  employeeId?: string
  roomId?: string  // For multi-room support
  // Admin mode callbacks
  onTableUpdate?: (tableId: string, updates: Partial<FloorPlanTable>) => Promise<void>
  onTableDelete?: (tableId: string) => Promise<void>
  onTableCreate?: () => void
  // POS mode callbacks
  onTableSelect?: (table: FloorPlanTable) => void
  // Shared
  showSeatsToggle?: boolean
  hideToolbar?: boolean  // Hide the top toolbar (when parent page provides its own)
  className?: string
}

export function UnifiedFloorPlan({
  mode,
  locationId,
  employeeId,
  roomId,
  onTableUpdate,
  onTableDelete,
  onTableCreate,
  onTableSelect,
  showSeatsToggle = true,
  hideToolbar = false,
  className = '',
}: UnifiedFloorPlanProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [editingTableId, setEditingTableId] = useState<string | null>(null)
  const [lastDropPosition, setLastDropPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)

  // Auto-scaling state for floor plan
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  const tables = useFloorPlanStore(s => s.tables)
  const sections = useFloorPlanStore(s => s.sections)
  const selectedTableId = useFloorPlanStore(s => s.selectedTableId)
  const draggedTableId = useFloorPlanStore(s => s.draggedTableId)
  const dropTargetTableId = useFloorPlanStore(s => s.dropTargetTableId)
  const infoPanelTableId = useFloorPlanStore(s => s.infoPanelTableId)
  const isLoading = useFloorPlanStore(s => s.isLoading)
  const showSeats = useFloorPlanStore(s => s.showSeats)
  const selectedSeat = useFloorPlanStore(s => s.selectedSeat)
  const flashingTables = useFloorPlanStore(s => s.flashingTables)
  const setTables = useFloorPlanStore(s => s.setTables)
  const setSections = useFloorPlanStore(s => s.setSections)
  const selectTable = useFloorPlanStore(s => s.selectTable)
  const startDrag = useFloorPlanStore(s => s.startDrag)
  const updateDragTarget = useFloorPlanStore(s => s.updateDragTarget)
  const endDrag = useFloorPlanStore(s => s.endDrag)
  const openInfoPanel = useFloorPlanStore(s => s.openInfoPanel)
  const closeInfoPanel = useFloorPlanStore(s => s.closeInfoPanel)
  const toggleShowSeats = useFloorPlanStore(s => s.toggleShowSeats)
  const selectSeat = useFloorPlanStore(s => s.selectSeat)
  const clearSelectedSeat = useFloorPlanStore(s => s.clearSelectedSeat)
  const flashTableMessage = useFloorPlanStore(s => s.flashTableMessage)
  const clearExpiredFlashes = useFloorPlanStore(s => s.clearExpiredFlashes)
  const setLoading = useFloorPlanStore(s => s.setLoading)
  const patchTableOrder = useFloorPlanStore(s => s.patchTableOrder)
  const removeTableOrder = useFloorPlanStore(s => s.removeTableOrder)
  const updateSingleTableStatus = useFloorPlanStore(s => s.updateSingleTableStatus)

  // Ref for stale closure avoidance in socket callbacks
  const tablesRef = useRef(tables)
  tablesRef.current = tables

  const { socket, isConnected } = useSocket()

  // Load data on mount
  useEffect(() => {
    loadFloorPlanData()
  }, [locationId, roomId])

  // Socket-driven updates with delta patterns (avoid full reload when possible)
  useEffect(() => {
    if (!socket || !isConnected) return

    const onFloorPlanUpdated = () => {
      logger.log('[UnifiedFloorPlan] floor-plan:updated — full reload (structure change)')
      loadFloorPlanData()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onOrdersListChanged = (data: any) => {
      const { trigger, tableId } = data || {}
      logger.log(`[UnifiedFloorPlan] orders:list-changed trigger=${trigger} tableId=${tableId}`)
      if ((trigger === 'paid' || trigger === 'voided') && tableId) {
        removeTableOrder(tableId)
      } else {
        loadFloorPlanData()
      }
    }
    const onOrderCreated = () => {
      logger.log('[UnifiedFloorPlan] order:created — full reload')
      loadFloorPlanData()
    }
    const onOrderUpdated = () => {
      logger.log('[UnifiedFloorPlan] order:updated — full reload')
      loadFloorPlanData()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onTotalsUpdated = (data: any) => {
      const { orderId, totals } = data || {}
      if (orderId && totals) {
        const currentTables = tablesRef.current
        const table = currentTables.find((t: FloorPlanTable) => t.currentOrder?.id === orderId)
        if (table) {
          logger.log(`[UnifiedFloorPlan] order:totals-updated — delta patch table ${table.id}`)
          patchTableOrder(table.id, { total: totals.total })
          return
        }
      }
      loadFloorPlanData()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onTableStatusChanged = (data: any) => {
      const { tableId, status: newStatus } = data || {}
      if (tableId && newStatus) {
        logger.log(`[UnifiedFloorPlan] table:status-changed — delta patch ${tableId}`)
        updateSingleTableStatus(tableId, newStatus as import('./use-floor-plan').TableStatus)
      } else {
        loadFloorPlanData()
      }
    }

    socket.on('floor-plan:updated', onFloorPlanUpdated)
    socket.on('orders:list-changed', onOrdersListChanged)
    socket.on('order:created', onOrderCreated)
    socket.on('order:updated', onOrderUpdated)
    socket.on('order:totals-updated', onTotalsUpdated)
    socket.on('table:status-changed', onTableStatusChanged)

    return () => {
      socket.off('floor-plan:updated', onFloorPlanUpdated)
      socket.off('orders:list-changed', onOrdersListChanged)
      socket.off('order:created', onOrderCreated)
      socket.off('order:updated', onOrderUpdated)
      socket.off('order:totals-updated', onTotalsUpdated)
      socket.off('table:status-changed', onTableStatusChanged)
    }
  }, [socket, isConnected])

  // 20s disconnected-only fallback
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(() => loadFloorPlanData(), 20000)
    return () => clearInterval(fallback)
  }, [isConnected])

  // visibilitychange for instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadFloorPlanData()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Clear expired flashes
  useEffect(() => {
    const interval = setInterval(() => {
      clearExpiredFlashes()
    }, 1000)
    return () => clearInterval(interval)
  }, [clearExpiredFlashes])

  const loadFloorPlanData = async () => {
    setLoading(true)
    try {
      const roomParam = roomId ? `&roomId=${roomId}` : ''
      const [tablesRes, sectionsRes] = await Promise.all([
        fetch(`/api/tables?locationId=${locationId}&includeSeats=true${roomParam}`),
        fetch(`/api/sections?locationId=${locationId}${roomParam}`),
      ])

      if (tablesRes.ok) {
        const raw = await tablesRes.json()
        const data = raw.data ?? raw
        setTables(data.tables || [])
      }
      if (sectionsRes.ok) {
        const raw = await sectionsRes.json()
        const data = raw.data ?? raw
        setSections(data.sections || [])
      }
    } catch (error) {
      console.error('[UnifiedFloorPlan] Load error:', error)
    } finally {
      setLoading(false)
    }
  }

  // Auto-scaling: Measure container size with ResizeObserver (POS mode only)
  useEffect(() => {
    if (mode === 'admin' || !containerRef.current) return
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ width, height })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [mode])

  // Auto-scaling: Calculate bounding box of all visible tables (POS mode only)
  const tableBounds = useMemo(() => {
    if (mode === 'admin') return null

    // Filter tables by selected section
    const visibleTables = selectedSectionId === null
      ? tables
      : tables.filter(t => t.section?.id === selectedSectionId)

    if (visibleTables.length === 0) return null

    let minX = Infinity, minY = Infinity
    let maxX = -Infinity, maxY = -Infinity

    visibleTables.forEach(table => {
      minX = Math.min(minX, table.posX)
      minY = Math.min(minY, table.posY)
      maxX = Math.max(maxX, table.posX + (table.width || 100))
      maxY = Math.max(maxY, table.posY + (table.height || 100))
    })

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
  }, [tables, selectedSectionId, mode])

  // Auto-scaling: Calculate scale factor to fit all tables in container (POS mode only)
  const autoScale = useMemo(() => {
    if (mode === 'admin' || !tableBounds || containerSize.width === 0 || containerSize.height === 0) return 1

    const padding = 60
    const availableWidth = containerSize.width - padding * 2
    const availableHeight = containerSize.height - padding * 2

    if (tableBounds.width <= availableWidth && tableBounds.height <= availableHeight) {
      return 1
    }

    const scaleX = availableWidth / tableBounds.width
    const scaleY = availableHeight / tableBounds.height

    return Math.max(0.3, Math.min(scaleX, scaleY, 1))
  }, [tableBounds, containerSize, mode])

  // Auto-scaling: Calculate offset to center the scaled content
  const autoScaleOffset = useMemo(() => {
    if (mode === 'admin' || !tableBounds || autoScale === 1) {
      return { x: 0, y: 0 }
    }

    const scaledWidth = tableBounds.width * autoScale
    const scaledHeight = tableBounds.height * autoScale

    const offsetX = (containerSize.width - scaledWidth) / 2 - tableBounds.minX * autoScale
    const offsetY = (containerSize.height - scaledHeight) / 2 - tableBounds.minY * autoScale

    return { x: offsetX, y: offsetY }
  }, [tableBounds, autoScale, containerSize, mode])


  // Handle table tap based on mode
  const handleTableTap = useCallback((table: FloorPlanTable) => {
    if (mode === 'admin') {
      setEditingTableId(table.id)
      selectTable(table.id)
    } else {
      // POS mode - trigger order flow
      onTableSelect?.(table)
    }
  }, [mode, selectTable, onTableSelect])

  // Stable ID-based wrappers for TableNode (avoids inline closures that break React.memo)
  const handleTableTapById = useCallback((tableId: string) => {
    const table = tables.find(t => t.id === tableId)
    if (table) handleTableTap(table)
  }, [tables, handleTableTap])

  const handleDragStartById = useCallback((tableId: string) => {
    startDrag(tableId)
  }, [startDrag])

  const handleLongPressById = useCallback((tableId: string) => {
    if (mode === 'pos') {
      openInfoPanel(tableId)
    }
  }, [mode, openInfoPanel])

  const handleSeatTapById = useCallback((tableId: string, seatNumber: number) => {
    selectSeat(tableId, seatNumber)
  }, [selectSeat])

  // Handle drag for table repositioning (admin mode)
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggedTableId || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setLastDropPosition({ x, y })

    // Check for drop target (combining tables in POS mode, or just repositioning in admin)
    if (mode === 'pos') {
      const targetTable = tables.find(t =>
        t.id !== draggedTableId &&
        x >= t.posX && x <= t.posX + t.width &&
        y >= t.posY && y <= t.posY + t.height
      )
      updateDragTarget(targetTable?.id || null)
    }
  }, [draggedTableId, tables, mode, updateDragTarget])

  const handlePointerUp = useCallback(async () => {
    if (!draggedTableId) return

    const draggedTable = tables.find(t => t.id === draggedTableId)
    if (!draggedTable) {
      endDrag()
      return
    }

    // Admin mode: just update position
    if (mode === 'admin' && lastDropPosition) {
      const newPosX = Math.max(0, lastDropPosition.x - draggedTable.width / 2)
      const newPosY = Math.max(0, lastDropPosition.y - draggedTable.height / 2)

      const prevTables = [...tables]
      try {
        const response = await fetch(`/api/tables/${draggedTableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId, posX: Math.round(newPosX), posY: Math.round(newPosY) }),
        })

        if (!response.ok) {
          toast.error('Failed to save table position')
          return
        }

        setTables(tables.map(t =>
          t.id === draggedTableId
            ? { ...t, posX: Math.round(newPosX), posY: Math.round(newPosY) }
            : t
        ))
      } catch (error) {
        setTables(prevTables)
        toast.error('Failed to save table position')
      }
    }

    endDrag()
    setLastDropPosition(null)
  }, [draggedTableId, dropTargetTableId, tables, mode, lastDropPosition, endDrag, setTables])

  // Handle table update from edit panel
  const handleTableUpdate = useCallback(async (tableId: string, updates: Partial<FloorPlanTable>) => {
    if (onTableUpdate) {
      await onTableUpdate(tableId, updates)
    } else {
      // Default implementation - convert section to sectionId for API
      const { section, ...restUpdates } = updates
      const apiUpdates = {
        ...restUpdates,
        ...(section !== undefined ? { sectionId: section?.id || null } : {}),
        locationId,
      }
      try {
        const response = await fetch(`/api/tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiUpdates),
        })
        if (response.ok) {
          setTables(tables.map(t =>
            t.id === tableId ? { ...t, ...updates } : t
          ))
        }
      } catch (error) {
        toast.error('Failed to update table')
      }
    }
  }, [tables, setTables, onTableUpdate])

  // Handle table delete
  const handleTableDelete = useCallback(async (tableId: string) => {
    if (onTableDelete) {
      await onTableDelete(tableId)
    } else {
      // Default implementation
      try {
        const response = await fetch(`/api/tables/${tableId}?locationId=${locationId}`, {
          method: 'DELETE',
        })
        if (response.ok) {
          setTables(tables.filter(t => t.id !== tableId))
          setEditingTableId(null)
        }
      } catch (error) {
        console.error('Failed to delete table:', error)
      }
    }
  }, [tables, setTables, onTableDelete])

  // Handle seat regeneration
  const handleRegenerateSeats = useCallback(async (tableId: string, pattern: SeatPattern) => {
    const table = tables.find(t => t.id === tableId)
    if (!table) return

    try {
      const response = await fetch(`/api/tables/${tableId}/seats/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: table.capacity,
          seatPattern: pattern,
          replaceExisting: true,
          updateTablePattern: true,
          employeeId,
        }),
      })

      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        setTables(tables.map(t =>
          t.id === tableId
            ? { ...t, seats: data.seats, seatPattern: pattern }
            : t
        ))
      }
    } catch (error) {
      console.error('Failed to regenerate seats:', error)
    }
  }, [tables, setTables, employeeId])

  // Handle status update (for reset to available)
  const handleUpdateStatus = useCallback(async (tableId: string, status: string) => {
    try {
      await fetch(`/api/tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, status }),
      })
      setTables(tables.map(t =>
        t.id === tableId ? { ...t, status: status as FloorPlanTable['status'] } : t
      ))
    } catch (error) {
      console.error('Failed to update status:', error)
    }
  }, [tables, setTables])


  // Handle seat drag (reposition) - admin mode only
  const handleSeatDrag = useCallback(async (tableId: string, seatId: string, newRelativeX: number, newRelativeY: number) => {
    if (mode !== 'admin') return

    try {
      const response = await fetch(`/api/tables/${tableId}/seats/${seatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relativeX: newRelativeX,
          relativeY: newRelativeY,
        }),
      })

      if (response.ok) {
        // Update local state
        setTables(tables.map(t => {
          if (t.id !== tableId) return t
          return {
            ...t,
            seats: t.seats?.map(s =>
              s.id === seatId
                ? { ...s, relativeX: newRelativeX, relativeY: newRelativeY }
                : s
            ),
          }
        }))
      }
    } catch (error) {
      toast.error('Failed to save seat position')
    }
  }, [mode, tables, setTables])

  // Handle add seat - admin mode only
  const handleAddSeat = useCallback(async (tableId: string) => {
    if (mode !== 'admin') return

    const table = tables.find(t => t.id === tableId)
    if (!table) return

    try {
      // Add seat at a default position (center-right of table)
      const response = await fetch(`/api/tables/${tableId}/seats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relativeX: table.width / 2 + 30, // Position to the right of table
          relativeY: 0,
          angle: 270,
          seatType: 'standard',
        }),
      })

      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        // Update local state
        setTables(tables.map(t => {
          if (t.id !== tableId) return t
          return {
            ...t,
            seats: [...(t.seats || []), data.seat],
          }
        }))
      }
    } catch (error) {
      console.error('Failed to add seat:', error)
    }
  }, [mode, tables, setTables])

  // Handle seat delete - admin mode only
  const handleSeatDelete = useCallback(async (tableId: string, seatId: string) => {
    if (mode !== 'admin') return
    if (!confirm('Delete this seat?')) return

    try {
      const response = await fetch(`/api/tables/${tableId}/seats/${seatId}?employeeId=${employeeId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Update local state
        setTables(tables.map(t => {
          if (t.id !== tableId) return t
          return {
            ...t,
            seats: t.seats?.filter(s => s.id !== seatId),
          }
        }))
        clearSelectedSeat()
      }
    } catch (error) {
      console.error('Failed to delete seat:', error)
    }
  }, [mode, tables, setTables, employeeId, clearSelectedSeat])

  // Handle table move by delta (for arrow keys) - admin mode only
  const handleTableMoveByDelta = useCallback(async (tableId: string, deltaX: number, deltaY: number) => {
    if (mode !== 'admin') return

    const table = tables.find(t => t.id === tableId)
    if (!table) return

    // Calculate new position (constrain to positive values)
    const newX = Math.max(0, table.posX + deltaX)
    const newY = Math.max(0, table.posY + deltaY)

    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          posX: newX,
          posY: newY,
        }),
      })

      if (response.ok) {
        setTables(tables.map(t =>
          t.id === tableId ? { ...t, posX: newX, posY: newY } : t
        ))
      }
    } catch (error) {
      toast.error('Failed to move table')
    }
  }, [mode, tables, setTables])

  // Generate unique name for duplicated table
  const generateUniqueName = useCallback((baseName: string): string => {
    const existingNames = tables.map(t => t.name)
    // Remove existing " Copy" or " Copy 2" suffix
    const cleanName = baseName.replace(/ Copy( \d+)?$/, '')

    // Try "Name Copy", then "Name Copy 2", "Name Copy 3", etc.
    let newName = `${cleanName} Copy`
    let counter = 2

    while (existingNames.includes(newName)) {
      newName = `${cleanName} Copy ${counter}`
      counter++
    }

    return newName
  }, [tables])

  // Handle duplicate table - admin mode only
  const handleDuplicateTable = useCallback(async (tableId: string) => {
    if (mode !== 'admin') return

    const table = tables.find(t => t.id === tableId)
    if (!table) return

    const newName = generateUniqueName(table.name)

    try {
      // Create new table with offset position
      const response = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newName,
          capacity: table.capacity,
          shape: table.shape,
          seatPattern: table.seatPattern,
          width: table.width,
          height: table.height,
          posX: table.posX + 50,
          posY: table.posY + 50,
          rotation: table.rotation || 0,
          sectionId: table.section?.id || null,
        }),
      })

      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        // Add to local state and select the new table
        setTables([...tables, data.table])
        selectTable(data.table.id)
        setEditingTableId(data.table.id)
      }
    } catch (error) {
      console.error('Failed to duplicate table:', error)
    }
  }, [mode, tables, locationId, setTables, selectTable, generateUniqueName])

  // Handle table rotation - admin mode only
  const handleTableRotate = useCallback(async (tableId: string, deltaRotation: number) => {
    if (mode !== 'admin') return

    const table = tables.find(t => t.id === tableId)
    if (!table) return

    // Calculate new rotation (keep in 0-359 range)
    const currentRotation = table.rotation || 0
    let newRotation = (currentRotation + deltaRotation) % 360
    if (newRotation < 0) newRotation += 360

    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          rotation: newRotation,
        }),
      })

      if (response.ok) {
        setTables(tables.map(t =>
          t.id === tableId ? { ...t, rotation: newRotation } : t
        ))
      }
    } catch (error) {
      toast.error('Failed to rotate table')
    }
  }, [mode, tables, setTables])

  // Handle seat move by delta (for arrow keys) - admin mode only
  const handleSeatMoveByDelta = useCallback(async (deltaX: number, deltaY: number) => {
    if (mode !== 'admin' || !selectedSeat) return

    const table = tables.find(t => t.id === selectedSeat.tableId)
    if (!table) return

    const seat = table.seats?.find(s => s.seatNumber === selectedSeat.seatNumber)
    if (!seat) return

    // Calculate new position with constraints (max 150px from table center)
    const maxDistance = 150
    let newX = seat.relativeX + deltaX
    let newY = seat.relativeY + deltaY

    // Constrain to max distance from center
    const distance = Math.sqrt(newX * newX + newY * newY)
    if (distance > maxDistance) {
      const scale = maxDistance / distance
      newX = Math.round(newX * scale)
      newY = Math.round(newY * scale)
    }

    // Update via the existing handler
    await handleSeatDrag(selectedSeat.tableId, seat.id, newX, newY)
  }, [mode, selectedSeat, tables, handleSeatDrag])

  // Keyboard handler for table and seat positioning
  useEffect(() => {
    if (mode !== 'admin') return
    // Must have either a seat or table selected
    if (!selectedSeat && !selectedTableId && !editingTableId) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      const increment = e.shiftKey ? 20 : 5
      let deltaX = 0
      let deltaY = 0

      // Handle Ctrl/Cmd+D for duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        const tableId = editingTableId || selectedTableId
        if (tableId && !selectedSeat) {
          handleDuplicateTable(tableId)
        }
        return
      }

      // Handle R for rotation (table only, not seats)
      if (e.key === 'r' || e.key === 'R') {
        const tableId = editingTableId || selectedTableId
        if (tableId && !selectedSeat) {
          e.preventDefault()
          const increment = e.shiftKey ? 15 : 90  // Fine (15°) or coarse (90°)
          const direction = e.altKey ? -1 : 1     // Counter-clockwise if Alt
          handleTableRotate(tableId, increment * direction)
        }
        return
      }

      switch (e.key) {
        case 'ArrowUp':
          deltaY = -increment
          break
        case 'ArrowDown':
          deltaY = increment
          break
        case 'ArrowLeft':
          deltaX = -increment
          break
        case 'ArrowRight':
          deltaX = increment
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          if (selectedSeat) {
            // Delete selected seat
            const table = tables.find(t => t.id === selectedSeat.tableId)
            const seat = table?.seats?.find(s => s.seatNumber === selectedSeat.seatNumber)
            if (seat) {
              handleSeatDelete(selectedSeat.tableId, seat.id)
            }
          } else {
            // Delete selected table
            const tableId = editingTableId || selectedTableId
            if (tableId) {
              handleTableDelete(tableId)
            }
          }
          return
        case 'Escape':
          if (selectedSeat) {
            clearSelectedSeat()
          } else {
            selectTable(null)
            setEditingTableId(null)
          }
          return
        default:
          return
      }

      e.preventDefault()

      if (selectedSeat) {
        // Move seat
        handleSeatMoveByDelta(deltaX, deltaY)
      } else {
        // Move table
        const tableId = editingTableId || selectedTableId
        if (tableId) {
          handleTableMoveByDelta(tableId, deltaX, deltaY)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, selectedSeat, selectedTableId, editingTableId, tables, handleSeatMoveByDelta, handleSeatDelete, clearSelectedSeat, handleTableMoveByDelta, handleTableDelete, handleDuplicateTable, handleTableRotate, selectTable])

  const editingTable = editingTableId ? tables.find(t => t.id === editingTableId) || null : null

  // Calculate table counts per section for RoomTabs
  const tableCountBySection = new Map<string, number>()
  tables.forEach(table => {
    const sectionId = table.section?.id || 'none'
    tableCountBySection.set(sectionId, (tableCountBySection.get(sectionId) || 0) + 1)
  })

  // Filter tables based on selected section
  const filteredTables = selectedSectionId
    ? tables.filter(table => table.section?.id === selectedSectionId)
    : tables

  // Check if there are multiple sections to show tabs
  const showRoomTabs = sections.length > 0

  return (
    <div className={`unified-floor-plan ${className}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      {/* Toolbar - can be hidden when parent provides its own */}
      {!hideToolbar && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'rgba(15, 23, 42, 0.8)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '14px', color: '#94a3b8' }}>
              {mode === 'admin' ? 'Floor Plan Editor' : 'Tables'}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {filteredTables.length}{selectedSectionId ? ` of ${tables.length}` : ''} tables
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {showSeatsToggle && (
              <button
                onClick={toggleShowSeats}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: showSeats ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: showSeats ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: showSeats ? '#a5b4fc' : '#94a3b8',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" strokeWidth={2} />
                  <path strokeWidth={2} d="M12 5v.01M12 19v.01M5 12h.01M19 12h.01M7.05 7.05l.01.01M16.95 16.95l.01.01M7.05 16.95l.01.01M16.95 7.05l.01.01" />
                </svg>
                Seats
              </button>
            )}

            {mode === 'admin' && (
              <button
                onClick={() => onTableCreate?.()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Table
              </button>
            )}
          </div>
        </div>
      )}

      {/* Room/Section Tabs */}
      {showRoomTabs && (
        <RoomTabs
          rooms={sections.map(s => ({ id: s.id, name: s.name, color: s.color }))}
          selectedRoomId={selectedSectionId}
          onRoomSelect={setSelectedSectionId}
          tableCountByRoom={tableCountBySection}
          showAddButton={mode === 'admin'}
          onAddRoom={() => {
            // DEFERRED: Open add section modal — tracked in PM-TASK-BOARD.md
            logger.log('Add section clicked')
          }}
        />
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className="floor-plan-canvas"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={() => {
          selectTable(null)
          setEditingTableId(null)
        }}
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
      >
        {isLoading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#64748b'
          }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
          </div>
        ) : filteredTables.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#64748b'
          }}>
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.5, marginBottom: '16px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p style={{ fontSize: '14px' }}>
              {selectedSectionId ? 'No tables in this section' : 'No tables configured'}
            </p>
            {mode === 'admin' && (
              <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.6 }}>
                Click "Add Table" to get started
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Scale indicator - show when auto-scaled (POS mode only) */}
            {mode === 'pos' && autoScale < 1 && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#a5b4fc',
                  fontSize: '11px',
                  fontWeight: 500,
                  zIndex: 10,
                }}
              >
                {Math.round(autoScale * 100)}% zoom
              </div>
            )}

            {/* Auto-scaled content wrapper */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                transform: mode === 'pos' && autoScale < 1
                  ? `translate(${autoScaleOffset.x}px, ${autoScaleOffset.y}px) scale(${autoScale})`
                  : undefined,
                transformOrigin: 'top left',
                pointerEvents: 'auto',
              }}
            >
            {/* Section labels */}
            {sections.map(section => (
              <div
                key={section.id}
                className="section-label"
                style={{
                  position: 'absolute',
                  left: 10,
                  top: 10,
                  color: section.color,
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {section.name}
              </div>
            ))}

            {/* Tables */}
            <AnimatePresence>
              {filteredTables.map(table => {
                const flash = flashingTables.get(table.id)
                const flashMessage = flash && flash.expiresAt > Date.now() ? flash.message : null

                return (
                  <TableNode
                    key={table.id}
                    table={table}
                    isSelected={selectedTableId === table.id || editingTableId === table.id}
                    isDragging={draggedTableId === table.id}
                    isDropTarget={dropTargetTableId === table.id}
                    showSeats={showSeats}
                    selectedSeat={selectedSeat}
                    flashMessage={flashMessage}
                    onTap={handleTableTapById}
                    onDragStart={handleDragStartById}
                    onDragEnd={endDrag}
                    onLongPress={handleLongPressById}
                    onSeatTap={handleSeatTapById}
                    isEditable={mode === 'admin'}
                    onSeatDrag={(seatId, newX, newY) => handleSeatDrag(table.id, seatId, newX, newY)}
                    onSeatDelete={(seatId) => handleSeatDelete(table.id, seatId)}
                  />
                )
              })}
            </AnimatePresence>
            </div>
            {/* End of auto-scaled content wrapper */}
          </>
        )}
      </div>

      {/* Admin Edit Panel */}
      {mode === 'admin' && (
        <TableEditPanel
          table={editingTable}
          sections={sections}
          isOpen={!!editingTableId}
          onClose={() => setEditingTableId(null)}
          onUpdate={handleTableUpdate}
          onDelete={handleTableDelete}
          onRegenerateSeats={handleRegenerateSeats}
          onAddSeat={handleAddSeat}
          onDuplicate={handleDuplicateTable}
          onRotate={handleTableRotate}
          existingTableNames={tables.map(t => t.name)}
        />
      )}

      {/* POS Info Panel */}
      {mode === 'pos' && infoPanelTableId && (
        <TableInfoPanel
          table={tables.find(t => t.id === infoPanelTableId) || null}
          isOpen={true}
          onClose={closeInfoPanel}
          onAddItems={() => {
            const table = tables.find(t => t.id === infoPanelTableId)
            if (table) onTableSelect?.(table)
            closeInfoPanel()
          }}
          onViewCheck={() => {
            const table = tables.find(t => t.id === infoPanelTableId)
            if (table) onTableSelect?.(table)
            closeInfoPanel()
          }}
          onMarkDirty={() => {
            if (infoPanelTableId) handleUpdateStatus(infoPanelTableId, 'dirty')
          }}
          onMarkAvailable={() => {
            if (infoPanelTableId) handleUpdateStatus(infoPanelTableId, 'available')
          }}
          locationId={locationId}
          employeeId={employeeId}
        />
      )}
    </div>
  )
}

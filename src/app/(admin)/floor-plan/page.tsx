'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/auth-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, floorSubNav } from '@/components/admin/AdminSubNav'
import { toast } from '@/stores/toast-store'
import { useFloorPlanStore, FloorPlanTableType, FloorPlanSection, FloorPlanElement } from '@/components/floor-plan'
import { FloorPlanTable } from '@/components/floor-plan/FloorPlanTable'
import { FloorPlanEntertainment } from '@/components/floor-plan/FloorPlanEntertainment'
import { PropertiesSidebar } from '@/components/floor-plan/PropertiesSidebar'
import { RoomTabs } from '@/components/floor-plan/RoomTabs'
import { AddRoomModal } from '@/components/floor-plan/AddRoomModal'
import { SectionSettings } from '@/components/floor-plan/SectionSettings'
import { AddEntertainmentPalette } from '@/components/floor-plan/AddEntertainmentPalette'
import { useEvents } from '@/lib/events'
import type { EntertainmentVisualType } from '@/components/floor-plan'
import { canPlaceTableAt, getCombinedGroupTables, buildGroupPerimeterPath, calculateMagneticSnap, normalizeCoord, type TableRect } from '@/lib/table-geometry'
import { toTableRect, toTableRectArray } from '@/lib/table-utils'

// Debounce hook for auto-save
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

export default function FloorPlanPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const containerRef = useRef<HTMLDivElement>(null)

  // Local state
  const [editingTableId, setEditingTableId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [hasInitializedSection, setHasInitializedSection] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [pendingPositions, setPendingPositions] = useState<Map<string, { posX: number; posY: number }>>(new Map())

  // Room management state
  const [showAddRoomModal, setShowAddRoomModal] = useState(false)
  const [showSectionSettings, setShowSectionSettings] = useState(false)
  const [showEntertainmentPalette, setShowEntertainmentPalette] = useState(false)

  // Debug mode - show collision boundaries
  const [showCollisionDebug, setShowCollisionDebug] = useState(false)

  // Real-time drag collision state
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null)
  const [dragHasCollision, setDragHasCollision] = useState(false)

  // WebSocket integration for real-time sync
  const { subscribe, isConnected } = useEvents({
    locationId: employee?.location?.id || '',
    autoConnect: !!employee?.location?.id
  })

  // Debounced pending positions for auto-save (4s idle)
  const debouncedPendingSize = useDebounce(pendingPositions.size, 4000)

  // Ref to track if we should auto-save
  const autoSaveEnabledRef = useRef(true)

  // Track original positions before drag for collision revert
  const originalPositionsRef = useRef<Map<string, { posX: number; posY: number }>>(new Map())

  // Track original positions for element drag (entertainment items)
  const elementOriginalPositionsRef = useRef<Map<string, { posX: number; posY: number }>>(new Map())

  // Store
  const {
    tables,
    sections,
    elements,
    showSeats,
    selectedTableId,
    selectedElementId,
    isLoading,
    setTables,
    setSections,
    setElements,
    selectTable,
    selectElement,
    toggleShowSeats,
    setLoading,
    batchUpdatePositions,
    addSection,
    updateSection,
    deleteSection,
    reorderSections,
    addElement,
    updateElement,
    updateElementPosition,
    updateElementSize,
    deleteElement,
  } = useFloorPlanStore()

  // Ref to always have latest tables (avoids stale closure in drag handlers)
  const tablesRef = useRef(tables)
  // Keep ref in sync with state
  useEffect(() => {
    tablesRef.current = tables
  }, [tables])

  // Track table counter for auto-naming
  const [tableCounter, setTableCounter] = useState(1)

  // Update table counter when tables load
  useEffect(() => {
    if (tables.length > 0) {
      // Find highest table number to continue from
      const tableNumbers = tables
        .map((t) => {
          const match = t.name.match(/Table (\d+)/)
          return match ? parseInt(match[1]) : 0
        })
        .filter((n) => n > 0)
      const maxNumber = Math.max(0, ...tableNumbers)
      setTableCounter(maxNumber + 1)
    }
  }, [tables.length])

  // Default to first room when sections load (instead of "All")
  useEffect(() => {
    if (sections.length > 0 && !hasInitializedSection) {
      setSelectedSectionId(sections[0].id)
      setHasInitializedSection(true)
    }
  }, [sections, hasInitializedSection])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/floor-plan')
    }
  }, [isAuthenticated, router])

  // Load floor plan data
  useEffect(() => {
    if (employee?.location?.id) {
      loadFloorPlanData()
    }
  }, [employee?.location?.id])

  // WebSocket: Listen for floor plan updates from other admin sessions or service mode
  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = subscribe('floor-plan:updated', () => {
      console.log('[FloorPlanAdmin] Received floor-plan:updated event, refreshing...')
      // Only reload if we don't have unsaved changes (prevent overwriting user's work)
      if (!hasUnsavedChanges) {
        loadFloorPlanData()
        toast.info('Floor plan updated by another user')
      } else {
        toast.warning('Floor plan changed externally. Save or discard your changes to sync.')
      }
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, hasUnsavedChanges])

  // Auto-save: Debounced save after 4s of no changes
  useEffect(() => {
    if (debouncedPendingSize > 0 && autoSaveEnabledRef.current && !isSaving) {
      handleSaveChanges()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPendingSize])

  // Keyboard shortcuts for table manipulation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if editing text input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!selectedTableId) return

      const table = tables.find(t => t.id === selectedTableId)
      if (!table) return

      const step = e.shiftKey ? 10 : 1
      let newX = table.posX
      let newY = table.posY
      let handled = false

      switch (e.key) {
        case 'ArrowLeft':
          newX -= step
          handled = true
          break
        case 'ArrowRight':
          newX += step
          handled = true
          break
        case 'ArrowUp':
          newY -= step
          handled = true
          break
        case 'ArrowDown':
          newY += step
          handled = true
          break
        case 'Delete':
        case 'Backspace':
          if (e.metaKey || e.ctrlKey) {
            // Cmd/Ctrl + Delete = delete table
            handleTableDelete(selectedTableId)
            handled = true
          }
          break
        case 'Escape':
          setEditingTableId(null)
          selectTable(null)
          handled = true
          break
      }

      if (handled) {
        e.preventDefault()
        if (e.key.startsWith('Arrow')) {
          // Update position
          setPendingPositions(prev => {
            const next = new Map(prev)
            next.set(selectedTableId, { posX: Math.round(newX), posY: Math.round(newY) })
            return next
          })
          setHasUnsavedChanges(true)
          setTables(tables.map(t => t.id === selectedTableId ? { ...t, posX: Math.round(newX), posY: Math.round(newY) } : t))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTableId, tables, setTables, selectTable])

  const loadFloorPlanData = async () => {
    if (!employee?.location?.id) return
    setLoading(true)
    try {
      const [tablesRes, sectionsRes, elementsRes] = await Promise.all([
        fetch(`/api/tables?locationId=${employee.location.id}&includeSeats=true`),
        fetch(`/api/sections?locationId=${employee.location.id}`),
        fetch(`/api/floor-plan-elements?locationId=${employee.location.id}`),
      ])

      if (tablesRes.ok) {
        const data = await tablesRes.json()
        // Normalize coordinates to grid after loading - ensures reset positions
        // are snapped and consistent with the editor's geometry grid
        const normalized = (data.tables || []).map((t: FloorPlanTableType) => ({
          ...t,
          posX: normalizeCoord(t.posX),
          posY: normalizeCoord(t.posY),
        }))
        setTables(normalized)
      }
      if (sectionsRes.ok) {
        const data = await sectionsRes.json()
        setSections(data.sections || [])
      }
      if (elementsRes.ok) {
        const data = await elementsRes.json()
        setElements(data.elements || [])
      }
    } catch (error) {
      console.error('[FloorPlanPage] Load error:', error)
    } finally {
      setLoading(false)
    }
  }

  // Handle drag start - store original position for collision revert
  // Uses tablesRef to avoid stale closure issues
  const handleDragStart = useCallback(
    (tableId: string) => {
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (table) {
        originalPositionsRef.current.set(tableId, { posX: table.posX, posY: table.posY })
        setDraggingTableId(tableId)
        setDragHasCollision(false)
      }
    },
    [] // Uses tablesRef, no dependencies needed
  )

  // Handle drag - check collision in real-time for visual feedback
  // Uses tablesRef to always get latest table positions (avoids stale closure)
  const handleDrag = useCallback(
    (tableId: string, info: { offset: { x: number; y: number } }) => {
      if (!containerRef.current) return

      const currentTables = tablesRef.current
      const rect = containerRef.current.getBoundingClientRect()
      const table = currentTables.find((t) => t.id === tableId)
      if (!table) return

      const originalPos = originalPositionsRef.current.get(tableId)
      if (!originalPos) return

      // Calculate current drag position (round to avoid floating point issues)
      const currentX = Math.round(Math.max(0, Math.min(originalPos.posX + info.offset.x, rect.width - table.width)))
      const currentY = Math.round(Math.max(0, Math.min(originalPos.posY + info.offset.y, rect.height - table.height)))

      // Build exclusion set: self + combined group members
      const excludedIds = new Set<string>([tableId])
      if (table.combinedTableIds) {
        table.combinedTableIds.forEach(id => excludedIds.add(id))
      }
      if (table.combinedWithId) {
        excludedIds.add(table.combinedWithId)
      }

      // Build table rects for collision check (exclude the dragging table and group members)
      // IMPORTANT: Use tablesRef.current to get latest positions
      const otherTables: TableRect[] = currentTables
        .filter(t => !excludedIds.has(t.id))
        .map(t => ({
          id: t.id,
          posX: t.posX,
          posY: t.posY,
          width: t.width,
          height: t.height,
          combinedWithId: t.combinedWithId,
          combinedTableIds: t.combinedTableIds,
        }))

      // Check collision - flush edges (touching) are NOT collisions
      const hasCollision = otherTables.some(other => {
        const movingRect = {
          left: currentX,
          right: currentX + table.width,
          top: currentY,
          bottom: currentY + table.height,
        }
        const otherRect = {
          left: other.posX,
          right: other.posX + other.width,
          top: other.posY,
          bottom: other.posY + other.height,
        }
        // AABB overlap test - touching edges are allowed (<=, >=)
        return !(
          movingRect.right <= otherRect.left ||
          movingRect.left >= otherRect.right ||
          movingRect.bottom <= otherRect.top ||
          movingRect.top >= otherRect.bottom
        )
      })

      setDragHasCollision(hasCollision)
    },
    [] // No dependencies needed - uses ref for latest data
  )

  // Handle drag end - update position with magnetic snap and collision detection
  // Uses tablesRef to always get latest table positions for collision detection
  const handleDragEnd = useCallback(
    async (tableId: string, info: { point: { x: number; y: number }; offset: { x: number; y: number } }) => {
      if (!containerRef.current) return

      // IMPORTANT: Use ref for latest table data to avoid stale closures
      const currentTables = tablesRef.current
      const rect = containerRef.current.getBoundingClientRect()
      const table = currentTables.find((t) => t.id === tableId)
      if (!table) return

      // Get the original position from before the drag started
      const originalPos = originalPositionsRef.current.get(tableId)
      if (!originalPos) {
        console.warn('[FloorPlan] No original position found for drag end')
        return
      }

      // 1) Compute raw new position from drag offset
      const rawX = Math.max(0, Math.min(originalPos.posX + info.offset.x, rect.width - table.width))
      const rawY = Math.max(0, Math.min(originalPos.posY + info.offset.y, rect.height - table.height))

      // 2) Prepare TableRect array for snapping using helpers
      const allRects = toTableRectArray(currentTables)
      const otherRects = allRects.filter(r => r.id !== tableId)

      // 3) Magnetic snap for edge-to-edge docking (T, L, U shapes)
      const snapResult = calculateMagneticSnap(
        { id: tableId, x: rawX, y: rawY, width: table.width, height: table.height },
        otherRects
      )

      // 4) Normalize to grid to prevent floating point errors
      const finalX = normalizeCoord(snapResult.x)
      const finalY = normalizeCoord(snapResult.y)

      // Debug: Log collision check details
      console.log('[FloorPlan] Drag end:', {
        tableId,
        tableName: table.name,
        rawPos: { x: rawX, y: rawY },
        snappedPos: { x: snapResult.x, y: snapResult.y },
        finalPos: { x: finalX, y: finalY },
        snapped: { h: snapResult.snappedHorizontally, v: snapResult.snappedVertically },
        snapTargetId: snapResult.snapTargetId,
      })

      // 5) Collision check at snapped position
      const canPlace = canPlaceTableAt(
        { ...toTableRect(table), posX: finalX, posY: finalY },
        finalX,
        finalY,
        allRects
      )

      if (!canPlace) {
        // Collision detected - revert to original position
        console.warn('[FloorPlan] Collision detected, reverting to original position')
        setTables(currentTables.map((t) => (t.id === tableId ? { ...t, posX: originalPos.posX, posY: originalPos.posY } : t)))
        toast.warning('Cannot place table here - overlaps with another table')
        originalPositionsRef.current.delete(tableId)
        setDraggingTableId(null)
        setDragHasCollision(false)
        return
      }

      // 6) Leader-Follower: If this table is part of a combined group,
      //    move ALL tables in the group by the same delta
      const tableRect = toTableRect(table)
      const groupTables = getCombinedGroupTables(tableRect, allRects)

      // Calculate movement delta from original position
      const dx = finalX - originalPos.posX
      const dy = finalY - originalPos.posY

      if (groupTables.length > 1) {
        // Combined group: move all members by the same delta
        console.log('[FloorPlan] Moving combined group:', {
          leaderId: tableId,
          groupSize: groupTables.length,
          delta: { dx, dy },
        })

        // Build set of group IDs for quick lookup
        const groupIds = new Set(groupTables.map(g => g.id))

        // Apply delta to all group members
        setTables(currentTables.map((t) => {
          if (!groupIds.has(t.id)) return t
          return {
            ...t,
            posX: normalizeCoord(t.posX + dx),
            posY: normalizeCoord(t.posY + dy),
          }
        }))

        // Track pending positions for ALL group members
        setPendingPositions((prev) => {
          const next = new Map(prev)
          for (const member of groupTables) {
            const memberTable = currentTables.find(t => t.id === member.id)
            if (memberTable) {
              next.set(member.id, {
                posX: normalizeCoord(memberTable.posX + dx),
                posY: normalizeCoord(memberTable.posY + dy),
              })
            }
          }
          return next
        })
      } else {
        // Single table: just update this one
        setTables(currentTables.map((t) => (t.id === tableId ? { ...t, posX: finalX, posY: finalY } : t)))

        // Track pending position change for bulk save
        setPendingPositions((prev) => {
          const next = new Map(prev)
          next.set(tableId, { posX: finalX, posY: finalY })
          return next
        })
      }

      setHasUnsavedChanges(true)

      originalPositionsRef.current.delete(tableId)
      setDraggingTableId(null)
      setDragHasCollision(false)

      // 7) If snapped to another table, treat as combine intent
      if (snapResult.snapTargetId && (snapResult.snappedHorizontally || snapResult.snappedVertically)) {
        const targetId = snapResult.snapTargetId
        const targetTable = currentTables.find(t => t.id === targetId)

        // Only auto-combine if neither table is already combined
        const sourceAlreadyCombined = table.combinedWithId || (table.combinedTableIds && table.combinedTableIds.length > 0)
        const targetAlreadyCombined = targetTable?.combinedWithId || (targetTable?.combinedTableIds && targetTable.combinedTableIds.length > 0)

        if (!sourceAlreadyCombined && !targetAlreadyCombined) {
          console.log('[FloorPlan] Tables snapped - showing combine suggestion', { sourceId: tableId, targetId })
          // Show toast with combine option instead of auto-combining
          toast.info(`Tables snapped together. Use "Combine Tables" to link them.`)
        }
      }
    },
    [setTables] // Only setTables needed - uses ref for table data
  )

  // Save all pending changes in bulk
  const handleSaveChanges = useCallback(async () => {
    if (!employee?.location?.id || pendingPositions.size === 0) return

    setIsSaving(true)
    try {
      // Normalize all coordinates before saving to ensure grid alignment
      const updates = Array.from(pendingPositions.entries()).map(([id, pos]) => ({
        id,
        posX: normalizeCoord(pos.posX),
        posY: normalizeCoord(pos.posY),
      }))

      const response = await fetch('/api/tables/bulk-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tables: updates,
          locationId: employee.location.id,
        }),
      })

      if (response.ok) {
        setPendingPositions(new Map())
        setHasUnsavedChanges(false)
        // Update local state with normalized positions
        batchUpdatePositions(updates)
        toast.success('Layout saved as new default')
      }
    } catch (error) {
      console.error('Failed to save changes:', error)
      toast.error('Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }, [employee?.location?.id, pendingPositions, batchUpdatePositions])

  // Instant table creation - creates table and opens sidebar immediately
  const handleAddTableInstant = useCallback(async () => {
    if (!employee?.location?.id) return

    // Use selected room, or first room, never null
    const roomId = selectedSectionId || sections[0]?.id

    if (!roomId) {
      // No rooms exist - prompt user to create one first
      toast.error('Please create a section/room first')
      setShowAddRoomModal(true)
      return
    }

    const newTableName = `Table ${tableCounter}`
    setTableCounter((c) => c + 1)

    try {
      const response = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          name: newTableName,
          capacity: 4,
          shape: 'rectangle',
          width: 80,
          height: 80,
          posX: 100 + Math.random() * 200,
          posY: 100 + Math.random() * 200,
          sectionId: roomId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // Add to local state immediately with section info
        const tableWithSection = {
          ...data.table,
          section: sections.find(s => s.id === roomId) || null
        }
        setTables([...tables, tableWithSection])
        // Select and open sidebar for editing
        setEditingTableId(data.table.id)
        selectTable(data.table.id)
      }
    } catch (error) {
      console.error('Failed to create table:', error)
    }
  }, [employee?.location?.id, tableCounter, tables, setTables, selectTable, selectedSectionId, sections])

  // Handle table update from edit panel
  // Uses tablesRef to avoid stale closure issues
  const handleTableUpdate = useCallback(
    async (tableId: string, updates: Partial<FloorPlanTableType>) => {
      const { section, ...restUpdates } = updates
      const apiUpdates = {
        ...restUpdates,
        ...(section !== undefined ? { sectionId: section?.id || null } : {}),
      }

      try {
        const response = await fetch(`/api/tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiUpdates),
        })
        if (response.ok) {
          setTables(tablesRef.current.map((t) => (t.id === tableId ? { ...t, ...updates } : t)))
        }
      } catch (error) {
        console.error('Failed to update table:', error)
      }
    },
    [setTables] // Uses tablesRef, no need for tables dependency
  )

  // Handle table delete
  // Uses tablesRef to avoid stale closure issues
  const handleTableDelete = useCallback(
    async (tableId: string) => {
      if (!confirm('Delete this table?')) return

      try {
        const response = await fetch(`/api/tables/${tableId}`, { method: 'DELETE' })
        if (response.ok) {
          setTables(tablesRef.current.filter((t) => t.id !== tableId))
          setEditingTableId(null)
        }
      } catch (error) {
        console.error('Failed to delete table:', error)
      }
    },
    [setTables] // Uses tablesRef, no need for tables dependency
  )


  // Handle add seat - with smart orbital placement
  // Uses tablesRef to avoid stale closure issues
  const handleAddSeat = useCallback(
    async (tableId: string) => {
      // IMPORTANT: Use ref for latest table data to avoid stale closures
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (!table) {
        console.warn('[FloorPlan] handleAddSeat: Table not found:', tableId)
        return
      }

      // Flush pending positions before seat operation to prevent race conditions
      if (pendingPositions.size > 0) {
        await handleSaveChanges()
      }

      // Calculate smart position for new seat (orbital placement)
      const existingSeats = table.seats || []
      const seatCount = existingSeats.length
      const radius = Math.max(table.width, table.height) / 2 + 30

      // Find the best angle to place new seat (maximize distance from existing seats)
      let bestAngle = 0
      if (seatCount === 0) {
        bestAngle = -90 // Top position for first seat
      } else if (seatCount === 1) {
        bestAngle = 90 // Opposite side for second seat
      } else {
        // Find the largest gap between existing seats
        const existingAngles = existingSeats.map(s => {
          const angle = Math.atan2(s.relativeY, s.relativeX) * 180 / Math.PI
          return angle
        }).sort((a, b) => a - b)

        let maxGap = 0
        let gapStartAngle = 0
        for (let i = 0; i < existingAngles.length; i++) {
          const nextIndex = (i + 1) % existingAngles.length
          let gap = existingAngles[nextIndex] - existingAngles[i]
          if (gap < 0) gap += 360
          if (gap > maxGap) {
            maxGap = gap
            gapStartAngle = existingAngles[i]
          }
        }
        bestAngle = gapStartAngle + maxGap / 2
      }

      const radians = bestAngle * Math.PI / 180
      const relativeX = Math.round(Math.cos(radians) * radius)
      const relativeY = Math.round(Math.sin(radians) * radius)
      const seatAngle = Math.round((bestAngle + 90 + 360) % 360)

      try {
        const response = await fetch(`/api/tables/${tableId}/seats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            relativeX,
            relativeY,
            angle: seatAngle,
            seatType: 'standard',
          }),
        })

        if (response.ok) {
          const data = await response.json()
          // Use tablesRef.current to get latest state for update
          // IMPORTANT: Always derive capacity from seats.length to prevent state drift
          const newSeats = [...(table.seats || []), data.seat]
          setTables(
            tablesRef.current.map((t) =>
              t.id === tableId ? { ...t, seats: newSeats, capacity: newSeats.length } : t
            )
          )
          toast.success('Seat added')
        } else {
          const errorData = await response.json().catch(() => ({}))
          console.error('[FloorPlan] Failed to add seat:', response.status, errorData)
          toast.error('Failed to add seat')
        }
      } catch (error) {
        console.error('Failed to add seat:', error)
        toast.error('Failed to add seat')
      }
    },
    [setTables, pendingPositions.size, handleSaveChanges] // Uses tablesRef, no need for tables dependency
  )

  // Handle remove seat (by index) - called from clicking seats on canvas
  // Uses tablesRef to avoid stale closure issues
  const handleRemoveSeat = useCallback(
    async (tableId: string, seatIndex: number) => {
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (!table || !table.seats || table.seats.length <= 1) return

      const seatToRemove = table.seats[seatIndex]
      if (!seatToRemove) return

      try {
        const response = await fetch(`/api/tables/${tableId}/seats/${seatToRemove.id}`, {
          method: 'DELETE',
        })

        if (response.ok) {
          const newSeats = table.seats.filter((_, i) => i !== seatIndex)
          // Renumber remaining seats
          const renumberedSeats = newSeats.map((s, i) => ({ ...s, seatNumber: i + 1 }))
          setTables(
            tablesRef.current.map((t) =>
              t.id === tableId ? { ...t, seats: renumberedSeats, capacity: renumberedSeats.length } : t
            )
          )
        }
      } catch (error) {
        console.error('Failed to remove seat:', error)
      }
    },
    [setTables] // Uses tablesRef, no need for tables dependency
  )

  // Handle remove last seat (from sidebar button)
  // Uses tablesRef to avoid stale closure issues
  const handleRemoveLastSeat = useCallback(
    async (tableId: string) => {
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (!table || !table.seats || table.seats.length <= 1) return

      const lastIndex = table.seats.length - 1
      await handleRemoveSeat(tableId, lastIndex)
    },
    [handleRemoveSeat] // Uses tablesRef, no need for tables dependency
  )

  // Handle reset all seats to auto-orbital positions
  // Uses tablesRef to avoid stale closure issues
  const handleResetSeats = useCallback(
    async (tableId: string) => {
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (!table || !table.seats || table.seats.length === 0) return

      // Flush pending positions first
      if (pendingPositions.size > 0) {
        await handleSaveChanges()
      }

      // Calculate orbital positions for all seats
      const seatCount = table.seats.length
      const radius = Math.max(table.width, table.height) / 2 + 30

      const updates = table.seats.map((seat, i) => {
        const angle = -90 + (i * 360 / seatCount) // Start from top, distribute evenly
        const radians = angle * Math.PI / 180
        return {
          id: seat.id,
          relativeX: Math.round(Math.cos(radians) * radius),
          relativeY: Math.round(Math.sin(radians) * radius),
          angle: Math.round((angle + 90 + 360) % 360),
        }
      })

      // Update all seats via API
      try {
        await Promise.all(
          updates.map(update =>
            fetch(`/api/tables/${tableId}/seats/${update.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                relativeX: update.relativeX,
                relativeY: update.relativeY,
                angle: update.angle,
              }),
            })
          )
        )

        // Update local state
        const updatedSeats = table.seats.map((seat, i) => ({
          ...seat,
          relativeX: updates[i].relativeX,
          relativeY: updates[i].relativeY,
          angle: updates[i].angle,
        }))

        setTables(tablesRef.current.map((t) => (t.id === tableId ? { ...t, seats: updatedSeats } : t)))
        toast.success('Seats reset to auto layout')
      } catch (error) {
        console.error('Failed to reset seats:', error)
        toast.error('Failed to reset seats')
      }
    },
    [setTables, pendingPositions.size, handleSaveChanges] // Uses tablesRef, no need for tables dependency
  )

  // Handle split/uncombine tables - separates a combined group back to individual tables
  // Uses "scatter" positioning to prevent tables from stacking at 0,0
  const handleSplitCombinedTables = useCallback(
    async (primaryTableId: string) => {
      const currentTables = tablesRef.current
      const primaryTable = currentTables.find((t) => t.id === primaryTableId)
      if (!primaryTable || !primaryTable.combinedTableIds || primaryTable.combinedTableIds.length === 0) {
        toast.warning('Table is not part of a combined group')
        return
      }

      // Get all table IDs in the group
      const allTableIds = [primaryTableId, ...primaryTable.combinedTableIds]

      // Gather all tables in the group with their original positions
      const groupTables = allTableIds.map(id => currentTables.find(t => t.id === id)).filter(Boolean) as typeof currentTables

      // Store the base position for fallback scatter (prevents 0,0 stacking)
      const basePosX = primaryTable.posX
      const basePosY = primaryTable.posY

      try {
        // Update all tables in the group via API - restore original positions if available
        await Promise.all(
          groupTables.map((table, index) => {
            // Use original position if saved, otherwise scatter from base
            const hasOriginalPos = table.originalPosX !== null && table.originalPosX > 0
            const restoredPosX = hasOriginalPos ? table.originalPosX! : basePosX + index * 40
            const restoredPosY = hasOriginalPos ? table.originalPosY! : basePosY + index * 40

            return fetch(`/api/tables/${table.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                combinedWithId: null,
                combinedTableIds: [],
                // Restore to original position or scatter
                posX: normalizeCoord(restoredPosX),
                posY: normalizeCoord(restoredPosY),
                // Clear original position fields after restore
                originalPosX: null,
                originalPosY: null,
                originalName: null,
              }),
            })
          })
        )

        // Optimistically update local state with restored positions
        setTables(
          currentTables.map((t) => {
            if (allTableIds.includes(t.id)) {
              const tableIndex = allTableIds.indexOf(t.id)
              const hasOriginalPos = t.originalPosX !== null && t.originalPosX > 0
              return {
                ...t,
                combinedWithId: null,
                combinedTableIds: [],
                posX: normalizeCoord(hasOriginalPos ? t.originalPosX! : basePosX + tableIndex * 40),
                posY: normalizeCoord(hasOriginalPos ? t.originalPosY! : basePosY + tableIndex * 40),
                originalPosX: null,
                originalPosY: null,
                originalName: null,
              }
            }
            return t
          })
        )

        toast.success(`Split ${allTableIds.length} tables`)
      } catch (error) {
        console.error('Failed to split combined tables:', error)
        toast.error('Failed to split tables')
      }
    },
    [setTables]
  )

  // Handle seat position change (drag or arrow keys)
  // Uses tablesRef to avoid stale closure issues
  const handleSeatPositionChange = useCallback(
    async (tableId: string, seatIndex: number, relativeX: number, relativeY: number) => {
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (!table || !table.seats) return

      const seat = table.seats[seatIndex]
      if (!seat) return

      // Optimistically update local state
      const updatedSeats = table.seats.map((s, i) =>
        i === seatIndex ? { ...s, relativeX, relativeY } : s
      )
      setTables(tablesRef.current.map((t) => (t.id === tableId ? { ...t, seats: updatedSeats } : t)))

      // Debounced save to API (we'll save on mouse up / key up)
      try {
        await fetch(`/api/tables/${tableId}/seats/${seat.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relativeX, relativeY }),
        })
      } catch (error) {
        console.error('Failed to update seat position:', error)
      }
    },
    [setTables] // Uses tablesRef, no need for tables dependency
  )

  // Handle duplicate table
  // Uses tablesRef to avoid stale closure issues
  const handleDuplicateTable = useCallback(
    async (tableId: string) => {
      const currentTables = tablesRef.current
      const table = currentTables.find((t) => t.id === tableId)
      if (!table || !employee?.location?.id) return

      try {
        const response = await fetch('/api/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: employee.location.id,
            name: `${table.name} Copy`,
            capacity: table.capacity,
            shape: table.shape,
            width: table.width,
            height: table.height,
            seatPattern: table.seatPattern,
            posX: table.posX + 20,
            posY: table.posY + 20,
          }),
        })

        if (response.ok) {
          loadFloorPlanData()
        }
      } catch (error) {
        console.error('Failed to duplicate table:', error)
      }
    },
    [employee?.location?.id] // Uses tablesRef, no need for tables dependency
  )

  // Handle rotate table
  // Uses tablesRef to avoid stale closure issues
  const handleTableRotate = useCallback(
    async (tableId: string, rotation: number) => {
      try {
        const response = await fetch(`/api/tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotation }),
        })
        if (response.ok) {
          setTables(tablesRef.current.map((t) => (t.id === tableId ? { ...t, rotation } : t)))
        }
      } catch (error) {
        console.error('Failed to rotate table:', error)
      }
    },
    [setTables] // Uses tablesRef, no need for tables dependency
  )

  // Handle room created
  const handleRoomCreated = useCallback(
    (room: { id: string; name: string; color: string; sortOrder: number }) => {
      addSection({
        id: room.id,
        name: room.name,
        color: room.color,
        posX: 0,
        posY: 0,
        width: 400,
        height: 300,
      })
      // Auto-select the new room
      setSelectedSectionId(room.id)
    },
    [addSection]
  )

  // Handle room reorder
  const handleRoomReorder = useCallback(
    async (reorderedRooms: { id: string; name: string; color: string }[]) => {
      // Optimistically update
      reorderSections(
        reorderedRooms.map((r, i) => ({
          ...r,
          posX: 0,
          posY: 0,
          width: 400,
          height: 300,
        }))
      )

      // Save to API
      try {
        await fetch('/api/sections/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomIds: reorderedRooms.map((r) => r.id) }),
        })
      } catch (error) {
        console.error('Failed to reorder rooms:', error)
      }
    },
    [reorderSections]
  )

  // Handle room delete - with safety guard
  // Uses tablesRef to avoid stale closure issues
  const handleRoomDelete = useCallback(
    async (roomId: string) => {
      // Safety guard: Check if section has tables
      const currentTables = tablesRef.current
      const tablesInSection = currentTables.filter(t => t.section?.id === roomId)
      if (tablesInSection.length > 0) {
        toast.error(`Cannot delete section with ${tablesInSection.length} table(s). Move or delete them first.`)
        return
      }

      try {
        const response = await fetch(`/api/sections/${roomId}`, { method: 'DELETE' })
        if (response.ok) {
          deleteSection(roomId)
          toast.success('Section deleted')
          // If we deleted the selected room, select the first remaining room
          if (selectedSectionId === roomId) {
            const remainingSections = sections.filter(s => s.id !== roomId)
            setSelectedSectionId(remainingSections[0]?.id || null)
          }
        }
      } catch (error) {
        console.error('Failed to delete room:', error)
      }
    },
    [deleteSection, selectedSectionId, sections] // Uses tablesRef, no need for tables dependency
  )

  // Handle room edit
  const handleRoomEdit = useCallback(
    async (roomId: string, updates: { name?: string; color?: string }) => {
      // Optimistically update
      updateSection(roomId, updates)

      // Save to API
      try {
        await fetch(`/api/sections/${roomId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
      } catch (error) {
        console.error('Failed to update room:', error)
      }
    },
    [updateSection]
  )

  // Handle add entertainment element
  const handleAddElement = useCallback(
    async (elementData: {
      name: string
      visualType: EntertainmentVisualType
      linkedMenuItemId: string
      width: number
      height: number
    }) => {
      if (!employee?.location?.id) {
        console.error('No location ID')
        return
      }

      const payload = {
        locationId: employee.location.id,
        sectionId: selectedSectionId,
        name: elementData.name,
        visualType: elementData.visualType,
        linkedMenuItemId: elementData.linkedMenuItemId,
        width: elementData.width,
        height: elementData.height,
        posX: 150 + Math.random() * 100,
        posY: 150 + Math.random() * 100,
      }

      console.log('[FloorPlan] Creating element with payload:', payload)

      try {
        const response = await fetch('/api/floor-plan-elements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await response.json()
        console.log('[FloorPlan] API response:', response.status, data)

        if (response.ok && data.element) {
          addElement({
            ...data.element,
            waitlistCount: 0,
          })
          selectElement(data.element.id)
        } else {
          console.error('[FloorPlan] Failed to create element:', data.error || 'Unknown error')
        }
      } catch (error) {
        console.error('[FloorPlan] Failed to create element:', error)
      }
    },
    [employee?.location?.id, selectedSectionId, addElement, selectElement]
  )

  // Get IDs of menu items already placed on floor plan
  const placedMenuItemIds = elements
    .filter((el) => el.linkedMenuItemId)
    .map((el) => el.linkedMenuItemId as string)

  // Handle element drag start - store original position for proper offset calculation
  const handleElementDragStart = useCallback(
    (elementId: string) => {
      const element = elements.find((el) => el.id === elementId)
      if (element) {
        elementOriginalPositionsRef.current.set(elementId, { posX: element.posX, posY: element.posY })
      }
    },
    [elements]
  )

  // Handle element position change (drag end) - uses offset from original position
  const handleElementDragEnd = useCallback(
    async (elementId: string, info: { offset: { x: number; y: number } }) => {
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const element = elements.find((el) => el.id === elementId)
      if (!element) return

      // Get original position from before drag started
      const originalPos = elementOriginalPositionsRef.current.get(elementId)
      if (!originalPos) {
        console.warn('[FloorPlan] No original position found for element drag end')
        return
      }

      // Calculate new position using offset from original
      const newX = Math.max(0, Math.min(originalPos.posX + info.offset.x, rect.width - element.width))
      const newY = Math.max(0, Math.min(originalPos.posY + info.offset.y, rect.height - element.height))

      // Clear the original position
      elementOriginalPositionsRef.current.delete(elementId)

      // Optimistically update local state
      updateElementPosition(elementId, Math.round(newX), Math.round(newY))

      // Save to API
      try {
        const response = await fetch(`/api/floor-plan-elements/${elementId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ posX: Math.round(newX), posY: Math.round(newY) }),
        })
        if (response.ok) {
          toast.success('Element position saved')
        }
      } catch (error) {
        console.error('Failed to update element position:', error)
      }
    },
    [elements, updateElementPosition]
  )

  // Handle element size change
  const handleElementSizeChange = useCallback(
    async (elementId: string, width: number, height: number) => {
      // Optimistically update local state
      updateElementSize(elementId, Math.round(width), Math.round(height))

      // Debounced save to API
      try {
        await fetch(`/api/floor-plan-elements/${elementId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ width: Math.round(width), height: Math.round(height) }),
        })
      } catch (error) {
        console.error('Failed to update element size:', error)
      }
    },
    [updateElementSize]
  )

  // Handle element rotation change
  const handleElementRotationChange = useCallback(
    async (elementId: string, rotation: number) => {
      // Optimistically update local state
      updateElement(elementId, { rotation })

      // Save to API
      try {
        await fetch(`/api/floor-plan-elements/${elementId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotation }),
        })
      } catch (error) {
        console.error('Failed to update element rotation:', error)
      }
    },
    [updateElement]
  )

  // Handle element delete
  const handleElementDelete = useCallback(
    async (elementId: string) => {
      try {
        const response = await fetch(`/api/floor-plan-elements/${elementId}`, {
          method: 'DELETE',
        })

        if (response.ok) {
          deleteElement(elementId)
        }
      } catch (error) {
        console.error('Failed to delete element:', error)
      }
    },
    [deleteElement]
  )

  // Filter tables by section - memoized to prevent unnecessary re-renders
  const filteredTables = useMemo(() => {
    const filtered = selectedSectionId
      ? tables.filter((table) => table.section?.id === selectedSectionId)
      : tables
    // Ensure all positions are valid numbers (prevents animation to 0,0)
    return filtered.map(t => ({
      ...t,
      posX: typeof t.posX === 'number' && !isNaN(t.posX) ? t.posX : 100,
      posY: typeof t.posY === 'number' && !isNaN(t.posY) ? t.posY : 100,
    }))
  }, [tables, selectedSectionId])

  // Filter elements by section - memoized to prevent unnecessary re-renders
  const filteredElements = useMemo(() => {
    const filtered = selectedSectionId
      ? elements.filter((el) => el.sectionId === selectedSectionId || el.sectionId === null)
      : elements
    // Ensure all positions are valid numbers (prevents animation to 0,0)
    return filtered.map(el => ({
      ...el,
      posX: typeof el.posX === 'number' && !isNaN(el.posX) ? el.posX : 100,
      posY: typeof el.posY === 'number' && !isNaN(el.posY) ? el.posY : 100,
    }))
  }, [elements, selectedSectionId])

  // Count tables per section as Map
  const tableCountBySection = new Map<string, number>()
  sections.forEach((s) => {
    tableCountBySection.set(s.id, tables.filter((t) => t.section?.id === s.id).length)
  })

  // Calculate bounding box of all tables (for bounds warning)
  const tableBounds = useMemo(() => {
    if (tables.length === 0) return null

    let minX = Infinity, minY = Infinity
    let maxX = -Infinity, maxY = -Infinity

    tables.forEach(table => {
      minX = Math.min(minX, table.posX)
      minY = Math.min(minY, table.posY)
      maxX = Math.max(maxX, table.posX + (table.width || 100))
      maxY = Math.max(maxY, table.posY + (table.height || 100))
    })

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
  }, [tables])

  // Check if any tables are placed outside the fixed canvas (1200x800)
  // Threshold allows margin but warns for tables that require significant scrolling
  const hasOutOfBoundsTables = useMemo(() => {
    return tables.some(t => t.posX > 1100 || t.posY > 700 || t.posX < 0 || t.posY < 0)
  }, [tables])

  // Fit to screen: DISABLED - Positions are managed by admin through drag/drop
  // Auto-repositioning caused layout instability across different screen sizes
  const handleFitToScreen = useCallback(() => {
    toast.info('Auto-repositioning is disabled. Use the canvas scroll to view all tables, or drag tables manually.')
  }, [])

  // Save current positions as the default layout for "Reset to Default" operations
  const handleSaveAsDefaultLayout = useCallback(async () => {
    if (!employee?.location?.id) return

    const payload = tables.map(t => ({
      id: t.id,
      defaultPosX: normalizeCoord(t.posX),
      defaultPosY: normalizeCoord(t.posY),
      defaultSectionId: t.section?.id ?? null,
    }))

    try {
      const response = await fetch('/api/tables/save-default-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          tables: payload,
        }),
      })

      if (response.ok) {
        toast.success('Default layout saved. "Reset to Default" will restore tables to these positions.')
      } else {
        const errorData = await response.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to save default layout')
      }
    } catch (error) {
      console.error('[FloorPlan] Save default layout error:', error)
      toast.error('Failed to save default layout')
    }
  }, [employee?.location?.id, tables])

  const editingTable = editingTableId ? tables.find((t) => t.id === editingTableId) : null

  if (!isAuthenticated || !employee?.location?.id) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Floor Plan Editor"
        subtitle="Drag tables to position them. Click to edit properties and seats."
      />
      <AdminSubNav items={floorSubNav} basePath="/floor-plan" />

      <div className="mt-6 rounded-lg overflow-hidden" style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' }}>
        {/* Header Actions */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Connection status indicator */}
            <div
              title={isConnected ? 'Real-time sync active' : 'Connecting...'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: isConnected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(251, 191, 36, 0.1)',
                border: `1px solid ${isConnected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(251, 191, 36, 0.3)'}`,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isConnected ? '#22c55e' : '#fbbf24',
                  boxShadow: isConnected ? '0 0 8px #22c55e' : 'none',
                }}
              />
              <span style={{ fontSize: '11px', color: isConnected ? '#4ade80' : '#fbbf24' }}>
                {isConnected ? 'Live' : 'Connecting'}
              </span>
            </div>

            {/* Unsaved changes indicator */}
            {hasUnsavedChanges && (
              <span className="text-amber-400 text-sm animate-pulse">Unsaved changes</span>
            )}

            {/* Save Button */}
            {hasUnsavedChanges && (
              <button
                onClick={handleSaveChanges}
                disabled={isSaving}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  opacity: isSaving ? 0.7 : 1,
                }}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            )}

            {/* Save as Default Layout - Sets canonical positions for Reset to Default */}
            <button
              onClick={handleSaveAsDefaultLayout}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: '#60a5fa',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              title="Save current positions as the default layout for 'Reset to Default'"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              Save as Default
            </button>

            {/* Show Seats Toggle */}
            <button
              onClick={toggleShowSeats}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                background: showSeats ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: showSeats ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                color: showSeats ? '#a5b4fc' : '#94a3b8',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" strokeWidth="2" />
                <circle cx="12" cy="12" r="8" strokeWidth="2" strokeDasharray="4 2" />
              </svg>
              {showSeats ? 'Seats On' : 'Seats Off'}
            </button>

            {/* Debug Collision Boundaries Toggle */}
            <button
              onClick={() => setShowCollisionDebug(!showCollisionDebug)}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                background: showCollisionDebug ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: showCollisionDebug ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                color: showCollisionDebug ? '#fca5a5' : '#94a3b8',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              title="Show collision boundaries (debug mode)"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" strokeDasharray="4 2" />
              </svg>
              {showCollisionDebug ? 'Bounds On' : 'Bounds Off'}
            </button>

            {/* Section Settings */}
            {sections.length > 0 && (
              <button
                onClick={() => setShowSectionSettings(true)}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94a3b8',
                  cursor: 'pointer',
                }}
                title="Manage Sections"
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}

            {/* Add Entertainment */}
            <button
              onClick={() => setShowEntertainmentPalette(true)}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: 'none',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              + Entertainment
            </button>

            {/* Add Table - Instant creation */}
            <button
              onClick={handleAddTableInstant}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + Add Table
            </button>
          </div>
        </div>

        {/* Room/Section Tabs */}
        <RoomTabs
          rooms={sections.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          selectedRoomId={selectedSectionId}
          onRoomSelect={setSelectedSectionId}
          tableCountByRoom={tableCountBySection}
          showAddButton={true}
          onAddRoom={() => setShowAddRoomModal(true)}
          showAllTab={false}
        />

        {/* Bounds Warning Banner */}
        {hasOutOfBoundsTables && (
          <div
            style={{
              margin: '0 24px',
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              color: '#fbbf24',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>
              Some tables are placed outside the canvas (1200×800). Scroll the canvas to view them, or drag tables to reposition.
            </span>
          </div>
        )}

        {/* Floor Plan Canvas - Fixed size with scrolling */}
        <div
          ref={containerRef}
          style={{
            width: '1200px',           // Fixed logical width
            height: '800px',           // Fixed logical height
            margin: '24px',
            position: 'relative',
            overflow: 'auto',          // Scroll if tables exceed canvas
            borderRadius: '16px',
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            // Blueprint grid pattern
            backgroundImage: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
          onClick={() => {
            selectTable(null)
            selectElement(null)
            setEditingTableId(null)
          }}
        >
          {isLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#64748b',
              }}
            >
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </motion.div>
            </div>
          ) : filteredTables.length === 0 && filteredElements.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#64748b',
              }}
            >
              <p className="font-mono text-xs uppercase tracking-widest">Canvas Empty</p>
              <p className="text-[10px] mt-2 italic">Add a table or entertainment to begin mapping this section.</p>
            </div>
          ) : (
            <AnimatePresence>
              {/* Combined Table Ghost Groups - Render perimeter outlines for T/L/U shaped combined tables */}
              {filteredTables
                .filter(t => t.combinedTableIds && t.combinedTableIds.length > 0)
                .map(primaryTable => {
                  // Get all tables in the combine group
                  const groupTableIds = [primaryTable.id, ...(primaryTable.combinedTableIds || [])]
                  const groupTables = tables.filter(t => groupTableIds.includes(t.id))
                  if (groupTables.length < 2) return null

                  // Convert to TableRect format for geometry calculations
                  const groupRects: TableRect[] = groupTables.map(t => ({
                    id: t.id,
                    posX: t.posX,
                    posY: t.posY,
                    width: t.width,
                    height: t.height,
                    combinedWithId: t.combinedWithId,
                    combinedTableIds: t.combinedTableIds,
                  }))

                  // Build the perimeter path for the actual T/L/U shape
                  const perimeterPath = buildGroupPerimeterPath(groupRects)

                  // Calculate bounding box for positioning the SVG and label
                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
                  let totalSeats = 0
                  groupTables.forEach(t => {
                    minX = Math.min(minX, t.posX)
                    minY = Math.min(minY, t.posY)
                    maxX = Math.max(maxX, t.posX + t.width)
                    maxY = Math.max(maxY, t.posY + t.height)
                    totalSeats += t.seats?.length || t.capacity || 0
                  })

                  const groupColor = primaryTable.virtualGroupColor || '#6366f1'
                  const padding = 15 // Padding around the group

                  return (
                    <div
                      key={`combine-ghost-${primaryTable.id}`}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}
                    >
                      {/* SVG perimeter path - traces the actual T/L/U shape */}
                      <svg
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: '100%',
                          height: '100%',
                          overflow: 'visible',
                        }}
                      >
                        <path
                          d={perimeterPath}
                          fill="none"
                          stroke={groupColor}
                          strokeWidth="2"
                          strokeDasharray="6 4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      {/* Combined label */}
                      <span
                        style={{
                          position: 'absolute',
                          left: (minX + maxX) / 2,
                          top: minY - padding,
                          transform: 'translate(-50%, -100%)',
                          background: groupColor,
                          color: '#fff',
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Combined • {totalSeats} seats
                      </span>
                    </div>
                  )
                })}

              {/* Tables */}
              {filteredTables.map((table) => {
                const isDragging = draggingTableId === table.id
                const showCollisionWarning = isDragging && dragHasCollision

                return (
                <motion.div
                  key={table.id}
                  drag={!table.combinedWithId} // Prevent dragging secondary combined tables
                  dragMomentum={false}
                  dragConstraints={containerRef}
                  onDragStart={() => handleDragStart(table.id)}
                  onDrag={(_, info) => handleDrag(table.id, info)}
                  onDragEnd={(_, info) => handleDragEnd(table.id, info)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingTableId(table.id)
                    selectTable(table.id)
                  }}
                  className="absolute cursor-grab active:cursor-grabbing"
                  style={{
                    // Use CSS positioning instead of framer-motion animate to prevent resize jump
                    left: table.posX,
                    top: table.posY,
                    transform: `rotate(${table.rotation || 0}deg)`,
                    width: table.width,
                    height: table.height,
                    zIndex: selectedTableId === table.id ? 50 : (isDragging ? 100 : 10),
                  }}
                  whileDrag={{ scale: 1.05 }}
                >
                  <FloorPlanTable
                    table={table}
                    mode="admin"
                    isSelected={selectedTableId === table.id || editingTableId === table.id}
                    showSeats={showSeats}
                    tableRotation={table.rotation || 0}
                    groupTables={
                      // For combined groups, pass all group tables for perimeter-based seating
                      // Uses toTableRect/toTableRectArray helpers for clean mapping
                      (table.combinedTableIds && table.combinedTableIds.length > 0)
                        ? getCombinedGroupTables(toTableRect(table), toTableRectArray(tables))
                        : undefined
                    }
                    onSeatRemove={(seatIndex) => handleRemoveSeat(table.id, seatIndex)}
                    onSeatPositionChange={(seatIndex, x, y) => handleSeatPositionChange(table.id, seatIndex, x, y)}
                  />

                  {/* RED COLLISION WARNING - shows when dragging over invalid area */}
                  {showCollisionWarning && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -4,
                        left: -4,
                        right: -4,
                        bottom: -4,
                        background: 'rgba(239, 68, 68, 0.3)',
                        border: '3px solid #ef4444',
                        borderRadius: '8px',
                        pointerEvents: 'none',
                        boxSizing: 'border-box',
                        animation: 'pulse 0.5s ease-in-out infinite alternate',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          background: '#ef4444',
                          color: '#fff',
                          padding: '4px 12px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        }}
                      >
                        ⚠️ Cannot place here
                      </div>
                    </div>
                  )}

                  {/* Collision boundary debug overlay */}
                  {showCollisionDebug && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        border: '2px dashed rgba(239, 68, 68, 0.8)',
                        borderRadius: '4px',
                        pointerEvents: 'none',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Position label */}
                      <div
                        style={{
                          position: 'absolute',
                          top: -20,
                          left: 0,
                          fontSize: '10px',
                          color: '#ef4444',
                          background: 'rgba(0,0,0,0.8)',
                          padding: '2px 4px',
                          borderRadius: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {table.posX},{table.posY} ({table.width}×{table.height})
                      </div>
                    </div>
                  )}

                  {/* Contextual +Seat button - "Pull Up a Chair" */}
                  {(selectedTableId === table.id || editingTableId === table.id) && (
                    <motion.button
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAddSeat(table.id)
                      }}
                      style={{
                        position: 'absolute',
                        bottom: -32,
                        left: '50%',
                        transform: 'translateX(-50%) rotate(0deg)', // Counter-rotate to stay upright
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                        border: '2px solid #fff',
                        color: '#fff',
                        fontSize: '16px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(34, 197, 94, 0.4)',
                        zIndex: 60,
                      }}
                      title="Add seat"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      +
                    </motion.button>
                  )}

                  {/* Combined table indicator badge */}
                  {table.combinedWithId && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -8,
                        left: -8,
                        background: table.virtualGroupColor || '#6366f1',
                        color: '#fff',
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '8px',
                        border: '2px solid rgba(255,255,255,0.3)',
                      }}
                    >
                      LINKED
                    </div>
                  )}
                </motion.div>
              )})}

              {/* Entertainment Elements */}
              {filteredElements.map((element) => (
                <motion.div
                  key={element.id}
                  drag
                  dragMomentum={false}
                  dragConstraints={containerRef}
                  onDragStart={() => handleElementDragStart(element.id)}
                  onDragEnd={(_, info) => handleElementDragEnd(element.id, info)}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectElement(element.id)
                  }}
                  className="absolute cursor-grab active:cursor-grabbing"
                  style={{
                    // Use CSS positioning instead of framer-motion animate to prevent resize jump
                    left: element.posX,
                    top: element.posY,
                    width: element.width,
                    height: element.height,
                    zIndex: selectedElementId === element.id ? 50 : 10,
                  }}
                  whileDrag={{ scale: 1.05, zIndex: 100 }}
                >
                  <FloorPlanEntertainment
                    element={element}
                    isSelected={selectedElementId === element.id}
                    mode="admin"
                    onSelect={() => selectElement(element.id)}
                    onSizeChange={(width, height) => handleElementSizeChange(element.id, width, height)}
                    onRotationChange={(rotation) => handleElementRotationChange(element.id, rotation)}
                    onDelete={() => handleElementDelete(element.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Properties Sidebar */}
      <PropertiesSidebar
        table={editingTable || null}
        sections={sections}
        isOpen={!!editingTableId}
        onClose={() => {
          setEditingTableId(null)
          selectTable(null)
        }}
        onUpdate={handleTableUpdate}
        onDelete={handleTableDelete}
        onDuplicate={handleDuplicateTable}
        onAddSeat={handleAddSeat}
        onRemoveSeat={handleRemoveLastSeat}
        onResetSeats={handleResetSeats}
        onSplit={handleSplitCombinedTables}
      />

      {/* Add Room Modal */}
      <AddRoomModal
        isOpen={showAddRoomModal}
        onClose={() => setShowAddRoomModal(false)}
        locationId={employee?.location?.id || ''}
        onRoomCreated={handleRoomCreated}
      />

      {/* Section Settings Panel */}
      <SectionSettings
        isOpen={showSectionSettings}
        onClose={() => setShowSectionSettings(false)}
        rooms={sections.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
        onReorder={handleRoomReorder}
        onDelete={handleRoomDelete}
        onRoomEdit={handleRoomEdit}
      />

      {/* Add Entertainment Palette */}
      <AddEntertainmentPalette
        isOpen={showEntertainmentPalette}
        onClose={() => setShowEntertainmentPalette(false)}
        locationId={employee?.location?.id || ''}
        selectedSectionId={selectedSectionId}
        placedMenuItemIds={placedMenuItemIds}
        onAddElement={handleAddElement}
      />
    </div>
  )
}

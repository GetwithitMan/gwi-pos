'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, FloorPlanTable } from './use-floor-plan'
import { TableNode, getCombinedGroupColor } from './TableNode'
import { TableInfoPanel } from './TableInfoPanel'
import { CategoriesBar } from './CategoriesBar'
import { calculateAttachSide, calculateAttachPosition } from './table-positioning'
import './styles/floor-plan.css'

interface Category {
  id: string
  name: string
  color?: string
  itemCount?: number
  categoryType?: string  // food, drinks, liquor, etc.
}

interface FloorPlanHomeProps {
  locationId: string
  employeeId: string
  employeeName: string
  employeeRole?: string
  onNavigateToOrders: (tableId?: string, orderId?: string) => void
  onStartNewTab: () => void
  onCategoryClick?: (categoryId: string) => void  // Tab workflow: tap category first
  onLogout: () => void
  onOpenSettings?: () => void
  onOpenAdminNav?: () => void
  isManager?: boolean
}

export function FloorPlanHome({
  locationId,
  employeeId,
  employeeName,
  employeeRole,
  onNavigateToOrders,
  onStartNewTab,
  onCategoryClick,
  onLogout,
  onOpenSettings,
  onOpenAdminNav,
  isManager = false,
}: FloorPlanHomeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [lastDropPosition, setLastDropPosition] = useState<{ x: number; y: number } | null>(null)

  const {
    tables,
    sections,
    selectedTableId,
    draggedTableId,
    dropTargetTableId,
    infoPanelTableId,
    undoStack,
    isLoading,
    showSeats,
    selectedSeat,
    flashingTables,
    setTables,
    setSections,
    selectTable,
    startDrag,
    updateDragTarget,
    endDrag,
    openInfoPanel,
    closeInfoPanel,
    addUndoAction,
    popUndoAction,
    clearExpiredUndos,
    toggleShowSeats,
    selectSeat,
    clearSelectedSeat,
    flashTableMessage,
    clearExpiredFlashes,
    setLoading,
  } = useFloorPlanStore()

  // Load data on mount
  useEffect(() => {
    loadFloorPlanData()
    loadCategories()
  }, [locationId])

  // Clear expired undos and flashes
  useEffect(() => {
    const interval = setInterval(() => {
      clearExpiredUndos()
      clearExpiredFlashes()
    }, 1000)
    return () => clearInterval(interval)
  }, [clearExpiredUndos, clearExpiredFlashes])

  const loadFloorPlanData = async () => {
    setLoading(true)
    try {
      const [tablesRes, sectionsRes] = await Promise.all([
        fetch(`/api/tables?locationId=${locationId}&includeSeats=true&includeOrderItems=true`),
        fetch(`/api/sections?locationId=${locationId}`),
      ])

      if (tablesRes.ok) {
        const data = await tablesRes.json()
        setTables(data.tables || [])
      }
      if (sectionsRes.ok) {
        const data = await sectionsRes.json()
        setSections(data.sections || [])
      }
    } catch (error) {
      console.error('[FloorPlanHome] Load error:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCategories = async () => {
    try {
      const res = await fetch(`/api/menu/categories?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories || [])
      }
    } catch (error) {
      console.error('[FloorPlanHome] Categories load error:', error)
    }
  }

  // Show ALL tables including combined ones (magnetic connection model)
  // Tables with combinedWithId are connected TO another table
  const visibleTables = tables

  // Get primary tables that have other tables connected to them
  const primaryTables = tables.filter(
    t => t.combinedTableIds && t.combinedTableIds.length > 0
  )

  // Build connection lines between combined tables (smart positioning for any side)
  const connectionLines = primaryTables.flatMap(primary => {
    const connectedIds = primary.combinedTableIds || []
    const groupColor = getCombinedGroupColor(primary.id)

    return connectedIds.map(connectedId => {
      const connected = tables.find(t => t.id === connectedId)
      if (!connected) return null

      // Calculate the best connection points based on relative positions
      const primaryCenterX = primary.posX + primary.width / 2
      const primaryCenterY = primary.posY + primary.height / 2
      const connectedCenterX = connected.posX + connected.width / 2
      const connectedCenterY = connected.posY + connected.height / 2

      const dx = connectedCenterX - primaryCenterX
      const dy = connectedCenterY - primaryCenterY

      let x1: number, y1: number, x2: number, y2: number

      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal connection (left/right)
        if (dx > 0) {
          // Connected is to the RIGHT of primary
          x1 = primary.posX + primary.width
          y1 = primary.posY + primary.height / 2
          x2 = connected.posX
          y2 = connected.posY + connected.height / 2
        } else {
          // Connected is to the LEFT of primary
          x1 = primary.posX
          y1 = primary.posY + primary.height / 2
          x2 = connected.posX + connected.width
          y2 = connected.posY + connected.height / 2
        }
      } else {
        // Vertical connection (top/bottom)
        if (dy > 0) {
          // Connected is BELOW primary
          x1 = primary.posX + primary.width / 2
          y1 = primary.posY + primary.height
          x2 = connected.posX + connected.width / 2
          y2 = connected.posY
        } else {
          // Connected is ABOVE primary
          x1 = primary.posX + primary.width / 2
          y1 = primary.posY
          x2 = connected.posX + connected.width / 2
          y2 = connected.posY + connected.height
        }
      }

      return { id: `${primary.id}-${connectedId}`, x1, y1, x2, y2, color: groupColor }
    }).filter(Boolean)
  }) as { id: string; x1: number; y1: number; x2: number; y2: number; color: string }[]

  // For reset option, use primary tables
  const combinedTables = primaryTables

  // Build a map of table ID -> combined group color
  // Primary tables and their combined children share the same color
  const combinedGroupColors = new Map<string, string>()
  for (const primary of primaryTables) {
    const color = getCombinedGroupColor(primary.id)
    combinedGroupColors.set(primary.id, color)
    // Also set color for all children
    const childIds = primary.combinedTableIds || []
    for (const childId of childIds) {
      combinedGroupColors.set(childId, color)
    }
  }

  // Calculate ghost preview position during drag
  const ghostPreview = (() => {
    if (!draggedTableId || !dropTargetTableId || !lastDropPosition) return null

    const sourceTable = tables.find(t => t.id === draggedTableId)
    const targetTable = tables.find(t => t.id === dropTargetTableId)
    if (!sourceTable || !targetTable) return null

    const targetRect = {
      id: targetTable.id,
      posX: targetTable.posX,
      posY: targetTable.posY,
      width: targetTable.width,
      height: targetTable.height,
    }

    const sourceRect = {
      id: sourceTable.id,
      posX: sourceTable.posX,
      posY: sourceTable.posY,
      width: sourceTable.width,
      height: sourceTable.height,
    }

    const side = calculateAttachSide(lastDropPosition.x, lastDropPosition.y, targetRect)
    const position = calculateAttachPosition(sourceRect, targetRect, side)

    return {
      ...position,
      width: sourceTable.width,
      height: sourceTable.height,
      side,
    }
  })()

  // Get selected table for info panel
  const selectedTable = infoPanelTableId
    ? tables.find(t => t.id === infoPanelTableId) || null
    : null

  // Handle table tap
  const handleTableTap = useCallback((table: FloorPlanTable) => {
    // If a seat was selected, clear it when tapping elsewhere
    if (selectedSeat) {
      clearSelectedSeat()
    }
    openInfoPanel(table.id)
  }, [openInfoPanel, selectedSeat, clearSelectedSeat])

  // Handle seat tap for seat assignment
  const handleSeatTap = useCallback((tableId: string, seatNumber: number) => {
    // Toggle selection - if same seat, deselect; otherwise select new seat
    if (selectedSeat?.tableId === tableId && selectedSeat?.seatNumber === seatNumber) {
      clearSelectedSeat()
    } else {
      selectSeat(tableId, seatNumber)
    }
    console.log(`[FloorPlanHome] Seat ${seatNumber} tapped on table ${tableId}`)
  }, [selectedSeat, selectSeat, clearSelectedSeat])

  // Handle table combine with smart positioning
  const handleTableCombine = useCallback(async (
    sourceId: string,
    targetId: string,
    dropPosition?: { x: number; y: number }
  ) => {
    try {
      // Prepare table data for collision detection
      const allTablesData = tables.map(t => ({
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
          sourceTableId: sourceId,
          targetTableId: targetId,
          locationId,
          employeeId,
          dropX: dropPosition?.x,
          dropY: dropPosition?.y,
          allTables: allTablesData,
        }),
      })

      if (res.ok) {
        const result = await res.json()

        // Log the positioning result for debugging
        console.log('[FloorPlanHome] Combine result:', {
          attachSide: result.data?.attachSide,
          sourcePos: result.data?.sourceTable,
          shiftedTables: result.data?.shiftedTables,
        })

        addUndoAction({
          type: 'combine',
          sourceTableId: sourceId,
          targetTableId: targetId,
          timestamp: Date.now(),
        })
        loadFloorPlanData()
        return true
      }
      return false
    } catch (error) {
      console.error('[FloorPlanHome] Combine error:', error)
      return false
    }
  }, [locationId, employeeId, addUndoAction, tables])

  // Handle reset to default with flash feedback for skipped tables
  const handleResetToDefault = useCallback(async (tableIds: string[]) => {
    try {
      const res = await fetch('/api/tables/reset-to-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableIds,
          locationId,
          employeeId,
        }),
      })

      if (res.ok) {
        const result = await res.json()

        // Flash "OPEN ORDER" on skipped tables
        if (result.data?.skippedTableIds?.length > 0) {
          for (const tableId of result.data.skippedTableIds) {
            flashTableMessage(tableId, 'OPEN ORDER', 3000)
          }
          console.log(`[FloorPlanHome] Reset: ${result.data.resetCount} reset, ${result.data.skippedCount} skipped`)
        }

        loadFloorPlanData()
        closeInfoPanel()
        return true
      }
      return false
    } catch (error) {
      console.error('[FloorPlanHome] Reset error:', error)
      return false
    }
  }, [locationId, employeeId, closeInfoPanel, flashTableMessage])

  // Handle mark dirty/available
  const handleUpdateStatus = useCallback(async (tableId: string, status: string) => {
    try {
      await fetch(`/api/tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadFloorPlanData()
    } catch (error) {
      console.error('Failed to update status:', error)
    }
  }, [])

  // Handle undo
  const handleUndo = useCallback(async () => {
    const action = popUndoAction()
    if (!action) return

    if (action.type === 'combine') {
      await fetch(`/api/tables/${action.targetTableId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId,
          splitMode: 'even',
        }),
      })
      loadFloorPlanData()
    }
  }, [popUndoAction, locationId, employeeId])

  // Drag handlers
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggedTableId || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Store current position for drop calculation
    setLastDropPosition({ x, y })

    // Find table under pointer
    for (const table of visibleTables) {
      if (table.id === draggedTableId) continue

      if (
        x >= table.posX &&
        x <= table.posX + table.width &&
        y >= table.posY &&
        y <= table.posY + table.height
      ) {
        updateDragTarget(table.id, { x, y })
        return
      }
    }
    updateDragTarget(null)
  }, [draggedTableId, visibleTables, updateDragTarget])

  const handlePointerUp = useCallback(async () => {
    if (draggedTableId && dropTargetTableId) {
      // Pass the drop position for smart side calculation
      await handleTableCombine(draggedTableId, dropTargetTableId, lastDropPosition || undefined)
    }
    endDrag()
    setLastDropPosition(null)
  }, [draggedTableId, dropTargetTableId, handleTableCombine, endDrag, lastDropPosition])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeInfoPanel()
        selectTable(null)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeInfoPanel, selectTable, handleUndo])

  return (
    <div className="floor-plan-container floor-plan-home">
      {/* Header */}
      <header className="floor-plan-header">
        <div className="floor-plan-header-left">
          {onOpenAdminNav && isManager && (
            <button className="icon-btn" onClick={onOpenAdminNav} title="Admin Menu">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <span className="floor-plan-logo">GWI POS</span>
        </div>

        <div className="floor-plan-header-right">
          {/* Selected Seat Badge */}
          <AnimatePresence>
            {selectedSeat && (
              <motion.div
                className="selected-seat-badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  background: 'rgba(34, 197, 94, 0.2)',
                  border: '1px solid rgba(34, 197, 94, 0.4)',
                  borderRadius: '20px',
                  color: '#86efac',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" />
                </svg>
                Seat {selectedSeat.seatNumber}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    clearSelectedSeat()
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 0 0 4px',
                    display: 'flex',
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Server Badge */}
          <div className="floor-plan-user-badge">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>{employeeName}</span>
            {employeeRole && <span className="opacity-60 text-xs">({employeeRole})</span>}
          </div>

          {/* Show Seats Toggle */}
          <button
            className={`icon-btn ${showSeats ? 'active' : ''}`}
            onClick={toggleShowSeats}
            title={showSeats ? 'Hide Seats' : 'Show Seats'}
            style={showSeats ? { background: 'rgba(99, 102, 241, 0.2)', borderColor: 'rgba(99, 102, 241, 0.4)' } : undefined}
          >
            <svg width="18" height="18" fill="none" stroke={showSeats ? '#a5b4fc' : 'currentColor'} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" strokeWidth={2} />
              <circle cx="12" cy="4" r="2" strokeWidth={2} />
              <circle cx="12" cy="20" r="2" strokeWidth={2} />
              <circle cx="4" cy="12" r="2" strokeWidth={2} />
              <circle cx="20" cy="12" r="2" strokeWidth={2} />
            </svg>
          </button>

          {/* Reset to Default (if combined tables exist) */}
          {combinedTables.length > 0 && (
            <button
              className="reset-to-default-btn"
              onClick={() => handleResetToDefault(combinedTables.map(t => t.id))}
              title="Reset all combined tables to default positions"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset Layout
            </button>
          )}

          {/* Undo Button */}
          <AnimatePresence>
            {undoStack.length > 0 && (
              <motion.button
                className="icon-btn"
                onClick={handleUndo}
                title="Undo last combine"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                style={{ background: 'rgba(251, 191, 36, 0.15)', borderColor: 'rgba(251, 191, 36, 0.3)' }}
              >
                <svg width="18" height="18" fill="none" stroke="#fbbf24" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Settings */}
          {onOpenSettings && (
            <button className="icon-btn" onClick={onOpenSettings} title="Settings">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}

          {/* Logout */}
          <button className="icon-btn" onClick={onLogout} title="Logout">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* Categories Bar */}
      <CategoriesBar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onCategorySelect={(categoryId) => {
          // If onCategoryClick is provided, use it for tab workflow
          // (tap category first → start bar tab with that category selected)
          if (onCategoryClick && categoryId) {
            onCategoryClick(categoryId)
          } else {
            setSelectedCategoryId(categoryId)
          }
        }}
        onStartTabWorkflow={onStartNewTab}
      />

      {/* Floor Plan Canvas */}
      <div
        ref={containerRef}
        className="floor-plan-canvas"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={() => {
          selectTable(null)
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
          </div>
        ) : visibleTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="opacity-50 mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-lg font-medium">No tables configured</p>
            <p className="text-sm opacity-60 mt-1">Add tables in the admin settings</p>
          </div>
        ) : (
          <>
            {/* Connection Lines between combined tables */}
            {connectionLines.length > 0 && (
              <svg className="connection-lines-layer">
                <defs>
                  <filter id="connectionGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {connectionLines.map(line => (
                  <g key={line.id}>
                    {/* Glow effect - uses group color */}
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={`${line.color}66`}
                      strokeWidth="8"
                      strokeLinecap="round"
                      filter="url(#connectionGlow)"
                    />
                    {/* Main connection line - uses group color */}
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={line.color}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray="8 4"
                      className="connection-line-animated"
                    />
                  </g>
                ))}
              </svg>
            )}

            {/* Section Labels */}
            {sections.map(section => (
              <div
                key={section.id}
                className="section-label"
                style={{
                  left: section.posX + 10,
                  top: section.posY + 10,
                  color: section.color,
                }}
              >
                {section.name}
              </div>
            ))}

            {/* Tables */}
            <AnimatePresence>
              {visibleTables.map(table => {
                // Get flash message for this table
                const flash = flashingTables.get(table.id)
                const flashMessage = flash && flash.expiresAt > Date.now() ? flash.message : null

                return (
                  <TableNode
                    key={table.id}
                    table={table}
                    isSelected={selectedTableId === table.id}
                    isDragging={draggedTableId === table.id}
                    isDropTarget={dropTargetTableId === table.id}
                    combinedGroupColor={combinedGroupColors.get(table.id)}
                    showSeats={showSeats}
                    selectedSeat={selectedSeat}
                    flashMessage={flashMessage}
                    onTap={() => handleTableTap(table)}
                    onDragStart={() => startDrag(table.id)}
                    onDragEnd={endDrag}
                    onLongPress={() => {
                      // Long press could show split option for combined tables
                      if (table.combinedTableIds && table.combinedTableIds.length > 0) {
                        openInfoPanel(table.id)
                      }
                    }}
                    onSeatTap={(seatNumber) => handleSeatTap(table.id, seatNumber)}
                  />
                )
              })}
            </AnimatePresence>

            {/* Ghost preview showing where table will attach */}
            {ghostPreview && (
              <motion.div
                className="table-ghost-preview"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.6, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                style={{
                  position: 'absolute',
                  left: ghostPreview.posX,
                  top: ghostPreview.posY,
                  width: ghostPreview.width,
                  height: ghostPreview.height,
                  borderRadius: '12px',
                  border: '2px dashed #22c55e',
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  pointerEvents: 'none',
                  zIndex: 90,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#22c55e',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Attach {ghostPreview.side}
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>

      {/* Table Info Panel */}
      <TableInfoPanel
        table={selectedTable}
        isOpen={infoPanelTableId !== null}
        onClose={closeInfoPanel}
        onAddItems={() => {
          if (selectedTable) {
            onNavigateToOrders(selectedTable.id, selectedTable.currentOrder?.id)
          }
          closeInfoPanel()
        }}
        onViewCheck={() => {
          if (selectedTable?.currentOrder) {
            onNavigateToOrders(selectedTable.id, selectedTable.currentOrder.id)
          }
          closeInfoPanel()
        }}
        onMarkDirty={() => {
          if (selectedTable) {
            handleUpdateStatus(selectedTable.id, 'dirty')
          }
        }}
        onMarkAvailable={() => {
          if (selectedTable) {
            handleUpdateStatus(selectedTable.id, 'available')
          }
        }}
        onResetToDefault={
          selectedTable?.combinedTableIds && selectedTable.combinedTableIds.length > 0
            ? () => handleResetToDefault([selectedTable.id])
            : undefined
        }
      />
    </div>
  )
}

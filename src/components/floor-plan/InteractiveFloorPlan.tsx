'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useFloorPlanStore, FloorPlanTable, TableStatus } from './use-floor-plan'
import { TableShape } from './TableShape'
import { SectionBackground } from './SectionBackground'

interface InteractiveFloorPlanProps {
  locationId: string
  filterSectionId?: string | null
  filterStatus?: TableStatus | null
  onTableSelect?: (table: FloorPlanTable) => void
  onTableCombine?: (sourceTableId: string, targetTableId: string) => Promise<boolean>
  onTableSplit?: (tableId: string, splitMode: 'even' | 'by_seat') => Promise<boolean>
  readOnly?: boolean
}

export function InteractiveFloorPlan({
  locationId,
  filterSectionId,
  filterStatus,
  onTableSelect,
  onTableCombine,
  onTableSplit,
  readOnly = false,
}: InteractiveFloorPlanProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    tables,
    sections,
    viewportX,
    viewportY,
    zoom,
    selectedTableId,
    draggedTableId,
    dropTargetTableId,
    showCombineIndicator,
    combinePosition,
    undoStack,
    isLoading,
    error,
    setTables,
    setSections,
    setZoom,
    pan,
    zoomIn,
    zoomOut,
    resetView,
    selectTable,
    startDrag,
    updateDragTarget,
    endDrag,
    addUndoAction,
    popUndoAction,
    clearExpiredUndos,
    setLoading,
    setError,
  } = useFloorPlanStore()

  // Split modal state
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [splitTableId, setSplitTableId] = useState<string | null>(null)

  // Drag state for pointer tracking
  const isPanning = useRef(false)
  const lastPanPos = useRef({ x: 0, y: 0 })

  // Load data
  useEffect(() => {
    loadFloorPlanData()
  }, [locationId])

  // Clear expired undos periodically
  useEffect(() => {
    const interval = setInterval(clearExpiredUndos, 5000)
    return () => clearInterval(interval)
  }, [clearExpiredUndos])

  const loadFloorPlanData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [tablesRes, sectionsRes] = await Promise.all([
        fetch(`/api/tables?locationId=${locationId}&includeSeats=true`),
        fetch(`/api/sections?locationId=${locationId}`),
      ])

      if (!tablesRes.ok) throw new Error('Failed to fetch tables')
      if (!sectionsRes.ok) throw new Error('Failed to fetch sections')

      const tablesData = await tablesRes.json()
      const sectionsData = await sectionsRes.json()

      setTables(tablesData.tables || [])
      setSections(sectionsData.sections || [])
    } catch (err) {
      console.error('[FloorPlan] Load error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load floor plan')
    } finally {
      setLoading(false)
    }
  }

  // Filter tables
  const filteredTables = tables.filter(table => {
    // Hide tables that are combined into another (they're "absorbed")
    if (table.combinedWithId) return false
    if (filterSectionId && table.section?.id !== filterSectionId) return false
    if (filterStatus && table.status !== filterStatus) return false
    return true
  })

  // Get SVG point from screen coordinates
  const getSVGPoint = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const transformed = pt.matrixTransform(svg.getScreenCTM()?.inverse())
    return { x: transformed.x, y: transformed.y }
  }, [])

  // Find table at position
  const findTableAtPosition = useCallback((x: number, y: number): FloorPlanTable | null => {
    for (const table of filteredTables) {
      if (table.id === draggedTableId) continue // Skip dragged table

      const inBounds =
        x >= table.posX &&
        x <= table.posX + table.width &&
        y >= table.posY &&
        y <= table.posY + table.height

      if (inBounds) return table
    }
    return null
  }, [filteredTables, draggedTableId])

  // Handle pointer move for drag
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const svgPoint = getSVGPoint(e.clientX, e.clientY)

    // Handle panning
    if (isPanning.current) {
      const deltaX = e.clientX - lastPanPos.current.x
      const deltaY = e.clientY - lastPanPos.current.y
      pan(deltaX / zoom, deltaY / zoom)
      lastPanPos.current = { x: e.clientX, y: e.clientY }
      return
    }

    // Handle table drag
    if (draggedTableId && !readOnly) {
      const targetTable = findTableAtPosition(svgPoint.x, svgPoint.y)
      updateDragTarget(targetTable?.id || null, targetTable ? svgPoint : undefined)
    }
  }, [getSVGPoint, draggedTableId, readOnly, findTableAtPosition, updateDragTarget, pan, zoom])

  // Handle drag end / drop
  const handlePointerUp = useCallback(async () => {
    isPanning.current = false

    if (!draggedTableId || readOnly) {
      endDrag()
      return
    }

    // Check if dropped on another table
    if (dropTargetTableId && onTableCombine) {
      const success = await onTableCombine(draggedTableId, dropTargetTableId)
      if (success) {
        // Add to undo stack
        addUndoAction({
          type: 'combine',
          sourceTableId: draggedTableId,
          targetTableId: dropTargetTableId,
          timestamp: Date.now(),
        })
        // Refresh data
        loadFloorPlanData()
      }
    }

    endDrag()
  }, [draggedTableId, dropTargetTableId, readOnly, onTableCombine, addUndoAction, endDrag])

  // Handle background click for panning
  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    // Only pan on middle click or two-finger touch
    if (e.button === 1 || e.pointerType === 'touch') {
      isPanning.current = true
      lastPanPos.current = { x: e.clientX, y: e.clientY }
    } else {
      // Deselect on background click
      selectTable(null)
    }
  }, [selectTable])

  // Handle wheel for zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(zoom + delta)
  }, [zoom, setZoom])

  // Handle table selection
  const handleTableSelect = useCallback((table: FloorPlanTable) => {
    selectTable(table.id)
    onTableSelect?.(table)
  }, [selectTable, onTableSelect])

  // Handle long press for split
  const handleTableLongPress = useCallback((tableId: string) => {
    const table = tables.find(t => t.id === tableId)
    if (!table || !table.combinedTableIds || table.combinedTableIds.length === 0) {
      return // Can only split combined tables
    }
    setSplitTableId(tableId)
    setShowSplitModal(true)
  }, [tables])

  // Handle split action
  const handleSplit = useCallback(async (mode: 'even' | 'by_seat') => {
    if (!splitTableId || !onTableSplit) return

    const success = await onTableSplit(splitTableId, mode)
    if (success) {
      loadFloorPlanData()
    }

    setShowSplitModal(false)
    setSplitTableId(null)
  }, [splitTableId, onTableSplit])

  // Handle undo
  const handleUndo = useCallback(async () => {
    const action = popUndoAction()
    if (!action) return

    // For combine undo, we need to split
    if (action.type === 'combine' && onTableSplit) {
      await onTableSplit(action.targetTableId, 'even')
      loadFloorPlanData()
    }
  }, [popUndoAction, onTableSplit])

  // Calculate viewBox
  const viewBox = `${-viewportX} ${-viewportY} ${(containerRef.current?.clientWidth || 800) / zoom} ${(containerRef.current?.clientHeight || 600) / zoom}`

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg">
        <div className="text-gray-500">Loading floor plan...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg">
        <div className="text-red-500">{error}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-100 rounded-lg overflow-hidden">
      {/* Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        {/* Zoom controls */}
        <div className="bg-white rounded-lg shadow-lg flex flex-col">
          <button
            onClick={zoomIn}
            className="p-2 hover:bg-gray-100 rounded-t-lg border-b"
            title="Zoom in"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12M6 12h12" />
            </svg>
          </button>
          <button
            onClick={zoomOut}
            className="p-2 hover:bg-gray-100 rounded-b-lg"
            title="Zoom out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
            </svg>
          </button>
        </div>

        {/* Reset view */}
        <button
          onClick={resetView}
          className="p-2 bg-white rounded-lg shadow-lg hover:bg-gray-100"
          title="Reset view"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
          </svg>
        </button>

        {/* Undo button (only show if undos available) */}
        {undoStack.length > 0 && (
          <button
            onClick={handleUndo}
            className="p-2 bg-yellow-100 text-yellow-700 rounded-lg shadow-lg hover:bg-yellow-200 animate-pulse"
            title="Undo last combine"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
        )}
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 z-10 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full text-sm text-gray-600 shadow">
        {Math.round(zoom * 100)}%
      </div>

      {/* Combine indicator tooltip */}
      {showCombineIndicator && combinePosition && (
        <div
          className="absolute z-20 px-3 py-2 bg-green-500 text-white rounded-lg shadow-lg text-sm font-medium pointer-events-none animate-bounce"
          style={{
            left: combinePosition.x * zoom + viewportX,
            top: combinePosition.y * zoom + viewportY - 40,
            transform: 'translateX(-50%)',
          }}
        >
          Drop to combine tables
        </div>
      )}

      {/* Main SVG */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        viewBox={viewBox}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerDown={handleBackgroundPointerDown}
        onWheel={handleWheel}
        style={{ touchAction: 'none' }}
      >
        {/* Grid pattern */}
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#grid)" />

        {/* Render sections first (background) */}
        {sections.map(section => (
          <SectionBackground key={section.id} section={section} />
        ))}

        {/* Render tables */}
        {filteredTables.map(table => (
          <TableShape
            key={table.id}
            table={table}
            isSelected={selectedTableId === table.id}
            isDragging={draggedTableId === table.id}
            isDropTarget={dropTargetTableId === table.id}
            isCombined={Boolean(table.combinedTableIds && table.combinedTableIds.length > 0)}
            onSelect={() => handleTableSelect(table)}
            onDragStart={() => !readOnly && startDrag(table.id)}
            onDragEnd={endDrag}
            onLongPress={() => handleTableLongPress(table.id)}
          />
        ))}
      </svg>

      {/* Split Modal */}
      {showSplitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">Split Combined Tables</h3>
            <p className="text-sm text-gray-600 mb-4">
              How would you like to split the items?
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleSplit('even')}
                className="w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-left"
              >
                <div className="font-medium text-blue-800">Split Evenly</div>
                <div className="text-sm text-blue-600">Items distributed randomly between tables</div>
              </button>

              <button
                onClick={() => handleSplit('by_seat')}
                className="w-full px-4 py-3 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-left"
              >
                <div className="font-medium text-purple-800">Split by Seat</div>
                <div className="text-sm text-purple-600">Items follow their original seat assignment</div>
              </button>
            </div>

            <button
              onClick={() => {
                setShowSplitModal(false)
                setSplitTableId(null)
              }}
              className="w-full mt-4 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

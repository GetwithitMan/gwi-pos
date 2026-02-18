'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useFloorPlanStore, FloorPlanTable, TableStatus } from './use-floor-plan'
import { TableShape } from './TableShape'
import { SectionBackground } from './SectionBackground'

interface InteractiveFloorPlanProps {
  locationId: string
  filterSectionId?: string | null
  filterStatus?: TableStatus | null
  onTableSelect?: (table: FloorPlanTable) => void
  readOnly?: boolean
}

export function InteractiveFloorPlan({
  locationId,
  filterSectionId,
  filterStatus,
  onTableSelect,
  readOnly = false,
}: InteractiveFloorPlanProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const tables = useFloorPlanStore(s => s.tables)
  const sections = useFloorPlanStore(s => s.sections)
  const viewportX = useFloorPlanStore(s => s.viewportX)
  const viewportY = useFloorPlanStore(s => s.viewportY)
  const zoom = useFloorPlanStore(s => s.zoom)
  const selectedTableId = useFloorPlanStore(s => s.selectedTableId)
  const isLoading = useFloorPlanStore(s => s.isLoading)
  const error = useFloorPlanStore(s => s.error)
  const setTables = useFloorPlanStore(s => s.setTables)
  const setSections = useFloorPlanStore(s => s.setSections)
  const setZoom = useFloorPlanStore(s => s.setZoom)
  const pan = useFloorPlanStore(s => s.pan)
  const zoomIn = useFloorPlanStore(s => s.zoomIn)
  const zoomOut = useFloorPlanStore(s => s.zoomOut)
  const resetView = useFloorPlanStore(s => s.resetView)
  const selectTable = useFloorPlanStore(s => s.selectTable)
  const setLoading = useFloorPlanStore(s => s.setLoading)
  const setError = useFloorPlanStore(s => s.setError)

  // Drag state for pointer tracking
  const isPanning = useRef(false)
  const lastPanPos = useRef({ x: 0, y: 0 })

  // Load data
  useEffect(() => {
    loadFloorPlanData()
  }, [locationId])

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

      const tablesRaw = await tablesRes.json()
      const tablesData = tablesRaw.data ?? tablesRaw
      const sectionsRaw = await sectionsRes.json()
      const sectionsData = sectionsRaw.data ?? sectionsRaw

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
    if (filterSectionId && table.section?.id !== filterSectionId) return false
    if (filterStatus && table.status !== filterStatus) return false
    return true
  })

  // Handle pointer move for panning
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isPanning.current) {
      const deltaX = e.clientX - lastPanPos.current.x
      const deltaY = e.clientY - lastPanPos.current.y
      pan(deltaX / zoom, deltaY / zoom)
      lastPanPos.current = { x: e.clientX, y: e.clientY }
    }
  }, [pan, zoom])

  // Handle pointer up
  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

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

      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 z-10 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full text-sm text-gray-600 shadow">
        {Math.round(zoom * 100)}%
      </div>

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
            onSelect={() => handleTableSelect(table)}
          />
        ))}
      </svg>

    </div>
  )
}

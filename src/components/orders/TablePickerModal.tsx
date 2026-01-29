'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface Table {
  id: string
  name: string
  capacity: number
  posX: number
  posY: number
  width: number
  height: number
  shape: 'rectangle' | 'circle' | 'square'
  status: 'available' | 'occupied' | 'reserved' | 'dirty'
  section?: {
    id: string
    name: string
    color: string
  } | null
  currentOrder?: {
    id: string
    orderNumber: string
    guestCount: number
    total: number
    openedAt: string
    server: string
  } | null
}

interface Section {
  id: string
  name: string
  color: string
}

interface TablePickerModalProps {
  locationId: string
  onSelect: (tableId: string, tableName: string, guestCount: number) => void
  onCancel: () => void
}

const STATUS_COLORS = {
  available: { bg: 'bg-green-100', border: 'border-green-500', text: 'text-green-800' },
  occupied: { bg: 'bg-blue-100', border: 'border-blue-500', text: 'text-blue-800' },
  reserved: { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-800' },
  dirty: { bg: 'bg-orange-100', border: 'border-orange-500', text: 'text-orange-800' },
}

export function TablePickerModal({ locationId, onSelect, onCancel }: TablePickerModalProps) {
  const [tables, setTables] = useState<Table[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [guestCount, setGuestCount] = useState(2)
  const [viewMode, setViewMode] = useState<'grid' | 'floor'>('grid')

  useEffect(() => {
    async function loadTables() {
      try {
        const response = await fetch(`/api/tables?locationId=${locationId}`)
        if (response.ok) {
          const data = await response.json()
          setTables(data.tables || [])

          // Extract unique sections
          const uniqueSections = new Map<string, Section>()
          data.tables?.forEach((table: Table) => {
            if (table.section) {
              uniqueSections.set(table.section.id, table.section)
            }
          })
          setSections(Array.from(uniqueSections.values()))
        }
      } catch (error) {
        console.error('Failed to load tables:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadTables()
  }, [locationId])

  const filteredTables = selectedSection
    ? tables.filter(t => t.section?.id === selectedSection)
    : tables

  const handleTableSelect = (table: Table) => {
    if (table.currentOrder || table.status === 'occupied') {
      return
    }
    onSelect(table.id, table.name, guestCount)
  }

  // Calculate floor plan bounds
  const getFloorPlanBounds = () => {
    if (tables.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    tables.forEach(t => {
      minX = Math.min(minX, t.posX)
      minY = Math.min(minY, t.posY)
      maxX = Math.max(maxX, t.posX + t.width)
      maxY = Math.max(maxY, t.posY + t.height)
    })

    // Add padding
    return {
      minX: Math.max(0, minX - 50),
      minY: Math.max(0, minY - 50),
      maxX: maxX + 50,
      maxY: maxY + 50,
    }
  }

  const bounds = getFloorPlanBounds()
  const floorWidth = bounds.maxX - bounds.minX
  const floorHeight = bounds.maxY - bounds.minY

  const renderGridView = () => {
    const availableTables = filteredTables.filter(t => !t.currentOrder && t.status !== 'occupied')
    const occupiedTables = filteredTables.filter(t => t.currentOrder || t.status === 'occupied')

    return (
      <div className="space-y-6">
        {/* Available Tables */}
        {availableTables.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Available ({availableTables.length})
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {availableTables.map(table => (
                <button
                  key={table.id}
                  onClick={() => handleTableSelect(table)}
                  className="aspect-square rounded-xl border-2 border-green-300 bg-green-50 hover:bg-green-100 hover:border-green-500 hover:scale-105 transition-all flex flex-col items-center justify-center gap-1 p-2"
                >
                  <span className="text-2xl font-bold text-green-700">{table.name}</span>
                  <span className="text-xs text-green-600">{table.capacity} seats</span>
                  {table.section && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full text-white mt-1"
                      style={{ backgroundColor: table.section.color }}
                    >
                      {table.section.name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Occupied Tables */}
        {occupiedTables.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              Occupied ({occupiedTables.length})
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {occupiedTables.map(table => (
                <div
                  key={table.id}
                  className="aspect-square rounded-xl border-2 border-blue-200 bg-blue-50 flex flex-col items-center justify-center gap-1 p-2 cursor-not-allowed opacity-70"
                >
                  <span className="text-2xl font-bold text-blue-400">{table.name}</span>
                  {table.currentOrder && (
                    <>
                      <span className="text-[10px] text-blue-500 font-medium">
                        #{table.currentOrder.orderNumber}
                      </span>
                      <span className="text-[10px] text-blue-600 font-medium">
                        {table.currentOrder.server}
                      </span>
                      <span className="text-[10px] text-blue-400">
                        {table.currentOrder.guestCount} guests
                      </span>
                      <span className="text-[10px] text-blue-500 font-medium">
                        {formatCurrency(table.currentOrder.total)}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderFloorPlanView = () => {
    // Scale factor to fit in container (max 700px wide)
    const containerWidth = 700
    const containerHeight = 500
    const scaleX = containerWidth / floorWidth
    const scaleY = containerHeight / floorHeight
    const scale = Math.min(scaleX, scaleY, 1) // Don't scale up, only down

    return (
      <div className="flex justify-center">
        <div
          className="relative bg-gray-100 rounded-lg border-2 border-gray-300"
          style={{
            width: floorWidth * scale,
            height: floorHeight * scale,
            minHeight: 400,
          }}
        >
          {/* Grid pattern background */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: 'linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)',
              backgroundSize: `${20 * scale}px ${20 * scale}px`,
            }}
          />

          {/* Tables */}
          {filteredTables.map(table => {
            const isAvailable = !table.currentOrder && table.status !== 'occupied'
            const colors = STATUS_COLORS[table.status] || STATUS_COLORS.available
            const x = (table.posX - bounds.minX) * scale
            const y = (table.posY - bounds.minY) * scale
            const w = table.width * scale
            const h = table.height * scale

            return (
              <button
                key={table.id}
                onClick={() => isAvailable && handleTableSelect(table)}
                disabled={!isAvailable}
                className={`absolute flex flex-col items-center justify-center border-2 transition-all ${
                  isAvailable
                    ? `${colors.bg} ${colors.border} ${colors.text} hover:scale-105 hover:shadow-lg cursor-pointer`
                    : 'bg-blue-100 border-blue-400 text-blue-700 cursor-not-allowed opacity-80'
                } ${table.shape === 'circle' ? 'rounded-full' : 'rounded-lg'}`}
                style={{
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  minWidth: 60,
                  minHeight: 60,
                }}
              >
                <span className="font-bold text-sm">{table.name}</span>
                {table.currentOrder ? (
                  <>
                    <span className="text-[9px] font-medium">{table.currentOrder.server}</span>
                    <span className="text-[9px]">
                      {formatCurrency(table.currentOrder.total)}
                    </span>
                  </>
                ) : (
                  <span className="text-[10px]">{table.capacity} seats</span>
                )}
              </button>
            )
          })}

          {/* Legend */}
          <div className="absolute bottom-2 left-2 bg-white/90 rounded-lg p-2 flex gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-green-500"></span>
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-blue-500"></span>
              <span>Occupied</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-yellow-500"></span>
              <span>Reserved</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Select Table</h2>
            <p className="text-sm text-gray-500">Choose a table for the new order</p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls Bar */}
        <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-4">
          {/* Guest Count */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Guests:</span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                disabled={guestCount <= 1}
                className="w-8 h-8 p-0"
              >
                -
              </Button>
              <span className="w-8 text-center font-bold text-lg">{guestCount}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGuestCount(guestCount + 1)}
                className="w-8 h-8 p-0"
              >
                +
              </Button>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-gray-200 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'grid' ? 'bg-white shadow' : 'hover:bg-gray-300'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('floor')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'floor' ? 'bg-white shadow' : 'hover:bg-gray-300'
              }`}
            >
              Floor Plan
            </button>
          </div>

          {/* Section Filter */}
          {sections.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant={selectedSection === null ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setSelectedSection(null)}
              >
                All
              </Button>
              {sections.map(section => (
                <Button
                  key={section.id}
                  variant={selectedSection === section.id ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSection(section.id)}
                  style={{
                    backgroundColor: selectedSection === section.id ? section.color : undefined,
                    borderColor: section.color,
                    color: selectedSection === section.id ? 'white' : section.color,
                  }}
                >
                  {section.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Tables Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-center py-12 text-gray-500">Loading tables...</div>
          ) : tables.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <p className="text-gray-500 mb-2">No tables configured</p>
              <p className="text-sm text-gray-400">Add tables in the Tables admin section</p>
            </div>
          ) : viewMode === 'grid' ? (
            renderGridView()
          ) : (
            renderFloorPlanView()
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {filteredTables.filter(t => !t.currentOrder && t.status !== 'occupied').length} tables available
          </div>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  )
}

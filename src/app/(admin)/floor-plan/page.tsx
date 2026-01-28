'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { AdminNav } from '@/components/admin/AdminNav'

interface Seat {
  id: string
  tableId: string
  label: string
  seatNumber: number
  relativeX: number
  relativeY: number
  angle: number
  seatType: string
}

interface Table {
  id: string
  name: string
  capacity: number
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  shape: string
  sectionId?: string
  status: string
  isActive: boolean
  seats?: Seat[]
}

interface Section {
  id: string
  name: string
  color?: string
}

type EditMode = 'tables' | 'seats'

export default function FloorPlanPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const canvasRef = useRef<HTMLDivElement>(null)

  const [tables, setTables] = useState<Table[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [showAddModal, setShowAddModal] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>('tables')
  const [showSeats, setShowSeats] = useState(true)
  const [isGeneratingSeats, setIsGeneratingSeats] = useState(false)
  const [newTable, setNewTable] = useState({
    name: '',
    capacity: 4,
    shape: 'rectangle',
    width: 80,
    height: 80,
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/floor-plan')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  const loadData = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const [tablesRes, sectionsRes] = await Promise.all([
        fetch(`/api/tables?locationId=${employee.location.id}`),
        fetch(`/api/sections?locationId=${employee.location.id}`),
      ])

      if (tablesRes.ok) {
        const data = await tablesRes.json()
        const tablesWithSeats = await Promise.all(
          (data.tables || []).map(async (table: Table) => {
            // Fetch seats for each table
            const seatsRes = await fetch(`/api/tables/${table.id}/seats`)
            if (seatsRes.ok) {
              const seatsData = await seatsRes.json()
              return { ...table, seats: seatsData.seats || [] }
            }
            return { ...table, seats: [] }
          })
        )
        setTables(tablesWithSeats)
      }
      if (sectionsRes.ok) {
        const data = await sectionsRes.json()
        setSections(data.sections || [])
      }
    } catch (error) {
      console.error('Failed to load floor plan:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleTableMouseDown = useCallback((e: React.MouseEvent, table: Table) => {
    if (editMode !== 'tables') return
    e.preventDefault()
    e.stopPropagation()
    setSelectedTable(table)
    setSelectedSeat(null)
    setIsDragging(true)
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }, [editMode])

  const handleSeatMouseDown = useCallback((e: React.MouseEvent, seat: Seat, table: Table) => {
    if (editMode !== 'seats') return
    e.preventDefault()
    e.stopPropagation()
    setSelectedSeat(seat)
    setSelectedTable(table)
    setIsDragging(true)
    // For seats, we track relative to the table center
    const canvasRect = canvasRef.current?.getBoundingClientRect()
    if (!canvasRect) return

    const tableCenterX = table.posX + table.width / 2
    const tableCenterY = table.posY + table.height / 2
    const seatAbsoluteX = tableCenterX + seat.relativeX
    const seatAbsoluteY = tableCenterY + seat.relativeY

    setDragOffset({
      x: e.clientX - canvasRect.left - seatAbsoluteX,
      y: e.clientY - canvasRect.top - seatAbsoluteY,
    })
  }, [editMode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !canvasRef.current) return

    const canvasRect = canvasRef.current.getBoundingClientRect()

    if (editMode === 'tables' && selectedTable) {
      const newX = Math.max(0, Math.min(e.clientX - canvasRect.left - dragOffset.x, canvasRect.width - selectedTable.width))
      const newY = Math.max(0, Math.min(e.clientY - canvasRect.top - dragOffset.y, canvasRect.height - selectedTable.height))

      setTables(prev => prev.map(t =>
        t.id === selectedTable.id ? { ...t, posX: Math.round(newX), posY: Math.round(newY) } : t
      ))
      setSelectedTable(prev => prev ? { ...prev, posX: Math.round(newX), posY: Math.round(newY) } : null)
    } else if (editMode === 'seats' && selectedSeat && selectedTable) {
      // Calculate new relative position from table center
      const tableCenterX = selectedTable.posX + selectedTable.width / 2
      const tableCenterY = selectedTable.posY + selectedTable.height / 2
      const mouseX = e.clientX - canvasRect.left - dragOffset.x
      const mouseY = e.clientY - canvasRect.top - dragOffset.y
      const newRelativeX = Math.round(mouseX - tableCenterX)
      const newRelativeY = Math.round(mouseY - tableCenterY)

      setTables(prev => prev.map(t =>
        t.id === selectedTable.id
          ? {
              ...t,
              seats: t.seats?.map(s =>
                s.id === selectedSeat.id
                  ? { ...s, relativeX: newRelativeX, relativeY: newRelativeY }
                  : s
              ),
            }
          : t
      ))
      setSelectedSeat(prev => prev ? { ...prev, relativeX: newRelativeX, relativeY: newRelativeY } : null)
    }
  }, [isDragging, selectedTable, selectedSeat, dragOffset, editMode])

  const handleMouseUp = useCallback(async () => {
    if (!isDragging) return

    if (editMode === 'tables' && selectedTable) {
      // Save table position to database
      try {
        await fetch(`/api/tables/${selectedTable.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            posX: selectedTable.posX,
            posY: selectedTable.posY,
          }),
        })
      } catch (error) {
        console.error('Failed to save position:', error)
      }
    } else if (editMode === 'seats' && selectedSeat && selectedTable) {
      // Save seat position to database
      try {
        await fetch(`/api/tables/${selectedTable.id}/seats/${selectedSeat.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            relativeX: selectedSeat.relativeX,
            relativeY: selectedSeat.relativeY,
          }),
        })
      } catch (error) {
        console.error('Failed to save seat position:', error)
      }
    }
    setIsDragging(false)
  }, [isDragging, editMode, selectedTable, selectedSeat])

  const handleAddTable = async () => {
    if (!employee?.location?.id || !newTable.name) return

    try {
      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          name: newTable.name,
          capacity: newTable.capacity,
          shape: newTable.shape,
          width: newTable.width,
          height: newTable.height,
          posX: 50,
          posY: 50,
        }),
      })

      if (res.ok) {
        setShowAddModal(false)
        setNewTable({ name: '', capacity: 4, shape: 'rectangle', width: 80, height: 80 })
        loadData()
      }
    } catch (error) {
      console.error('Failed to add table:', error)
    }
  }

  const handleUpdateTable = async (updates: Partial<Table>) => {
    if (!selectedTable) return

    try {
      const res = await fetch(`/api/tables/${selectedTable.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (res.ok) {
        setTables(prev => prev.map(t =>
          t.id === selectedTable.id ? { ...t, ...updates } : t
        ))
        setSelectedTable(prev => prev ? { ...prev, ...updates } : null)
      }
    } catch (error) {
      console.error('Failed to update table:', error)
    }
  }

  const handleUpdateSeat = async (updates: Partial<Seat>) => {
    if (!selectedSeat || !selectedTable) return

    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/seats/${selectedSeat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (res.ok) {
        setTables(prev => prev.map(t =>
          t.id === selectedTable.id
            ? {
                ...t,
                seats: t.seats?.map(s =>
                  s.id === selectedSeat.id ? { ...s, ...updates } : s
                ),
              }
            : t
        ))
        setSelectedSeat(prev => prev ? { ...prev, ...updates } : null)
      }
    } catch (error) {
      console.error('Failed to update seat:', error)
    }
  }

  const handleDeleteTable = async () => {
    if (!selectedTable) return

    if (!confirm(`Delete ${selectedTable.name}?`)) return

    try {
      const res = await fetch(`/api/tables/${selectedTable.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setTables(prev => prev.filter(t => t.id !== selectedTable.id))
        setSelectedTable(null)
        setSelectedSeat(null)
      }
    } catch (error) {
      console.error('Failed to delete table:', error)
    }
  }

  const handleDeleteSeat = async () => {
    if (!selectedSeat || !selectedTable) return

    if (!confirm(`Delete seat ${selectedSeat.label}?`)) return

    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/seats/${selectedSeat.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setTables(prev => prev.map(t =>
          t.id === selectedTable.id
            ? { ...t, seats: t.seats?.filter(s => s.id !== selectedSeat.id) }
            : t
        ))
        setSelectedSeat(null)
      }
    } catch (error) {
      console.error('Failed to delete seat:', error)
    }
  }

  const handleGenerateSeats = async (arrangement: 'around' | 'row' | 'booth' = 'around') => {
    if (!selectedTable) return

    setIsGeneratingSeats(true)
    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/seats/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrangement,
          count: selectedTable.capacity,
          labelPattern: 'numeric',
          replaceExisting: true,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setTables(prev => prev.map(t =>
          t.id === selectedTable.id ? { ...t, seats: data.seats } : t
        ))
        setSelectedTable(prev => prev ? { ...prev, seats: data.seats } : null)
      }
    } catch (error) {
      console.error('Failed to generate seats:', error)
    } finally {
      setIsGeneratingSeats(false)
    }
  }

  const getTableStyle = (table: Table) => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: table.posX,
      top: table.posY,
      width: table.width,
      height: table.height,
      transform: `rotate(${table.rotation}deg)`,
      cursor: editMode === 'tables' ? 'move' : 'default',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: 'bold',
      border: selectedTable?.id === table.id ? '3px solid #3b82f6' : '2px solid #374151',
      transition: isDragging ? 'none' : 'box-shadow 0.2s',
    }

    const statusColors: Record<string, string> = {
      available: '#22c55e',
      occupied: '#ef4444',
      reserved: '#f59e0b',
      dirty: '#6b7280',
      in_use: '#8b5cf6',
    }

    baseStyle.backgroundColor = statusColors[table.status] || '#e5e7eb'

    if (table.shape === 'circle') {
      baseStyle.borderRadius = '50%'
    } else if (table.shape === 'booth') {
      baseStyle.borderRadius = '8px 8px 0 0'
    } else {
      baseStyle.borderRadius = '8px'
    }

    return baseStyle
  }

  const getSeatStyle = (seat: Seat, table: Table): React.CSSProperties => {
    const tableCenterX = table.posX + table.width / 2
    const tableCenterY = table.posY + table.height / 2
    const seatSize = 24

    const seatTypeColors: Record<string, string> = {
      standard: '#4b5563',
      premium: '#7c3aed',
      accessible: '#2563eb',
      booth_end: '#059669',
    }

    return {
      position: 'absolute',
      left: tableCenterX + seat.relativeX - seatSize / 2,
      top: tableCenterY + seat.relativeY - seatSize / 2,
      width: seatSize,
      height: seatSize,
      borderRadius: '50%',
      backgroundColor: seatTypeColors[seat.seatType] || '#4b5563',
      border: selectedSeat?.id === seat.id ? '3px solid #3b82f6' : '2px solid #1f2937',
      cursor: editMode === 'seats' ? 'move' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '10px',
      fontWeight: 'bold',
      color: 'white',
      zIndex: 10,
      transition: isDragging && selectedSeat?.id === seat.id ? 'none' : 'box-shadow 0.2s',
      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      <AdminNav />

      <div className="lg:ml-64 p-6">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Floor Plan Editor</h1>
            <p className="text-gray-600">
              {editMode === 'tables'
                ? 'Drag tables to position them. Click to select and edit.'
                : 'Click a seat to select it. Drag to reposition.'}
            </p>
          </div>
          <div className="flex gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              <button
                onClick={() => { setEditMode('tables'); setSelectedSeat(null); }}
                className={`px-4 py-2 text-sm ${editMode === 'tables' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                Tables
              </button>
              <button
                onClick={() => { setEditMode('seats'); setSelectedTable(null); }}
                className={`px-4 py-2 text-sm ${editMode === 'seats' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              >
                Seats
              </button>
            </div>
            <label className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border text-sm">
              <input
                type="checkbox"
                checked={showSeats}
                onChange={(e) => setShowSeats(e.target.checked)}
              />
              Show Seats
            </label>
            <Button onClick={() => setShowAddModal(true)}>Add Table</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Canvas */}
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="p-4">
                <div
                  ref={canvasRef}
                  className="relative bg-gray-200 rounded-lg overflow-hidden"
                  style={{ height: '600px' }}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Grid lines */}
                  <div className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: 'linear-gradient(#999 1px, transparent 1px), linear-gradient(90deg, #999 1px, transparent 1px)',
                      backgroundSize: '20px 20px',
                    }}
                  />

                  {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-gray-500">Loading floor plan...</p>
                    </div>
                  ) : (
                    <>
                      {/* Render tables */}
                      {tables.map(table => (
                        <div
                          key={table.id}
                          style={getTableStyle(table)}
                          onMouseDown={(e) => handleTableMouseDown(e, table)}
                          onClick={() => {
                            if (editMode === 'tables') {
                              setSelectedTable(table)
                              setSelectedSeat(null)
                            }
                          }}
                        >
                          <div className="text-center text-white drop-shadow-lg">
                            <div>{table.name}</div>
                            <div className="text-xs opacity-75">{table.capacity}</div>
                          </div>
                        </div>
                      ))}

                      {/* Render seats */}
                      {showSeats && tables.map(table =>
                        table.seats?.map(seat => (
                          <div
                            key={seat.id}
                            style={getSeatStyle(seat, table)}
                            onMouseDown={(e) => handleSeatMouseDown(e, seat, table)}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedSeat(seat)
                              setSelectedTable(table)
                            }}
                            title={`Seat ${seat.label} - ${seat.seatType}`}
                          >
                            {seat.label}
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>

                {/* Legend */}
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500" />
                    <span>Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-500" />
                    <span>Occupied</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-yellow-500" />
                    <span>Reserved</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-purple-500" />
                    <span>In Use</span>
                  </div>
                  {showSeats && (
                    <>
                      <div className="border-l pl-4 ml-2 flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-gray-600" />
                        <span>Standard Seat</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-violet-600" />
                        <span>Premium</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-blue-600" />
                        <span>Accessible</span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Properties Panel */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {selectedSeat
                    ? `Seat ${selectedSeat.label}`
                    : selectedTable
                      ? selectedTable.name
                      : 'Properties'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedSeat && selectedTable ? (
                  // Seat Properties
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Label</label>
                      <input
                        type="text"
                        value={selectedSeat.label}
                        onChange={(e) => handleUpdateSeat({ label: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Seat Type</label>
                      <select
                        value={selectedSeat.seatType}
                        onChange={(e) => handleUpdateSeat({ seatType: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      >
                        <option value="standard">Standard</option>
                        <option value="premium">Premium</option>
                        <option value="accessible">Accessible</option>
                        <option value="booth_end">Booth End</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Offset X</label>
                        <input
                          type="number"
                          value={selectedSeat.relativeX}
                          onChange={(e) => handleUpdateSeat({ relativeX: parseInt(e.target.value) })}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Offset Y</label>
                        <input
                          type="number"
                          value={selectedSeat.relativeY}
                          onChange={(e) => handleUpdateSeat({ relativeY: parseInt(e.target.value) })}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                    </div>
                    <div className="pt-4 border-t">
                      <p className="text-sm text-gray-500 mb-2">
                        Table: {selectedTable.name}
                      </p>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleDeleteSeat}
                        className="w-full"
                      >
                        Delete Seat
                      </Button>
                    </div>
                  </div>
                ) : selectedTable ? (
                  // Table Properties
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Name</label>
                      <input
                        type="text"
                        value={selectedTable.name}
                        onChange={(e) => handleUpdateTable({ name: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Capacity</label>
                      <input
                        type="number"
                        value={selectedTable.capacity}
                        onChange={(e) => handleUpdateTable({ capacity: parseInt(e.target.value) })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Shape</label>
                      <select
                        value={selectedTable.shape}
                        onChange={(e) => handleUpdateTable({ shape: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      >
                        <option value="rectangle">Rectangle</option>
                        <option value="square">Square</option>
                        <option value="circle">Circle</option>
                        <option value="booth">Booth</option>
                        <option value="bar">Bar Seat</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Width</label>
                        <input
                          type="number"
                          value={selectedTable.width}
                          onChange={(e) => handleUpdateTable({ width: parseInt(e.target.value) })}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Height</label>
                        <input
                          type="number"
                          value={selectedTable.height}
                          onChange={(e) => handleUpdateTable({ height: parseInt(e.target.value) })}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Rotation</label>
                      <input
                        type="range"
                        min="0"
                        max="359"
                        value={selectedTable.rotation}
                        onChange={(e) => handleUpdateTable({ rotation: parseInt(e.target.value) })}
                        className="w-full"
                      />
                      <div className="text-center text-sm text-gray-500">{selectedTable.rotation}°</div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Section</label>
                      <select
                        value={selectedTable.sectionId || ''}
                        onChange={(e) => handleUpdateTable({ sectionId: e.target.value || undefined })}
                        className="w-full border rounded px-3 py-2"
                      >
                        <option value="">No Section</option>
                        {sections.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Seat Generation */}
                    <div className="pt-4 border-t">
                      <label className="block text-sm text-gray-600 mb-2">
                        Seats ({selectedTable.seats?.length || 0} / {selectedTable.capacity})
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerateSeats('around')}
                          disabled={isGeneratingSeats}
                          title="Arrange seats in a circle around the table"
                        >
                          Around
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerateSeats('row')}
                          disabled={isGeneratingSeats}
                          title="Arrange seats in a row (for bars)"
                        >
                          Row
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerateSeats('booth')}
                          disabled={isGeneratingSeats}
                          title="Arrange seats on 3 sides (booth style)"
                        >
                          Booth
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-generate seats based on capacity
                      </p>
                    </div>

                    <div className="pt-4 border-t">
                      <p className="text-sm text-gray-500 mb-2">
                        Position: ({selectedTable.posX}, {selectedTable.posY})
                      </p>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleDeleteTable}
                        className="w-full"
                      >
                        Delete Table
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">
                    Click on a table or seat to edit its properties
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Add Table Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Add Table</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Name</label>
                  <input
                    type="text"
                    value={newTable.name}
                    onChange={(e) => setNewTable({ ...newTable, name: e.target.value })}
                    placeholder="Table 1"
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Capacity (# of seats)</label>
                  <input
                    type="number"
                    value={newTable.capacity}
                    onChange={(e) => setNewTable({ ...newTable, capacity: parseInt(e.target.value) })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Shape</label>
                  <select
                    value={newTable.shape}
                    onChange={(e) => setNewTable({ ...newTable, shape: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="rectangle">Rectangle</option>
                    <option value="square">Square</option>
                    <option value="circle">Circle</option>
                    <option value="booth">Booth</option>
                    <option value="bar">Bar Seat</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => setShowAddModal(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleAddTable} className="flex-1">
                    Add Table
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

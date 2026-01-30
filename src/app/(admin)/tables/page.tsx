'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { InteractiveFloorPlan, FloorPlanTable, TableStatus } from '@/components/floor-plan'

interface Section {
  id: string
  name: string
  color: string
  tableCount: number
  assignedEmployees: { id: string; name: string }[]
}

interface TableData {
  id: string
  name: string
  capacity: number
  posX: number
  posY: number
  width: number
  height: number
  shape: 'rectangle' | 'circle' | 'square'
  status: 'available' | 'occupied' | 'reserved' | 'dirty'
  section: { id: string; name: string; color: string } | null
  currentOrder: {
    id: string
    orderNumber: number
    guestCount: number
    total: number
    openedAt: string
    server: string
  } | null
}

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 border-green-500 text-green-800',
  occupied: 'bg-blue-100 border-blue-500 text-blue-800',
  reserved: 'bg-yellow-100 border-yellow-500 text-yellow-800',
  dirty: 'bg-red-100 border-red-500 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  occupied: 'Occupied',
  reserved: 'Reserved',
  dirty: 'Dirty',
}

export default function TablesPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const [tables, setTables] = useState<TableData[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'floor'>('grid')
  const [filterSection, setFilterSection] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)

  // Modal states
  const [showTableModal, setShowTableModal] = useState(false)
  const [showSectionModal, setShowSectionModal] = useState(false)
  const [editingTable, setEditingTable] = useState<TableData | null>(null)
  const [editingSection, setEditingSection] = useState<Section | null>(null)

  // Form states
  const [tableName, setTableName] = useState('')
  const [tableCapacity, setTableCapacity] = useState(4)
  const [tableSection, setTableSection] = useState('')
  const [tableShape, setTableShape] = useState<'rectangle' | 'circle' | 'square'>('rectangle')
  const [sectionName, setSectionName] = useState('')
  const [sectionColor, setSectionColor] = useState('#3B82F6')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/tables')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadData()
    }
  }, [employee?.location?.id])

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
        setTables(data.tables || [])
      }
      if (sectionsRes.ok) {
        const data = await sectionsRes.json()
        setSections(data.sections || [])
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateTable = async () => {
    if (!tableName.trim() || !employee?.location?.id) return

    try {
      const response = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          name: tableName,
          capacity: tableCapacity,
          sectionId: tableSection || null,
          shape: tableShape,
        }),
      })

      if (response.ok) {
        setShowTableModal(false)
        resetTableForm()
        loadData()
      }
    } catch (error) {
      console.error('Failed to create table:', error)
    }
  }

  const handleUpdateTable = async () => {
    if (!editingTable || !tableName.trim()) return

    try {
      const response = await fetch(`/api/tables/${editingTable.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tableName,
          capacity: tableCapacity,
          sectionId: tableSection || null,
          shape: tableShape,
        }),
      })

      if (response.ok) {
        setShowTableModal(false)
        setEditingTable(null)
        resetTableForm()
        loadData()
      }
    } catch (error) {
      console.error('Failed to update table:', error)
    }
  }

  const handleDeleteTable = async (tableId: string) => {
    if (!confirm('Are you sure you want to delete this table?')) return

    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadData()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete table')
      }
    } catch (error) {
      console.error('Failed to delete table:', error)
    }
  }

  const handleUpdateStatus = async (tableId: string, status: string) => {
    try {
      await fetch(`/api/tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadData()
    } catch (error) {
      console.error('Failed to update status:', error)
    }
  }

  const handleCreateSection = async () => {
    if (!sectionName.trim() || !employee?.location?.id) return

    try {
      const response = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          name: sectionName,
          color: sectionColor,
        }),
      })

      if (response.ok) {
        setShowSectionModal(false)
        resetSectionForm()
        loadData()
      }
    } catch (error) {
      console.error('Failed to create section:', error)
    }
  }

  const resetTableForm = () => {
    setTableName('')
    setTableCapacity(4)
    setTableSection('')
    setTableShape('rectangle')
  }

  const resetSectionForm = () => {
    setSectionName('')
    setSectionColor('#3B82F6')
  }

  const openEditTable = (table: TableData) => {
    setEditingTable(table)
    setTableName(table.name)
    setTableCapacity(table.capacity)
    setTableSection(table.section?.id || '')
    setTableShape(table.shape)
    setShowTableModal(true)
  }

  // Floor Plan handlers
  const handleFloorPlanTableSelect = useCallback((table: FloorPlanTable) => {
    if (table.currentOrder) {
      router.push(`/orders?tableId=${table.id}`)
    } else {
      // Convert to TableData format for edit modal
      openEditTable({
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        shape: table.shape as 'rectangle' | 'circle' | 'square',
        status: table.status as 'available' | 'occupied' | 'reserved' | 'dirty',
        section: table.section,
        currentOrder: table.currentOrder,
      })
    }
  }, [router])

  const handleTableCombine = useCallback(async (sourceTableId: string, targetTableId: string): Promise<boolean> => {
    if (!employee?.location?.id) return false

    try {
      const response = await fetch('/api/tables/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTableId,
          targetTableId,
          locationId: employee.location.id,
          employeeId: employee.id,
        }),
      })

      if (response.ok) {
        loadData() // Refresh grid view data too
        return true
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to combine tables')
        return false
      }
    } catch (error) {
      console.error('Failed to combine tables:', error)
      return false
    }
  }, [employee])

  const handleTableSplit = useCallback(async (tableId: string, splitMode: 'even' | 'by_seat'): Promise<boolean> => {
    if (!employee?.location?.id) return false

    try {
      const response = await fetch(`/api/tables/${tableId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          employeeId: employee.id,
          splitMode,
        }),
      })

      if (response.ok) {
        loadData() // Refresh grid view data too
        return true
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to split tables')
        return false
      }
    } catch (error) {
      console.error('Failed to split tables:', error)
      return false
    }
  }, [employee])

  const filteredTables = tables.filter(table => {
    if (filterSection && table.section?.id !== filterSection) return false
    if (filterStatus && table.status !== filterStatus) return false
    return true
  })

  const getElapsedTime = (openedAt: string) => {
    const mins = Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    return `${hours}h ${mins % 60}m`
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/orders')}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold">Table Management</h1>
              <p className="text-sm text-gray-500">{employee?.location?.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  viewMode === 'grid' ? 'bg-white shadow' : 'hover:bg-gray-200'
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('floor')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  viewMode === 'floor' ? 'bg-white shadow' : 'hover:bg-gray-200'
                }`}
              >
                Floor Plan
              </button>
            </div>

            <Button
              onClick={() => setShowSectionModal(true)}
              variant="outline"
            >
              + Section
            </Button>
            <Button
              onClick={() => {
                setEditingTable(null)
                resetTableForm()
                setShowTableModal(true)
              }}
            >
              + Add Table
            </Button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">Filter:</span>

          {/* Section Filter */}
          <select
            value={filterSection || ''}
            onChange={(e) => setFilterSection(e.target.value || null)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All Sections</option>
            {sections.map(section => (
              <option key={section.id} value={section.id}>{section.name}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus || ''}
            onChange={(e) => setFilterStatus(e.target.value || null)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All Status</option>
            <option value="available">Available</option>
            <option value="occupied">Occupied</option>
            <option value="reserved">Reserved</option>
            <option value="dirty">Dirty</option>
          </select>

          {/* Stats */}
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-green-600">{tables.filter(t => t.status === 'available').length} Available</span>
            <span className="text-blue-600">{tables.filter(t => t.status === 'occupied').length} Occupied</span>
            <span className="text-yellow-600">{tables.filter(t => t.status === 'reserved').length} Reserved</span>
            <span className="text-red-600">{tables.filter(t => t.status === 'dirty').length} Dirty</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading tables...</div>
        ) : filteredTables.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No tables found</p>
            <Button onClick={() => setShowTableModal(true)}>Add Your First Table</Button>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredTables.map(table => (
              <Card
                key={table.id}
                className={`p-4 border-2 cursor-pointer transition-all hover:shadow-lg ${STATUS_COLORS[table.status]}`}
                onClick={() => {
                  if (table.currentOrder) {
                    router.push(`/orders?tableId=${table.id}`)
                  } else {
                    openEditTable(table)
                  }
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-lg">{table.name}</h3>
                    {table.section && (
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ backgroundColor: table.section.color + '30', color: table.section.color }}
                      >
                        {table.section.name}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium">{table.capacity} seats</span>
                </div>

                <div className="text-sm mb-2">
                  <span className="font-medium">{STATUS_LABELS[table.status]}</span>
                </div>

                {table.currentOrder ? (
                  <div className="text-xs space-y-1 border-t pt-2 mt-2">
                    <div className="flex justify-between">
                      <span>Order #{table.currentOrder.orderNumber}</span>
                      <span>{getElapsedTime(table.currentOrder.openedAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{table.currentOrder.guestCount} guests</span>
                      <span className="font-medium">{formatCurrency(table.currentOrder.total)}</span>
                    </div>
                    <div className="text-gray-600">{table.currentOrder.server}</div>
                  </div>
                ) : (
                  <div className="flex gap-1 mt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleUpdateStatus(table.id, table.status === 'dirty' ? 'available' : 'dirty')
                      }}
                      className="text-xs px-2 py-1 bg-white/50 rounded hover:bg-white/80"
                    >
                      {table.status === 'dirty' ? 'Mark Clean' : 'Mark Dirty'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteTable(table.id)
                      }}
                      className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          /* Floor Plan View */
          <div className="bg-white rounded-lg border min-h-[600px] relative">
            <InteractiveFloorPlan
              locationId={employee?.location?.id || ''}
              filterSectionId={filterSection}
              filterStatus={filterStatus as TableStatus | null}
              onTableSelect={handleFloorPlanTableSelect}
              onTableCombine={handleTableCombine}
              onTableSplit={handleTableSplit}
            />
          </div>
        )}
      </div>

      {/* Sections List */}
      {sections.length > 0 && (
        <div className="px-6 pb-6">
          <h2 className="text-lg font-bold mb-3">Sections</h2>
          <div className="flex gap-3 flex-wrap">
            {sections.map(section => (
              <div
                key={section.id}
                className="px-4 py-2 bg-white rounded-lg border flex items-center gap-3"
              >
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: section.color }}
                />
                <span className="font-medium">{section.name}</span>
                <span className="text-sm text-gray-500">{section.tableCount} tables</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table Modal */}
      {showTableModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingTable ? 'Edit Table' : 'Add Table'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Table Name</label>
                <input
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="e.g., Table 1, Bar 3, Patio A"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Capacity</label>
                <input
                  type="number"
                  value={tableCapacity}
                  onChange={(e) => setTableCapacity(parseInt(e.target.value) || 1)}
                  min={1}
                  max={20}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Section</label>
                <select
                  value={tableSection}
                  onChange={(e) => setTableSection(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">No Section</option>
                  {sections.map(section => (
                    <option key={section.id} value={section.id}>{section.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Shape</label>
                <div className="flex gap-2">
                  {(['rectangle', 'square', 'circle'] as const).map(shape => (
                    <button
                      key={shape}
                      onClick={() => setTableShape(shape)}
                      className={`px-4 py-2 border rounded-lg capitalize ${
                        tableShape === shape ? 'bg-blue-50 border-blue-500' : ''
                      }`}
                    >
                      {shape}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowTableModal(false)
                  setEditingTable(null)
                  resetTableForm()
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={editingTable ? handleUpdateTable : handleCreateTable}
                className="flex-1"
              >
                {editingTable ? 'Save Changes' : 'Add Table'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Section Modal */}
      {showSectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Section</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Section Name</label>
                <input
                  type="text"
                  value={sectionName}
                  onChange={(e) => setSectionName(e.target.value)}
                  placeholder="e.g., Main Floor, Patio, Bar"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Color</label>
                <div className="flex gap-2">
                  {['#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899'].map(color => (
                    <button
                      key={color}
                      onClick={() => setSectionColor(color)}
                      className={`w-8 h-8 rounded-full border-2 ${
                        sectionColor === color ? 'border-gray-800' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowSectionModal(false)
                  resetSectionForm()
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button onClick={handleCreateSection} className="flex-1">
                Add Section
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable } from './use-floor-plan'
import { toast } from '@/stores/toast-store'

interface Employee {
  id: string
  displayName: string | null
  firstName: string
  lastName: string
}

interface TableInfoPanelProps {
  table: FloorPlanTable | null
  isOpen: boolean
  onClose: () => void
  onAddItems: () => void
  onViewCheck: () => void
  onMarkDirty: () => void
  onMarkAvailable: () => void
  locationId?: string
  employeeId?: string
}

export function TableInfoPanel({
  table,
  isOpen,
  onClose,
  onAddItems,
  onViewCheck,
  onMarkDirty,
  onMarkAvailable,
  locationId,
  employeeId,
}: TableInfoPanelProps) {
  const [showTransfer, setShowTransfer] = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false)
  const [isTransferring, setIsTransferring] = useState(false)

  // Reset transfer view when panel closes or table changes
  useEffect(() => {
    if (!isOpen) {
      setShowTransfer(false)
      setSelectedEmployeeId(null)
    }
  }, [isOpen, table?.id])

  if (!table) return null

  const hasOrder = Boolean(table.currentOrder)

  const getStatusLabel = () => {
    switch (table.status) {
      case 'occupied':
        return 'Occupied'
      case 'dirty':
        return 'Needs Cleaning'
      case 'reserved':
        return 'Reserved'
      case 'in_use':
        return 'In Use'
      default:
        return 'Available'
    }
  }

  const getStatusColor = () => {
    switch (table.status) {
      case 'occupied':
        return 'text-indigo-400'
      case 'dirty':
        return 'text-amber-400'
      case 'reserved':
        return 'text-yellow-400'
      case 'in_use':
        return 'text-purple-400'
      default:
        return 'text-slate-400'
    }
  }

  const getEmployeeName = (emp: Employee) =>
    emp.displayName || `${emp.firstName} ${emp.lastName}`

  const handleStartTransfer = async () => {
    setShowTransfer(true)
    if (employees.length === 0 && locationId) {
      setIsLoadingEmployees(true)
      try {
        const response = await fetch(`/api/employees?locationId=${locationId}&active=true`)
        if (response.ok) {
          const data = await response.json()
          const list: Employee[] = (data.data || data || []).filter(
            (emp: Employee) => emp.id !== employeeId
          )
          setEmployees(list)
        }
      } catch {
        toast.error('Failed to load servers')
      } finally {
        setIsLoadingEmployees(false)
      }
    }
  }

  const handleTransferTable = async () => {
    if (!selectedEmployeeId || !table) return
    setIsTransferring(true)
    try {
      const response = await fetch(`/api/tables/${table.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmployeeId: selectedEmployeeId,
          fromEmployeeId: employeeId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to transfer table')
      }

      const data = await response.json()
      const empName = data.data?.toEmployee?.name || 'another server'
      toast.success(`${table.name} transferred to ${empName}`)
      setShowTransfer(false)
      setSelectedEmployeeId(null)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to transfer table')
    } finally {
      setIsTransferring(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="floor-plan-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="table-info-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            {/* Header */}
            <div className="table-info-panel-header">
              <div>
                <h2 className="table-info-panel-title">{table.name}</h2>
                <p className="table-info-panel-subtitle">
                  <span className={getStatusColor()}>{getStatusLabel()}</span>
                  {' · '}{table.capacity} seats
                </p>
              </div>
              <button className="table-info-panel-close" onClick={onClose}>
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="table-info-panel-content">
              {/* Transfer server selection (replaces main content when active) */}
              {showTransfer ? (
                <div className="table-info-panel-section">
                  <h3 className="table-info-panel-section-title">Transfer to Server</h3>
                  {isLoadingEmployees ? (
                    <p className="text-sm text-slate-500">Loading servers...</p>
                  ) : employees.length === 0 ? (
                    <p className="text-sm text-slate-500">No other active servers found.</p>
                  ) : (
                    <div className="space-y-2">
                      {employees.map((emp) => (
                        <button
                          key={emp.id}
                          onClick={() => setSelectedEmployeeId(emp.id)}
                          className={`w-full text-left px-4 py-3 rounded-lg transition-all flex items-center gap-3 ${
                            selectedEmployeeId === emp.id
                              ? 'bg-cyan-600/20 border-2 border-cyan-500/50 text-cyan-300'
                              : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                              selectedEmployeeId === emp.id
                                ? 'bg-cyan-600/30 text-cyan-300'
                                : 'bg-white/10 text-slate-400'
                            }`}
                          >
                            {getEmployeeName(emp).charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-sm">{getEmployeeName(emp)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Current Order Section */}
                  {hasOrder && table.currentOrder && (
                    <div className="table-info-panel-section">
                      <h3 className="table-info-panel-section-title">Current Order</h3>

                      <div className="flex items-center justify-between mb-4 text-sm">
                        <span className="text-slate-400">Order #{table.currentOrder.orderNumber}</span>
                        <span className="text-slate-400">{table.currentOrder.guestCount} guests</span>
                      </div>

                      {/* Order Items */}
                      {table.currentOrder.items && table.currentOrder.items.length > 0 ? (
                        <div className="space-y-1">
                          {table.currentOrder.items.map((item) => (
                            <div key={item.id} className="panel-order-item">
                              <div>
                                <div className="panel-order-item-name">{item.name}</div>
                                <div className="panel-order-item-qty">Qty: {item.quantity}</div>
                              </div>
                              <div className="panel-order-item-price">
                                ${(item.price * item.quantity).toFixed(2)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 italic">Order details loading...</p>
                      )}

                      {/* Total */}
                      <div className="panel-total">
                        <span className="panel-total-label">Total</span>
                        <span className="panel-total-amount">${table.currentOrder.total.toFixed(2)}</span>
                      </div>

                      {/* Server */}
                      {table.currentOrder.server && (
                        <div className="flex items-center gap-2 mt-4 text-sm text-slate-400">
                          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span>Server: {table.currentOrder.server}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section Info */}
                  {table.section && (
                    <div className="table-info-panel-section">
                      <h3 className="table-info-panel-section-title">Section</h3>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: table.section.color }}
                        />
                        <span className="text-sm text-slate-300">{table.section.name}</span>
                      </div>
                    </div>
                  )}

                  {/* Seats Info */}
                  {table.seats && table.seats.length > 0 && (
                    <div className="table-info-panel-section">
                      <h3 className="table-info-panel-section-title">Seats</h3>
                      <div className="flex flex-wrap gap-2">
                        {table.seats.map((seat) => (
                          <div
                            key={seat.id}
                            className="px-3 py-1.5 bg-white/5 rounded-lg text-sm text-slate-300"
                          >
                            Seat {seat.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="table-info-panel-actions">
              {showTransfer ? (
                <>
                  <button
                    className="panel-action-btn secondary"
                    onClick={() => { setShowTransfer(false); setSelectedEmployeeId(null) }}
                  >
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back
                  </button>
                  <button
                    className={`panel-action-btn ${selectedEmployeeId ? 'primary' : 'secondary'}`}
                    onClick={handleTransferTable}
                    disabled={!selectedEmployeeId || isTransferring}
                    style={{
                      opacity: !selectedEmployeeId || isTransferring ? 0.5 : 1,
                      cursor: !selectedEmployeeId || isTransferring ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {isTransferring ? 'Transferring...' : 'Confirm Transfer'}
                  </button>
                </>
              ) : (
                <>
                  {hasOrder ? (
                    <>
                      <button className="panel-action-btn primary" onClick={onAddItems}>
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Items
                      </button>
                      <button className="panel-action-btn secondary" onClick={onViewCheck}>
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        View Check
                      </button>
                      {locationId && employeeId && (
                        <button className="panel-action-btn secondary" onClick={handleStartTransfer}>
                          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Transfer Table
                        </button>
                      )}
                    </>
                  ) : (
                    <button className="panel-action-btn primary" onClick={onAddItems}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Start Order
                    </button>
                  )}

                  {table.status === 'dirty' ? (
                    <button className="panel-action-btn secondary" onClick={onMarkAvailable}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Mark Clean
                    </button>
                  ) : !hasOrder && table.status === 'available' ? (
                    <button className="panel-action-btn warning" onClick={onMarkDirty}>
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Mark Dirty
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable } from './use-floor-plan'

interface TableInfoPanelProps {
  table: FloorPlanTable | null
  isOpen: boolean
  onClose: () => void
  onAddItems: () => void
  onViewCheck: () => void
  onMarkDirty: () => void
  onMarkAvailable: () => void
  onResetToDefault?: () => void
}

export function TableInfoPanel({
  table,
  isOpen,
  onClose,
  onAddItems,
  onViewCheck,
  onMarkDirty,
  onMarkAvailable,
  onResetToDefault,
}: TableInfoPanelProps) {
  if (!table) return null

  const isCombined = Boolean(table.combinedTableIds && table.combinedTableIds.length > 0)
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
                  {isCombined && ' · Combined'}
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
            </div>

            {/* Actions */}
            <div className="table-info-panel-actions">
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

              {/* Reset to Default for combined tables */}
              {isCombined && onResetToDefault && (
                <button className="panel-action-btn secondary" onClick={onResetToDefault}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reset to Default
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

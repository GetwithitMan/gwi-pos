'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from '@/stores/toast-store'
import type { FloorPlanTable } from './use-floor-plan'

interface VirtualGroupManagerModalProps {
  isOpen: boolean
  onClose: () => void
  groupTables: FloorPlanTable[]
  primaryTableId: string
  virtualGroupId: string
  locationId: string
  employeeId: string
  onGroupUpdated: () => void // Callback to refresh floor plan data
}

interface TableOrderStatus {
  tableId: string
  hasUnpaidItems: boolean
  itemCount: number
}

export function VirtualGroupManagerModal({
  isOpen,
  onClose,
  groupTables,
  primaryTableId,
  virtualGroupId,
  locationId,
  employeeId,
  onGroupUpdated,
}: VirtualGroupManagerModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [removingTableId, setRemovingTableId] = useState<string | null>(null)
  const [orderStatuses, setOrderStatuses] = useState<Map<string, TableOrderStatus>>(new Map())
  const [loadingStatuses, setLoadingStatuses] = useState(true)

  // Fetch order status for each table
  useEffect(() => {
    if (!isOpen || groupTables.length === 0) return

    const fetchStatuses = async () => {
      setLoadingStatuses(true)
      const statuses = new Map<string, TableOrderStatus>()

      for (const table of groupTables) {
        // Check if table has an open order with items (items on open order = unpaid)
        const itemCount = table.currentOrder?.items?.length ?? 0
        const hasUnpaid = itemCount > 0

        statuses.set(table.id, {
          tableId: table.id,
          hasUnpaidItems: hasUnpaid,
          itemCount,
        })
      }

      setOrderStatuses(statuses)
      setLoadingStatuses(false)
    }

    fetchStatuses()
  }, [isOpen, groupTables])

  const handleRemoveTable = useCallback(async (tableId: string, tableName: string) => {
    const status = orderStatuses.get(tableId)
    if (status?.hasUnpaidItems) {
      toast.warning(`Cannot remove ${tableName} - has unpaid items`)
      return
    }

    setRemovingTableId(tableId)

    try {
      const response = await fetch(`/api/tables/virtual-combine/${virtualGroupId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId,
          locationId,
          employeeId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'table_has_open_order') {
          toast.warning(data.message || `Cannot remove ${tableName} with open order`)
        } else {
          toast.error(data.error || 'Failed to remove table')
        }
        return
      }

      toast.success(`${tableName} removed from group`)
      onGroupUpdated()

      // If group was dissolved, close the modal
      if (data.data?.dissolved) {
        onClose()
      }
    } catch (error) {
      console.error('Failed to remove table:', error)
      toast.error('Network error - please try again')
    } finally {
      setRemovingTableId(null)
    }
  }, [virtualGroupId, locationId, employeeId, orderStatuses, onGroupUpdated, onClose])

  const handleDissolveGroup = useCallback(async () => {
    // Check if any table has unpaid items
    const tablesWithUnpaid = groupTables.filter(table => {
      const status = orderStatuses.get(table.id)
      return status?.hasUnpaidItems
    })

    if (tablesWithUnpaid.length > 0) {
      toast.warning(
        `Cannot dissolve - ${tablesWithUnpaid.length} table(s) have unpaid items`
      )
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(`/api/tables/virtual-combine/${virtualGroupId}/dissolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId,
          splitOrder: true, // Split items back to their source tables
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'tables_have_open_orders') {
          toast.warning(data.message || 'Cannot dissolve - tables have unpaid items')
        } else {
          toast.error(data.error || 'Failed to dissolve group')
        }
        return
      }

      toast.success('Virtual group dissolved')
      onGroupUpdated()
      onClose()
    } catch (error) {
      console.error('Failed to dissolve group:', error)
      toast.error('Network error - please try again')
    } finally {
      setIsLoading(false)
    }
  }, [virtualGroupId, locationId, employeeId, groupTables, orderStatuses, onGroupUpdated, onClose])

  const primaryTable = groupTables.find(t => t.id === primaryTableId)
  const groupColor = primaryTable?.virtualGroupColor || '#6366f1'

  // Check if dissolve is allowed
  const canDissolve = !loadingStatuses && !Array.from(orderStatuses.values()).some(s => s.hasUnpaidItems)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-md"
          >
            <div className="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
              {/* Header */}
              <div
                className="px-6 py-4 border-b border-white/10"
                style={{ backgroundColor: `${groupColor}20` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: groupColor }}
                    />
                    <h2 className="text-lg font-semibold text-white">
                      Virtual Group
                    </h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                    disabled={isLoading || removingTableId !== null}
                  >
                    <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm text-white/60 mt-1">
                  {groupTables.length} tables linked together
                </p>
              </div>

              {/* Table List */}
              <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
                {loadingStatuses ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                ) : (
                  groupTables.map(table => {
                    const isPrimary = table.id === primaryTableId
                    const status = orderStatuses.get(table.id)
                    const canRemove = !status?.hasUnpaidItems && groupTables.length > 2
                    const isRemoving = removingTableId === table.id

                    return (
                      <div
                        key={table.id}
                        className={`
                          flex items-center justify-between p-3 rounded-xl
                          ${isPrimary ? 'bg-white/10 border border-white/20' : 'bg-white/5'}
                        `}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-semibold"
                            style={{
                              backgroundColor: isPrimary ? groupColor : `${groupColor}60`,
                            }}
                          >
                            {table.abbreviation || table.name.slice(0, 2)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium">{table.name}</span>
                              {isPrimary && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
                                  Primary
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-white/50">
                              <span className={`capitalize ${
                                table.status === 'available' ? 'text-emerald-400' :
                                table.status === 'occupied' ? 'text-amber-400' :
                                'text-white/50'
                              }`}>
                                {table.status}
                              </span>
                              {status?.itemCount ? (
                                <>
                                  <span>•</span>
                                  <span>{status.itemCount} item{status.itemCount !== 1 ? 's' : ''}</span>
                                  {status.hasUnpaidItems && (
                                    <span className="text-amber-400">(unpaid)</span>
                                  )}
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Remove Button */}
                        {groupTables.length > 2 && (
                          <button
                            onClick={() => handleRemoveTable(table.id, table.name)}
                            disabled={!canRemove || isRemoving || isLoading}
                            className={`
                              px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                              ${canRemove
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                : 'bg-white/5 text-white/30 cursor-not-allowed'
                              }
                            `}
                            title={!canRemove ? 'Cannot remove - has unpaid items' : 'Remove from group'}
                          >
                            {isRemoving ? (
                              <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                            ) : (
                              'Remove'
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {/* Actions */}
              <div className="px-4 py-4 border-t border-white/10 space-y-3">
                {/* Dissolve Group Button */}
                <button
                  onClick={handleDissolveGroup}
                  disabled={!canDissolve || isLoading}
                  className={`
                    w-full py-3 rounded-xl font-medium transition-all
                    ${canDissolve
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                      : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/10'
                    }
                  `}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                      <span>Dissolving...</span>
                    </div>
                  ) : (
                    'Dissolve Group'
                  )}
                </button>

                {!canDissolve && !loadingStatuses && (
                  <p className="text-xs text-amber-400/80 text-center">
                    Pay all items before dissolving the group
                  </p>
                )}

                {/* Close Button */}
                <button
                  onClick={onClose}
                  disabled={isLoading || removingTableId !== null}
                  className="w-full py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

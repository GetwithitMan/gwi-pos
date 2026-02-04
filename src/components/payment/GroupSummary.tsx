'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  XMarkIcon,
  CreditCardIcon,
  TableCellsIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { formatCurrency } from '@/lib/utils'

export interface GroupTableFinancials {
  tableId: string
  tableName: string
  tableAbbreviation?: string
  isPrimary: boolean
  itemCount: number
  subtotal: number
  tax: number
  total: number
  paid: number
  remaining: number
  items: {
    id: string
    name: string
    quantity: number
    price: number
    seatNumber?: number
  }[]
}

interface GroupSummaryProps {
  isOpen: boolean
  virtualGroupId: string
  groupColor: string
  financials: GroupTableFinancials[]
  onFinalizeAll: () => void
  onPaySingleTable: (tableId: string) => void
  onClose: () => void
  isProcessing?: boolean
}

/**
 * GroupSummary - Checkout view for virtual table groups
 *
 * Shows per-table breakdown of items and totals, allowing:
 * - View of what each table ordered (T-S notation preserved)
 * - Pay entire group at once
 * - Pay individual tables separately
 * - Auto-dissolves group when fully paid
 */
export function GroupSummary({
  isOpen,
  virtualGroupId,
  groupColor,
  financials,
  onFinalizeAll,
  onPaySingleTable,
  onClose,
  isProcessing = false,
}: GroupSummaryProps) {
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())

  // Calculate grand totals
  const grandTotal = useMemo(
    () => financials.reduce((sum, f) => sum + f.total, 0),
    [financials]
  )
  const grandPaid = useMemo(
    () => financials.reduce((sum, f) => sum + f.paid, 0),
    [financials]
  )
  const grandRemaining = useMemo(
    () => financials.reduce((sum, f) => sum + f.remaining, 0),
    [financials]
  )
  const totalItems = useMemo(
    () => financials.reduce((sum, f) => sum + f.itemCount, 0),
    [financials]
  )

  const isFullyPaid = grandRemaining <= 0
  const tableCount = financials.length
  const paidTables = financials.filter(f => f.remaining <= 0).length

  if (!isOpen) return null

  const toggleTableExpanded = (tableId: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev)
      if (next.has(tableId)) {
        next.delete(tableId)
      } else {
        next.add(tableId)
      }
      return next
    })
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-2xl mx-4 bg-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-full animate-pulse"
                style={{ backgroundColor: groupColor }}
              />
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-cyan-400" />
                  Group Checkout
                </h2>
                <p className="text-sm text-slate-400">
                  {tableCount} tables · {totalItems} items
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Table breakdown */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {financials.map((table) => {
              const isExpanded = expandedTables.has(table.tableId)
              const isPaid = table.remaining <= 0

              return (
                <motion.div
                  key={table.tableId}
                  layout
                  className={`rounded-xl border overflow-hidden transition-colors ${
                    isPaid
                      ? 'bg-green-900/20 border-green-700/50'
                      : 'bg-slate-800/50 border-slate-700/50'
                  }`}
                >
                  {/* Table header */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer"
                    onClick={() => toggleTableExpanded(table.tableId)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <TableCellsIcon className="w-5 h-5 text-slate-400" />
                        <span className="font-medium text-white">
                          {table.tableAbbreviation || table.tableName}
                        </span>
                        {table.isPrimary && (
                          <span className="px-1.5 py-0.5 text-xs font-medium bg-cyan-500/20 text-cyan-400 rounded">
                            Primary
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-slate-400">
                        {table.itemCount} item{table.itemCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      {isPaid ? (
                        <div className="flex items-center gap-2 text-green-400">
                          <CheckCircleIcon className="w-5 h-5" />
                          <span className="font-medium">Paid</span>
                        </div>
                      ) : (
                        <div className="text-right">
                          <div className="text-lg font-semibold text-white">
                            {formatCurrency(table.remaining)}
                          </div>
                          {table.paid > 0 && (
                            <div className="text-xs text-green-400">
                              {formatCurrency(table.paid)} paid
                            </div>
                          )}
                        </div>
                      )}
                      {isExpanded ? (
                        <ChevronUpIcon className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronDownIcon className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded items list */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 space-y-2">
                          {table.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between py-2 px-3 bg-slate-700/30 rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                {item.seatNumber && (
                                  <span className="text-xs text-slate-400 font-mono">
                                    S{item.seatNumber}
                                  </span>
                                )}
                                <span className="text-slate-200">
                                  {item.quantity > 1 && (
                                    <span className="text-slate-400 mr-1">
                                      {item.quantity}x
                                    </span>
                                  )}
                                  {item.name}
                                </span>
                              </div>
                              <span className="text-slate-300 font-medium">
                                {formatCurrency(item.price * item.quantity)}
                              </span>
                            </div>
                          ))}

                          {/* Table subtotals */}
                          <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                            <div className="flex justify-between text-sm text-slate-400">
                              <span>Subtotal</span>
                              <span>{formatCurrency(table.subtotal)}</span>
                            </div>
                            {table.tax > 0 && (
                              <div className="flex justify-between text-sm text-slate-400">
                                <span>Tax</span>
                                <span>{formatCurrency(table.tax)}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-medium text-white">
                              <span>Total</span>
                              <span>{formatCurrency(table.total)}</span>
                            </div>
                          </div>

                          {/* Pay single table button */}
                          {!isPaid && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onPaySingleTable(table.tableId)
                              }}
                              className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                            >
                              <CreditCardIcon className="w-4 h-4" />
                              Pay This Table Only
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>

          {/* Grand total footer */}
          <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/50">
            {/* Progress indicator */}
            {tableCount > 1 && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-slate-400 mb-1">
                  <span>Payment Progress</span>
                  <span>
                    {paidTables} of {tableCount} tables paid
                  </span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-green-500 transition-all duration-500"
                    style={{ width: `${(grandPaid / grandTotal) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Grand totals */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Grand Total</div>
                <div className="text-2xl font-bold text-white">
                  {formatCurrency(grandTotal)}
                </div>
                {grandPaid > 0 && !isFullyPaid && (
                  <div className="text-sm">
                    <span className="text-green-400">
                      {formatCurrency(grandPaid)} paid
                    </span>
                    <span className="text-slate-400"> · </span>
                    <span className="text-amber-400">
                      {formatCurrency(grandRemaining)} remaining
                    </span>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                {isFullyPaid ? (
                  <button
                    onClick={onClose}
                    className="flex items-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-400 transition-colors"
                  >
                    <CheckCircleIcon className="w-5 h-5" />
                    Done - Group Paid
                  </button>
                ) : (
                  <button
                    onClick={onFinalizeAll}
                    disabled={isProcessing}
                    className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
                      isProcessing
                        ? 'bg-slate-700 text-slate-400 cursor-wait'
                        : 'bg-cyan-500 text-white hover:bg-cyan-400 shadow-lg shadow-cyan-500/25'
                    }`}
                  >
                    <CreditCardIcon className="w-5 h-5" />
                    {isProcessing
                      ? 'Processing...'
                      : grandPaid > 0
                        ? `Pay Remaining ${formatCurrency(grandRemaining)}`
                        : 'Pay Entire Group'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

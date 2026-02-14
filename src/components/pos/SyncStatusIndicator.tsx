'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { offlineDb, PaymentIntent } from '@/lib/offline-db'
import { useEvents } from '@/lib/events/use-events'

interface SyncStatusIndicatorProps {
  terminalId?: string
  locationId?: string
  showPaymentAlerts?: boolean
}

export function SyncStatusIndicator({
  terminalId,
  locationId,
  showPaymentAlerts = true,
}: SyncStatusIndicatorProps) {
  const { isConnected, subscribe } = useEvents({ locationId })
  const [isOnline, setIsOnline] = useState(true)
  const [offlineQueueCount, setOfflineQueueCount] = useState(0)
  const [pendingPayments, setPendingPayments] = useState(0)
  const [failedPayments, setFailedPayments] = useState<PaymentIntent[]>([])
  const [showDetails, setShowDetails] = useState(false)

  // Update queue counts
  const updateCounts = useCallback(async () => {
    try {
      const orders = await offlineDb.pendingOrders
        .where('status')
        .anyOf(['pending', 'syncing', 'failed'])
        .count()

      const payments = await offlineDb.paymentIntents
        .where('status')
        .anyOf(['capture_pending', 'authorizing', 'token_received'])
        .count()

      const failed = await offlineDb.paymentIntents
        .where('status')
        .anyOf(['failed', 'declined'])
        .toArray()

      setOfflineQueueCount(orders)
      setPendingPayments(payments)
      setFailedPayments(failed)
    } catch {
      // IndexedDB not available (SSR)
    }
  }, [])

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine)
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)

      return () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
      }
    }
  }, [])

  // Socket-driven updates for sync/payment events
  useEffect(() => {
    if (!isConnected) return
    const unsubs = [
      subscribe('sync:completed', () => updateCounts()),
      subscribe('payment:processed', () => updateCounts()),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [isConnected, subscribe, updateCounts])

  // Initial load + 20s fallback polling when socket is disconnected
  useEffect(() => {
    updateCounts()
    if (isConnected) return
    const fallback = setInterval(updateCounts, 20000)
    return () => clearInterval(fallback)
  }, [updateCounts, isConnected])

  const totalPending = offlineQueueCount + pendingPayments
  const hasFailedPayments = failedPayments.length > 0
  const isCritical = hasFailedPayments || (totalPending > 10 && !isOnline)

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`flex items-center gap-3 px-3 py-1.5 rounded-full border transition-all ${
          isCritical
            ? 'bg-red-900/50 border-red-500/50'
            : isOnline
              ? 'bg-slate-900 border-slate-800'
              : 'bg-amber-900/30 border-amber-500/50'
        }`}
      >
        {/* 1. Network Status */}
        <div className="flex items-center gap-2 pr-2 border-r border-slate-700">
          <div
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-green-500' : 'bg-red-500 animate-pulse'
            }`}
          />
          <span className="text-[10px] font-black uppercase tracking-tighter text-slate-400">
            {isOnline ? 'Live' : 'Offline'}
          </span>
        </div>

        {/* 2. Queue Count */}
        <AnimatePresence>
          {totalPending > 0 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-2"
            >
              {isOnline ? (
                <CloudArrowUpIcon className="w-4 h-4 text-cyan-400 animate-bounce" />
              ) : (
                <CloudIcon className="w-4 h-4 text-amber-500" />
              )}
              <span className="text-xs font-bold text-white">
                {totalPending}{' '}
                <span className="text-[10px] text-slate-500 font-normal">
                  Pending Sync
                </span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 3. Payment Alert */}
        <AnimatePresence>
          {showPaymentAlerts && pendingPayments > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30"
            >
              <CreditCardIcon className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] font-bold text-amber-400">
                {pendingPayments} Payment{pendingPayments > 1 ? 's' : ''}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 4. Critical Error Alert */}
        {isCritical && (
          <div className="pl-2">
            <ExclamationCircleIcon className="w-4 h-4 text-red-500 animate-pulse" />
          </div>
        )}
      </button>

      {/* Expanded Details Panel */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-white">Sync Status</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-slate-400 hover:text-white"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Connection Status */}
              <StatusRow
                label="Connection"
                value={isOnline ? 'Online' : 'Offline'}
                valueColor={isOnline ? 'text-green-400' : 'text-red-400'}
                icon={
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isOnline ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                }
              />

              {/* Pending Orders */}
              <StatusRow
                label="Pending Orders"
                value={offlineQueueCount.toString()}
                valueColor={offlineQueueCount > 0 ? 'text-amber-400' : 'text-slate-400'}
              />

              {/* Pending Payments */}
              <StatusRow
                label="Pending Payments"
                value={pendingPayments.toString()}
                valueColor={pendingPayments > 0 ? 'text-amber-400' : 'text-slate-400'}
                highlight={pendingPayments > 0}
              />

              {/* Failed Payments Alert */}
              {hasFailedPayments && (
                <div className="rounded-lg bg-red-900/30 border border-red-500/30 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-bold text-red-400">
                      {failedPayments.length} Failed Payment{failedPayments.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {failedPayments.slice(0, 3).map((payment) => (
                      <div
                        key={payment.id}
                        className="text-xs text-red-300 flex justify-between"
                      >
                        <span>
                          ${payment.amount.toFixed(2)} - {payment.cardLast4 ? `****${payment.cardLast4}` : 'Card'}
                        </span>
                        <span className="text-red-400/70">
                          {payment.status === 'declined' ? 'Declined' : 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {failedPayments.length > 3 && (
                    <p className="text-xs text-red-400/70 mt-1">
                      +{failedPayments.length - 3} more...
                    </p>
                  )}
                </div>
              )}

              {/* Terminal Info */}
              {terminalId && (
                <div className="pt-2 border-t border-slate-800">
                  <p className="text-xs text-slate-500">
                    Terminal: <span className="text-slate-400">{terminalId}</span>
                  </p>
                </div>
              )}

              {/* Offline Mode Info */}
              {!isOnline && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-200">
                    <strong>Offline Mode Active</strong>
                    <br />
                    Orders and payments are being saved locally. They will sync
                    automatically when connection is restored.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Status Row Component
function StatusRow({
  label,
  value,
  valueColor = 'text-white',
  icon,
  highlight = false,
}: {
  label: string
  value: string
  valueColor?: string
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg p-3 ${
        highlight ? 'bg-amber-900/20' : 'bg-slate-800'
      }`}
    >
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`flex items-center gap-2 text-sm font-medium ${valueColor}`}>
        {icon}
        {value}
      </span>
    </div>
  )
}

// Inline SVG Icons (to avoid @heroicons dependency issues)
function CloudArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  )
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
      />
    </svg>
  )
}

function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  )
}

function ExclamationCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}

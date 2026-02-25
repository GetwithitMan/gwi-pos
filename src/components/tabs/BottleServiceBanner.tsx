'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSocket } from '@/hooks/useSocket'

interface BottleServiceStatus {
  depositAmount: number
  minimumSpend: number
  currentSpend: number
  spendProgress: number
  minimumMet: boolean
  remainingToMinimum: number
  totalAuthorized: number
  reAuthNeeded: boolean
  autoGratuityPercent: number
}

interface BottleServiceBannerProps {
  orderId: string
  tierName?: string
  tierColor?: string
  onReAuth?: () => void
  compact?: boolean
}

export default function BottleServiceBanner({
  orderId,
  tierName,
  tierColor = '#D4AF37',
  onReAuth,
  compact = false,
}: BottleServiceBannerProps) {
  const [status, setStatus] = useState<BottleServiceStatus | null>(null)
  const { socket, isConnected } = useSocket()

  const loadStatus = useCallback(() => {
    fetch(`/api/orders/${orderId}/bottle-service`)
      .then(res => res.json())
      .then(json => {
        if (json.data) setStatus(json.data)
      })
      .catch(() => {})
  }, [orderId])

  // Load on mount
  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Socket-driven refresh: order/tab/payment events affect bottle service spend
  useEffect(() => {
    if (!socket || !isConnected) return
    const refresh = () => loadStatus()
    socket.on('order:updated', refresh)
    socket.on('order:item-added', refresh)
    socket.on('tab:updated', refresh)
    socket.on('payment:processed', refresh)
    return () => {
      socket.off('order:updated', refresh)
      socket.off('order:item-added', refresh)
      socket.off('tab:updated', refresh)
      socket.off('payment:processed', refresh)
    }
  }, [socket, isConnected, loadStatus])

  // 20s fallback polling only when socket is disconnected
  useEffect(() => {
    if (isConnected) return

    const fallback = setInterval(loadStatus, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, loadStatus])

  // Instant refresh on tab visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadStatus()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [loadStatus])

  if (!status) return null

  // Compact banner for tab cards in the list
  if (compact) {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1 rounded-md text-xs font-bold"
        style={{
          background: `linear-gradient(90deg, ${tierColor}44, ${tierColor}22)`,
          color: tierColor,
        }}
      >
        <span>{tierName || 'Bottle Service'}</span>
        <span className="text-white/40">|</span>
        <span className={status.minimumMet ? 'text-emerald-400' : 'text-white/60'}>
          {status.spendProgress}%
        </span>
        {status.reAuthNeeded && (
          <>
            <span className="text-white/40">|</span>
            <span className="text-amber-400 animate-pulse">Re-auth needed</span>
          </>
        )}
      </div>
    )
  }

  // Full banner for tab detail view
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: `linear-gradient(135deg, ${tierColor}22, ${tierColor}0A)`,
        border: `1px solid ${tierColor}44`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded-full text-xs font-bold"
            style={{ backgroundColor: tierColor, color: '#000' }}
          >
            {tierName || 'Bottle Service'}
          </span>
          {status.autoGratuityPercent > 0 && (
            <span className="text-white/40 text-xs">
              {status.autoGratuityPercent}% auto-grat
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-white/50 text-xs">Authorized</div>
          <div className="text-white font-bold">${status.totalAuthorized.toLocaleString()}</div>
        </div>
      </div>

      {/* Spend Progress Bar */}
      <div>
        <div className="flex justify-between text-xs text-white/50 mb-1">
          <span>Spend: ${status.currentSpend.toFixed(2)}</span>
          <span>Min: ${status.minimumSpend.toLocaleString()}</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(status.spendProgress, 100)}%`,
              backgroundColor: status.minimumMet ? '#34D399' : tierColor,
            }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className={status.minimumMet ? 'text-emerald-400 font-bold' : 'text-white/40'}>
            {status.minimumMet ? 'Minimum met' : `$${status.remainingToMinimum.toFixed(2)} remaining`}
          </span>
          <span className="text-white/40">{status.spendProgress}%</span>
        </div>
      </div>

      {/* Re-auth Alert */}
      {status.reAuthNeeded && (
        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-amber-400 text-sm font-medium">
              Tab approaching deposit limit
            </span>
          </div>
          {onReAuth && (
            <button
              onClick={onReAuth}
              className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors"
            >
              Extend
            </button>
          )}
        </div>
      )}
    </div>
  )
}

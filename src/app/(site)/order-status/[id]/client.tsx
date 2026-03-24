'use client'

/**
 * Order Status Page — /order-status/[id]?token=...
 *
 * Public, token-gated. Shows order confirmation, progress tracker,
 * items, totals, and estimated ready time.
 *
 * Polling: 15s while tab visible, stops on terminal status or after 30 min.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { OrderStatusTracker } from '@/components/site/OrderStatusTracker'

interface OrderStatusData {
  orderId: string
  orderNumber: string
  status: string
  orderType: string
  createdAt: string
  estimatedReadyTime: string | null
  items: Array<{
    name: string
    quantity: number
    price: number
    modifiers: string[]
  }>
  subtotal: number
  taxTotal: number
  tipTotal: number
  total: number
  pickupAddress: string | null
  source: string
}

const TERMINAL_STATUSES = new Set(['completed', 'voided', 'canceled'])
const POLL_INTERVAL_MS = 15_000
const MAX_POLL_DURATION_MS = 30 * 60 * 1000 // 30 minutes

import { formatCurrency } from '@/lib/utils'

export function OrderStatusClient() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params?.id as string
  const token = searchParams?.get('token') ?? ''

  const [data, setData] = useState<OrderStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollStartRef = useRef<number>(Date.now())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!id || !token) return

    try {
      const res = await fetch(`/api/public/order-status/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`)

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Unable to load order status')
        setLoading(false)
        return
      }

      const json = await res.json()
      setData(json.data)
      setError(null)
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }, [id, token])

  // Initial fetch
  useEffect(() => {
    void fetchStatus()
    pollStartRef.current = Date.now()
  }, [fetchStatus])

  // Polling: 15s interval, visibility-aware, stops on terminal or timeout
  useEffect(() => {
    if (!data || TERMINAL_STATUSES.has(data.status)) return

    function startPolling() {
      if (pollRef.current) clearInterval(pollRef.current)

      pollRef.current = setInterval(() => {
        // Stop after 30 min
        if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
          if (pollRef.current) clearInterval(pollRef.current)
          return
        }
        void fetchStatus()
      }, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void fetchStatus() // Immediate refresh on tab focus
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [data, fetchStatus])

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--site-brand)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>Loading order status...</p>
        </div>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="rounded-xl p-6" style={{ backgroundColor: 'rgba(220, 38, 38, 0.06)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>
            <p className="text-sm" style={{ color: '#dc2626' }}>{error || 'Something went wrong.'}</p>
            <button
              onClick={() => { setLoading(true); void fetchStatus() }}
              className="mt-4 px-5 py-2 text-sm rounded-lg transition-colors font-medium"
              style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isComplete = data.status === 'completed'
  const isCanceled = data.status === 'voided' || data.status === 'canceled'

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* Confirmation Banner */}
      {!isCanceled && (
        <div
          className="rounded-xl p-6 text-center"
          style={{
            backgroundColor: isComplete
              ? 'rgb(240, 253, 244)' // green-50
              : 'rgb(239, 246, 255)', // blue-50
            borderColor: isComplete
              ? 'rgb(187, 247, 208)' // green-200
              : 'rgb(191, 219, 254)', // blue-200
            borderWidth: '1px',
            borderStyle: 'solid',
          }}
        >
          <div
            className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{
              backgroundColor: isComplete
                ? 'var(--site-success)'
                : 'var(--site-brand)',
            }}
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--site-text)' }}>
            {isComplete ? 'Your order is ready!' : 'Order Confirmed!'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
            Order #{data.orderNumber}
          </p>
        </div>
      )}

      {/* Status Tracker */}
      <OrderStatusTracker
        status={data.status}
        estimatedReadyTime={data.estimatedReadyTime}
      />

      {/* Order Summary */}
      <div className="rounded-xl border p-5" style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-surface)' }}>
        <h2 className="font-semibold mb-4" style={{ color: 'var(--site-text)' }}>Order Summary</h2>

        <div className="space-y-3">
          {data.items.map((item, i) => (
            <div key={i} className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--site-text)' }}>
                  {item.quantity > 1 && <span className="mr-1" style={{ color: 'var(--site-text-muted)' }}>{item.quantity}x</span>}
                  {item.name}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--site-text-muted)' }}>
                    {item.modifiers.join(', ')}
                  </p>
                )}
              </div>
              <span className="text-sm font-medium ml-3 whitespace-nowrap" style={{ color: 'var(--site-text)' }}>
                {formatCurrency(item.price * item.quantity)}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t mt-4 pt-4 space-y-2" style={{ borderColor: 'var(--site-border)' }}>
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--site-text-muted)' }}>Subtotal</span>
            <span style={{ color: 'var(--site-text)' }}>{formatCurrency(data.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--site-text-muted)' }}>Tax</span>
            <span style={{ color: 'var(--site-text)' }}>{formatCurrency(data.taxTotal)}</span>
          </div>
          {data.tipTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--site-text-muted)' }}>Tip</span>
              <span style={{ color: 'var(--site-text)' }}>{formatCurrency(data.tipTotal)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base pt-2 border-t" style={{ borderColor: 'var(--site-border)' }}>
            <span style={{ color: 'var(--site-text)' }}>Total</span>
            <span style={{ color: 'var(--site-text)' }}>{formatCurrency(data.total)}</span>
          </div>
        </div>
      </div>

      {/* Pickup Address */}
      {data.pickupAddress && data.orderType !== 'delivery' && (
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-surface)' }}>
          <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--site-text)' }}>Pickup Location</h3>
          <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>{data.pickupAddress}</p>
        </div>
      )}

      {/* Back to Menu */}
      <div className="text-center pt-2 pb-4">
        <a
          href="/menu"
          className="inline-block px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{
            backgroundColor: 'var(--site-brand)',
            color: 'var(--site-brand-text)',
          }}
        >
          Back to Menu
        </a>
      </div>
    </div>
  )
}

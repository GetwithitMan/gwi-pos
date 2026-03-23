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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

export default function OrderStatusPage() {
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
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--site-primary, #2563eb)', borderTopColor: 'transparent' }} />
          <p className="text-gray-500 text-sm">Loading order status...</p>
        </div>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <p className="text-red-700 text-sm">{error || 'Something went wrong.'}</p>
            <button
              onClick={() => { setLoading(true); void fetchStatus() }}
              className="mt-4 px-5 py-2 bg-red-100 hover:bg-red-200 text-red-800 text-sm rounded-lg transition-colors font-medium"
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
                ? 'rgb(34, 197, 94)' // green-500
                : 'var(--site-primary, #2563eb)',
            }}
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">
            {isComplete ? 'Your order is ready!' : 'Order Confirmed!'}
          </h1>
          <p className="text-gray-600 text-sm">
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
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Order Summary</h2>

        <div className="space-y-3">
          {data.items.map((item, i) => (
            <div key={i} className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm font-medium">
                  {item.quantity > 1 && <span className="text-gray-500 mr-1">{item.quantity}x</span>}
                  {item.name}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-gray-500 text-xs mt-0.5">
                    {item.modifiers.join(', ')}
                  </p>
                )}
              </div>
              <span className="text-gray-900 text-sm font-medium ml-3 whitespace-nowrap">
                {formatCurrency(item.price * item.quantity)}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-gray-100 mt-4 pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-700">{formatCurrency(data.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Tax</span>
            <span className="text-gray-700">{formatCurrency(data.taxTotal)}</span>
          </div>
          {data.tipTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tip</span>
              <span className="text-gray-700">{formatCurrency(data.tipTotal)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base pt-2 border-t border-gray-100">
            <span className="text-gray-900">Total</span>
            <span className="text-gray-900">{formatCurrency(data.total)}</span>
          </div>
        </div>
      </div>

      {/* Pickup Address */}
      {data.pickupAddress && data.orderType !== 'delivery' && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Pickup Location</h3>
          <p className="text-gray-600 text-sm">{data.pickupAddress}</p>
        </div>
      )}

      {/* Back to Menu */}
      <div className="text-center pt-2 pb-4">
        <a
          href="/menu"
          className="inline-block px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{
            backgroundColor: 'var(--site-primary, #2563eb)',
            color: 'white',
          }}
        >
          Back to Menu
        </a>
      </div>
    </div>
  )
}

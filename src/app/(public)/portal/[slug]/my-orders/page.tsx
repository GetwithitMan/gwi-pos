'use client'

import { useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderSummary {
  id: string
  orderNumber: number
  status: string
  eventDate: string | null
  eventType: string | null
  total: number
  depositPaid: number
  balanceDue: number
  createdAt: string
  /** Signed view link (set by the API if available) */
  viewLink?: string
}

const STATUS_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  submitted: { label: 'Submitted', color: 'text-blue-700', bg: 'bg-blue-50' },
  quoted: { label: 'Quote Sent', color: 'text-amber-700', bg: 'bg-amber-50' },
  approved: { label: 'Approved', color: 'text-green-700', bg: 'bg-green-50' },
  deposit_paid: { label: 'Deposit Paid', color: 'text-green-700', bg: 'bg-green-50' },
  in_production: { label: 'In Production', color: 'text-purple-700', bg: 'bg-purple-50' },
  ready: { label: 'Ready', color: 'text-teal-700', bg: 'bg-teal-50' },
  delivered: { label: 'Delivered', color: 'text-gray-700', bg: 'bg-gray-100' },
  completed: { label: 'Completed', color: 'text-gray-700', bg: 'bg-gray-100' },
  cancelled: { label: 'Cancelled', color: 'text-red-700', bg: 'bg-red-50' },
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MyOrdersPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  // OTP flow state
  const [step, setStep] = useState<'phone' | 'code' | 'orders'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Orders state
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)

  // ─── Send OTP ─────────────────────────────────────────────────────────────

  const handleSendCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!phone.trim()) {
      setError('Please enter your phone number.')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/public/portal/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-otp', phone: phone.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send verification code')
      setStep('code')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Verify OTP ───────────────────────────────────────────────────────────

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) {
      setError('Please enter the verification code.')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/public/portal/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-otp', phone: phone.trim(), code: code.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Invalid verification code')

      // Session cookie is set automatically. Now fetch orders.
      setStep('orders')
      await fetchOrders()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Fetch orders ─────────────────────────────────────────────────────────

  const fetchOrders = async () => {
    setOrdersLoading(true)
    try {
      const res = await fetch(`/api/public/portal/${slug}/my-orders`)
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          // Session expired — go back to phone step
          setStep('phone')
          setError('Session expired. Please log in again.')
          return
        }
        throw new Error(json.error || 'Failed to load orders')
      }
      setOrders(json.orders || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setOrdersLoading(false)
    }
  }

  // ─── Phone input step ─────────────────────────────────────────────────────

  if (step === 'phone') {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">My Orders</h2>
          <p className="text-sm text-gray-600 mb-4">
            Enter your phone number and we will send you a verification code.
          </p>

          <form onSubmit={handleSendCode} className="space-y-3">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setError(null)
                }}
                placeholder="(555) 123-4567"
                autoComplete="tel"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg text-white font-semibold text-base transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-primary, #3B82F6)' }}
            >
              {loading ? 'Sending...' : 'Send Code'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ─── Code verification step ───────────────────────────────────────────────

  if (step === 'code') {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Enter Verification Code</h2>
          <p className="text-sm text-gray-600 mb-4">
            We sent a code to <span className="font-medium">{phone}</span>.
          </p>

          <form onSubmit={handleVerify} className="space-y-3">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                Verification Code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setError(null)
                }}
                placeholder="123456"
                maxLength={6}
                autoComplete="one-time-code"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg text-white font-semibold text-base transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-primary, #3B82F6)' }}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('phone')
                setCode('')
                setError(null)
              }}
              className="w-full py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Use a different number
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ─── Orders list step ─────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">My Orders</h2>
        <button
          type="button"
          onClick={fetchOrders}
          disabled={ordersLoading}
          className="text-sm font-medium transition-colors disabled:opacity-50"
          style={{ color: 'var(--brand-primary, #3B82F6)' }}
        >
          {ordersLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {ordersLoading && orders.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Loading orders...</p>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-gray-600">No orders found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const badge = STATUS_BADGES[order.status] || {
              label: order.status,
              color: 'text-gray-700',
              bg: 'bg-gray-100',
            }
            return (
              <div
                key={order.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 cursor-pointer hover:border-gray-300 transition-colors"
                onClick={() => {
                  if (order.viewLink) {
                    router.push(order.viewLink)
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">
                        Order #{order.orderNumber}
                      </span>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.color} ${badge.bg}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {order.eventType && <span>{order.eventType}</span>}
                      {order.eventDate && (
                        <span>
                          {order.eventType ? ' \u00b7 ' : ''}
                          {new Date(order.eventDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">
                      ${order.total.toFixed(2)}
                    </p>
                    {order.balanceDue > 0 && (
                      <p className="text-xs text-gray-500">
                        Due: ${order.balanceDue.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

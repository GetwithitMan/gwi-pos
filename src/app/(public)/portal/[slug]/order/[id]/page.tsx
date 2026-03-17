'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TierSummary {
  shape?: string
  size?: string
  servings?: number
  flavor?: string
  filling?: string
  frosting?: string
}

interface DesignSummary {
  decorations?: string[] | null
  message?: string | null
  theme?: string | null
  colors?: string | null
}

interface Quote {
  id: string
  version: number
  status: string
  lineItems: unknown
  total: number
  depositRequired: number
  validUntilDate: string | null
  sentAt: string | null
  approvedAt: string | null
}

interface Payment {
  amount: number
  type: string
  appliedTo: string
  processedAt: string
}

interface OrderDetail {
  id: string
  orderNumber: number
  status: string
  eventDate: string | null
  eventType: string | null
  guestCount: number | null
  cakeConfig: { tiers: TierSummary[] } | null
  designConfig: DesignSummary | null
  deliveryType: string | null
  notes: string | null
  createdAt: string
  quote: Quote | null
  payments: Payment[]
  depositPaid: number
  balanceDue: number
  // cancelled
  cancelledAt?: string | null
  cancelReason?: string | null
  message?: string
}

// ─── Status helpers ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  quoted: 'Quote Sent',
  approved: 'Quote Accepted',
  deposit_paid: 'Deposit Paid',
  in_production: 'In Production',
  ready: 'Ready',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_STEPS = [
  'submitted',
  'quoted',
  'approved',
  'deposit_paid',
  'in_production',
  'ready',
  'delivered',
  'completed',
]

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.indexOf(status)
  return idx >= 0 ? idx : 0
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const orderId = params.id as string
  const token = searchParams.get('token')

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [acceptSuccess, setAcceptSuccess] = useState(false)

  const fetchOrder = useCallback(async () => {
    if (!token) {
      setError('Access token is required. Please use the link from your email.')
      setLoading(false)
      return
    }
    try {
      const res = await fetch(
        `/api/public/portal/${slug}/order/${orderId}?token=${encodeURIComponent(token)}`,
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load order')
      setOrder(json)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [slug, orderId, token])

  useEffect(() => {
    fetchOrder()
  }, [fetchOrder])

  const handleAcceptQuote = async () => {
    if (!order?.quote || !token) return
    setAccepting(true)
    try {
      const res = await fetch(
        `/api/public/portal/${slug}/quote/${order.quote.id}/accept?token=${encodeURIComponent(token)}`,
        { method: 'PATCH' },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to accept quote')
      setAcceptSuccess(true)
      // Refresh order data
      await fetchOrder()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAccepting(false)
    }
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-500 text-center">Loading order details...</p>
      </div>
    )
  }

  if (error && !order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-500 text-center">Order not found.</p>
      </div>
    )
  }

  // ─── Cancelled ──────────────────────────────────────────────────────────

  if (order.status === 'cancelled') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-2xl font-bold mx-auto mb-3">
            &#10007;
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Order #{order.orderNumber} &mdash; Cancelled
          </h1>
          {order.cancelReason && (
            <p className="text-sm text-gray-600">Reason: {order.cancelReason}</p>
          )}
        </div>
      </div>
    )
  }

  const currentStepIndex = getStepIndex(order.status)

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">
          Order #{order.orderNumber}
        </h1>
        <p className="text-sm text-gray-600">
          {order.eventType && <span>{order.eventType} &middot; </span>}
          {order.eventDate && (
            <span>{new Date(order.eventDate).toLocaleDateString()} &middot; </span>
          )}
          Status: <span className="font-medium">{STATUS_LABELS[order.status] || order.status}</span>
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Accept success banner */}
      {acceptSuccess && (
        <div className="bg-green-50 text-green-700 rounded-lg px-4 py-3 text-sm">
          Quote accepted successfully! You will receive further instructions by email.
        </div>
      )}

      {/* Status Timeline */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Order Progress</h2>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STATUS_STEPS.map((step, i) => {
            const isCompleted = i <= currentStepIndex
            const isCurrent = i === currentStepIndex
            return (
              <div key={step} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                    isCompleted
                      ? isCurrent
                        ? 'text-white'
                        : 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                  style={
                    isCurrent
                      ? { backgroundColor: 'var(--brand-primary, #3B82F6)' }
                      : undefined
                  }
                  title={STATUS_LABELS[step] || step}
                >
                  {isCompleted && !isCurrent ? '\u2713' : i + 1}
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div
                    className={`w-4 h-0.5 ${
                      i < currentStepIndex ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            )
          })}
        </div>
        <div className="flex overflow-x-auto gap-1 mt-1">
          {STATUS_STEPS.map((step) => (
            <span key={step} className="flex-shrink-0 text-[10px] text-gray-500 w-8 text-center">
              {(STATUS_LABELS[step] || step).split(' ')[0]}
            </span>
          ))}
        </div>
      </div>

      {/* Cake Specs Summary */}
      {order.cakeConfig?.tiers && order.cakeConfig.tiers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Cake Specifications</h2>
          <div className="space-y-3">
            {order.cakeConfig.tiers.map((tier, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium text-gray-900">
                  {order.cakeConfig!.tiers.length > 1 ? `Tier ${i + 1}` : 'Cake'}
                </p>
                {tier.shape && <p className="text-gray-600">Shape: {tier.shape}</p>}
                {tier.size && <p className="text-gray-600">Size: {tier.size}</p>}
                {tier.servings && <p className="text-gray-600">Servings: {tier.servings}</p>}
                {tier.flavor && <p className="text-gray-600">Flavor: {tier.flavor}</p>}
                {tier.filling && <p className="text-gray-600">Filling: {tier.filling}</p>}
                {tier.frosting && <p className="text-gray-600">Frosting: {tier.frosting}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Design Details */}
      {order.designConfig && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Design Details</h2>
          <div className="text-sm space-y-1">
            {order.designConfig.message && (
              <p className="text-gray-600">
                Message: &ldquo;{order.designConfig.message}&rdquo;
              </p>
            )}
            {order.designConfig.theme && (
              <p className="text-gray-600">Theme: {order.designConfig.theme}</p>
            )}
            {order.designConfig.colors && (
              <p className="text-gray-600">Colors: {order.designConfig.colors}</p>
            )}
            {order.designConfig.decorations &&
              Array.isArray(order.designConfig.decorations) &&
              order.designConfig.decorations.length > 0 && (
                <p className="text-gray-600">
                  Decorations: {order.designConfig.decorations.join(', ')}
                </p>
              )}
          </div>
        </div>
      )}

      {/* Quote Details + Accept Button */}
      {order.quote && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Quote (v{order.quote.version})
          </h2>

          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Quote Total</span>
              <span className="font-semibold text-gray-900">
                ${order.quote.total.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Deposit Required</span>
              <span className="font-medium text-gray-900">
                ${order.quote.depositRequired.toFixed(2)}
              </span>
            </div>
            {order.quote.validUntilDate && (
              <div className="flex justify-between">
                <span className="text-gray-600">Valid Until</span>
                <span className="text-gray-900">
                  {new Date(order.quote.validUntilDate).toLocaleDateString()}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600">Status</span>
              <span className="font-medium text-gray-900 capitalize">{order.quote.status}</span>
            </div>
          </div>

          {/* Accept Quote button — only show if quote is 'sent' (pending acceptance) */}
          {order.quote.status === 'sent' && (
            <button
              type="button"
              onClick={handleAcceptQuote}
              disabled={accepting}
              className="w-full mt-4 py-3 rounded-lg text-white font-semibold text-base transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-primary, #3B82F6)' }}
            >
              {accepting ? 'Accepting...' : 'Accept Quote'}
            </button>
          )}
        </div>
      )}

      {/* Payment History */}
      {order.payments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Payment History</h2>
          <div className="space-y-2">
            {order.payments.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium text-gray-900 capitalize">{p.type}</span>
                  {p.appliedTo && (
                    <span className="text-gray-500 ml-1">({p.appliedTo})</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="font-semibold text-gray-900">${p.amount.toFixed(2)}</span>
                  <span className="block text-xs text-gray-500">
                    {new Date(p.processedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Balance Due */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-600">Deposit Paid</p>
            <p className="text-lg font-semibold text-green-600">
              ${order.depositPaid.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Balance Due</p>
            <p className="text-lg font-bold" style={{ color: order.balanceDue > 0 ? 'var(--brand-primary, #3B82F6)' : '#16a34a' }}>
              ${order.balanceDue.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

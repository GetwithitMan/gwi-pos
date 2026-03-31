'use client'

/**
 * Order History Page — Lists customer's past orders.
 *
 * Session-authenticated via useSiteAuth. Redirects to /account if not logged in.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSiteModeContext } from '@/components/site/SiteShell'
import { useSiteAuth } from '@/hooks/useSiteAuth'
import { formatDate, formatCurrency } from '@/lib/utils'

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
}

function statusColor(status: string): { bg: string; text: string } {
  switch (status?.toLowerCase()) {
    case 'completed':
    case 'delivered':
    case 'picked_up':
      return { bg: 'color-mix(in srgb, #22c55e 10%, transparent)', text: '#16a34a' }
    case 'in_progress':
    case 'preparing':
      return { bg: 'color-mix(in srgb, #3b82f6 10%, transparent)', text: '#2563eb' }
    case 'pending':
    case 'new':
      return { bg: 'color-mix(in srgb, #f59e0b 10%, transparent)', text: '#d97706' }
    case 'cancelled':
    case 'refunded':
      return { bg: 'color-mix(in srgb, #ef4444 10%, transparent)', text: '#dc2626' }
    default:
      return { bg: 'var(--site-bg-secondary)', text: 'var(--site-text-muted)' }
  }
}

export default function OrderHistoryPage() {
  const { slug } = useSiteModeContext()
  const { isAuthenticated, isLoading: authLoading } = useSiteAuth(slug)
  const router = useRouter()

  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/account')
    }
  }, [authLoading, isAuthenticated, router])

  // Fetch orders
  useEffect(() => {
    if (!slug || !isAuthenticated) return

    async function fetchOrders() {
      try {
        const res = await fetch(`/api/public/portal/${slug}/my-orders`)
        if (!res.ok) {
          if (res.status === 401) {
            router.replace('/account')
            return
          }
          throw new Error('Failed to fetch orders')
        }
        const data = await res.json()
        setOrders(data.orders || [])
      } catch {
        setError('Failed to load order history.')
      } finally {
        setLoading(false)
      }
    }

    fetchOrders()
  }, [slug, isAuthenticated, router])

  // Loading
  if (authLoading || (isAuthenticated && loading)) {
    return (
      <div className="py-12 md:py-16 px-4 md:px-6">
        <div className="max-w-lg mx-auto">
          <div className="h-8 w-48 rounded-lg mb-8 animate-pulse" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 rounded-xl animate-pulse"
                style={{ backgroundColor: 'var(--site-bg-secondary)' }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return null

  return (
    <div className="py-12 md:py-16 px-4 md:px-6">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/account"
            className="p-2 rounded-lg transition-colors hover:opacity-80"
            style={{ color: 'var(--site-text-muted)' }}
            aria-label="Back to account"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <h1
            className="text-2xl md:text-3xl"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Order History
          </h1>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-6 px-4 py-3 rounded-lg text-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, #ef4444 10%, transparent)',
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}

        {/* Empty state */}
        {orders.length === 0 && !error && (
          <div className="text-center py-12">
            <svg
              className="w-12 h-12 mx-auto mb-4"
              style={{ color: 'var(--site-text-muted)' }}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--site-text)' }}>
              No orders yet
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--site-text-muted)' }}>
              Start by browsing our menu!
            </p>
            <Link
              href="/our-menu"
              className="inline-block px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'var(--site-brand)',
                color: 'var(--site-text-on-brand)',
                borderRadius: 'var(--site-btn-radius)',
              }}
            >
              Browse Menu
            </Link>
          </div>
        )}

        {/* Order list */}
        {orders.length > 0 && (
          <div className="space-y-3">
            {orders.map((order) => {
              const sc = statusColor(order.status)
              return (
                <div
                  key={order.id}
                  className="p-4 rounded-xl transition-colors"
                  style={{
                    backgroundColor: 'var(--site-bg-secondary)',
                    border: '1px solid var(--site-border)',
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-base font-semibold" style={{ color: 'var(--site-text)' }}>
                        #{order.orderNumber}
                      </span>
                      {order.eventType && (
                        <span className="text-sm ml-2" style={{ color: 'var(--site-text-muted)' }}>
                          {order.eventType}
                        </span>
                      )}
                    </div>
                    <span
                      className="text-xs font-medium px-2.5 py-1 rounded-full capitalize"
                      style={{ backgroundColor: sc.bg, color: sc.text }}
                    >
                      {order.status?.replace(/_/g, ' ') || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm" style={{ color: 'var(--site-text-muted)' }}>
                    <span>{formatDate(order.createdAt)}</span>
                    <span className="font-medium" style={{ color: 'var(--site-text)' }}>
                      {formatCurrency(order.total)}
                    </span>
                  </div>
                  {order.eventDate && (
                    <p className="text-xs mt-1" style={{ color: 'var(--site-text-muted)' }}>
                      Event: {formatDate(order.eventDate)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function PortalHomePage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [orderNumber, setOrderNumber] = useState('')
  const [trackError, setTrackError] = useState<string | null>(null)
  const [trackLoading, setTrackLoading] = useState(false)

  const handleTrackOrder = async (e: FormEvent) => {
    e.preventDefault()
    if (!orderNumber.trim()) {
      setTrackError('Please enter an order number.')
      return
    }
    setTrackLoading(true)
    setTrackError(null)

    // Order tracking navigates to the order page (customer needs their emailed link with token)
    // For now, show a message directing them to use the link from their email
    setTrackLoading(false)
    setTrackError(
      'Please use the tracking link sent to your email. Enter your email below under "My Orders" to access all your orders.',
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Track Order Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Track an Order</h2>
        <p className="text-sm text-gray-600 mb-4">
          Enter your order number or use the tracking link from your confirmation email.
        </p>

        <form onSubmit={handleTrackOrder} className="space-y-3">
          <div>
            <label htmlFor="order-number" className="sr-only">
              Order Number
            </label>
            <input
              id="order-number"
              type="text"
              value={orderNumber}
              onChange={(e) => {
                setOrderNumber(e.target.value)
                setTrackError(null)
              }}
              placeholder="Order # (e.g., 1042)"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent"
            />
          </div>

          {trackError && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              {trackError}
            </p>
          )}

          <button
            type="submit"
            disabled={trackLoading}
            className="w-full py-3 rounded-lg text-white font-semibold text-base transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand-primary, #3B82F6)' }}
          >
            {trackLoading ? 'Looking up...' : 'Track Order'}
          </button>
        </form>
      </div>

      {/* My Orders Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">My Orders</h2>
        <p className="text-sm text-gray-600 mb-4">
          Log in with your phone number to view all your orders, quotes, and payment history.
        </p>

        <Link
          href={`/portal/${slug}/my-orders`}
          className="block w-full py-3 rounded-lg text-center font-semibold text-base transition-colors border-2"
          style={{
            borderColor: 'var(--brand-primary, #3B82F6)',
            color: 'var(--brand-primary, #3B82F6)',
          }}
        >
          View My Orders
        </Link>
      </div>
    </div>
  )
}

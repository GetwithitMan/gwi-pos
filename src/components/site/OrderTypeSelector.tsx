'use client'

/**
 * OrderTypeSelector — Pickup / Delivery toggle for checkout.
 *
 * When delivery is selected and enabled, shows an address form.
 * On ZIP blur, calls the delivery quote endpoint to check eligibility + fee.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'
import { useSiteCartStore } from '@/stores/site-cart-store'

interface DeliveryQuoteResult {
  status: 'idle' | 'loading' | 'success' | 'not_serviceable' | 'below_minimum' | 'error'
  fee?: number
  estimatedMinutes?: number
  zoneId?: string
  freeDeliveryMinimum?: number
  minimumOrder?: number
  reason?: string
}

interface OrderTypeSelectorProps {
  value: 'pickup' | 'delivery' | 'dine_in'
  onChange: (type: 'pickup' | 'delivery' | 'dine_in') => void
  venueAddress: string | null
  prepTime: number // minutes
  canPlaceDeliveryOrder: boolean
  isDineIn?: boolean // QR table context present
  slug: string
  subtotal: number
}

export function OrderTypeSelector({
  value,
  onChange,
  venueAddress,
  prepTime,
  canPlaceDeliveryOrder,
  isDineIn,
  slug,
  subtotal,
}: OrderTypeSelectorProps) {
  const deliveryAddress = useSiteCartStore((s) => s.deliveryAddress)
  const deliveryCity = useSiteCartStore((s) => s.deliveryCity)
  const deliveryState = useSiteCartStore((s) => s.deliveryState)
  const deliveryZip = useSiteCartStore((s) => s.deliveryZip)
  const deliveryInstructions = useSiteCartStore((s) => s.deliveryInstructions)
  const setDeliveryAddress = useSiteCartStore((s) => s.setDeliveryAddress)
  const setDeliveryQuote = useSiteCartStore((s) => s.setDeliveryQuote)
  const clearDeliveryAddress = useSiteCartStore((s) => s.clearDeliveryAddress)

  const [quote, setQuote] = useState<DeliveryQuoteResult>({ status: 'idle' })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When switching away from delivery, clear the address
  useEffect(() => {
    if (value !== 'delivery') {
      clearDeliveryAddress()
      setQuote({ status: 'idle' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const fetchQuote = useCallback(
    async (zip: string, address: string) => {
      if (!zip || zip.length < 5) return
      setQuote({ status: 'loading' })

      try {
        const res = await fetch('/api/public/delivery/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, zip, address, subtotal }),
        })
        const json = await res.json()

        if (!res.ok) {
          setQuote({ status: 'error', reason: json.error || 'Failed to check delivery' })
          return
        }

        if (json.serviceable) {
          setQuote({
            status: 'success',
            fee: json.fee,
            estimatedMinutes: json.estimatedMinutes,
            zoneId: json.zoneId,
            freeDeliveryMinimum: json.freeDeliveryMinimum,
          })
          setDeliveryQuote({ zoneId: json.zoneId, fee: json.fee })
        } else if (json.minimumOrder) {
          setQuote({
            status: 'below_minimum',
            minimumOrder: json.minimumOrder,
            reason: json.reason,
          })
        } else {
          setQuote({ status: 'not_serviceable', reason: json.reason })
        }
      } catch {
        setQuote({ status: 'error', reason: 'Network error. Please try again.' })
      }
    },
    [slug, subtotal, setDeliveryQuote]
  )

  const handleZipBlur = useCallback(
    (zip: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void fetchQuote(zip, deliveryAddress)
      }, 300)
    },
    [fetchQuote, deliveryAddress]
  )

  const handleAddressField = useCallback(
    (field: string, val: string) => {
      const current = { address: deliveryAddress, city: deliveryCity, state: deliveryState, zip: deliveryZip, instructions: deliveryInstructions }
      setDeliveryAddress({ ...current, [field]: val })
    },
    [deliveryAddress, deliveryCity, deliveryState, deliveryZip, deliveryInstructions, setDeliveryAddress]
  )
  // If QR dine-in mode, show locked dine-in indicator
  if (isDineIn) {
    return (
      <div
        className="rounded-xl p-4 border"
        style={{
          borderColor: 'var(--site-brand)',
          backgroundColor: 'rgba(var(--site-brand-rgb), 0.05)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-full"
            style={{ backgroundColor: 'var(--site-brand)', color: 'var(--site-brand-text)' }}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--site-text)' }}>
              Dine-In Order
            </p>
            <p className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
              Your order will be brought to your table
            </p>
          </div>
        </div>
      </div>
    )
  }

  const options: Array<{
    type: 'pickup' | 'delivery'
    label: string
    icon: React.ReactNode
    detail: string
    enabled: boolean
  }> = [
    {
      type: 'pickup',
      label: 'Pickup',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      ),
      detail: prepTime > 0 ? `Ready in ~${prepTime} min` : 'Ready for pickup',
      enabled: true,
    },
    {
      type: 'delivery',
      label: 'Delivery',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0H6.375c-.621 0-1.125-.504-1.125-1.125V14.25m0 0V5.625m0 8.625h7.5M3.375 5.625h16.5" />
        </svg>
      ),
      detail: canPlaceDeliveryOrder ? 'Delivered to your door' : 'Coming soon',
      enabled: canPlaceDeliveryOrder,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isSelected = value === opt.type
          return (
            <button
              key={opt.type}
              onClick={() => opt.enabled && onChange(opt.type)}
              disabled={!opt.enabled}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                !opt.enabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
              }`}
              style={{
                borderColor: isSelected ? 'var(--site-brand)' : 'var(--site-border)',
                backgroundColor: isSelected ? 'rgba(var(--site-brand-rgb), 0.05)' : 'transparent',
                color: isSelected ? 'var(--site-brand)' : 'var(--site-text)',
              }}
            >
              {opt.icon}
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
                {opt.detail}
              </span>
            </button>
          )
        })}
      </div>

      {/* Venue address for pickup */}
      {value === 'pickup' && venueAddress && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs"
          style={{
            backgroundColor: 'var(--site-surface)',
            color: 'var(--site-text-muted)',
          }}
        >
          <svg className="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
          <span>{venueAddress}</span>
        </div>
      )}

      {/* Delivery address form */}
      {value === 'delivery' && canPlaceDeliveryOrder && (
        <div
          className="space-y-3 p-4 rounded-xl border"
          style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-surface)' }}
        >
          <input
            type="text"
            value={deliveryAddress}
            onChange={(e) => handleAddressField('address', e.target.value)}
            placeholder="Street address *"
            autoComplete="street-address"
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
            style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)', color: 'var(--site-text)' }}
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={deliveryCity}
              onChange={(e) => handleAddressField('city', e.target.value)}
              placeholder="City"
              autoComplete="address-level2"
              className="px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)', color: 'var(--site-text)' }}
            />
            <input
              type="text"
              value={deliveryState}
              onChange={(e) => handleAddressField('state', e.target.value.toUpperCase().slice(0, 2))}
              placeholder="State"
              autoComplete="address-level1"
              maxLength={2}
              className="px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)', color: 'var(--site-text)' }}
            />
            <input
              type="text"
              value={deliveryZip}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 5)
                handleAddressField('zip', v)
              }}
              onBlur={(e) => handleZipBlur(e.target.value)}
              placeholder="ZIP *"
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={5}
              className="px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)', color: 'var(--site-text)' }}
            />
          </div>
          <textarea
            value={deliveryInstructions}
            onChange={(e) => handleAddressField('instructions', e.target.value)}
            placeholder="Delivery instructions (optional)"
            maxLength={500}
            rows={2}
            className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none resize-none"
            style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)', color: 'var(--site-text)' }}
          />

          {/* Quote result */}
          {quote.status === 'loading' && (
            <div className="flex items-center gap-2 text-xs py-2" style={{ color: 'var(--site-text-muted)' }}>
              <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--site-border)', borderTopColor: 'var(--site-brand)' }} />
              Checking delivery availability...
            </div>
          )}
          {quote.status === 'success' && (
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'rgba(22, 163, 74, 0.08)', color: '#16a34a' }}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              {quote.fee === 0
                ? `Free Delivery! (orders over ${formatCurrency(quote.freeDeliveryMinimum ?? 0)})`
                : `Delivery fee: ${formatCurrency(quote.fee ?? 0)} · Est. ${quote.estimatedMinutes} min`}
            </div>
          )}
          {quote.status === 'not_serviceable' && (
            <div
              className="px-3 py-2.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'rgba(220, 38, 38, 0.08)', color: '#dc2626' }}
            >
              {quote.reason || "Sorry, we don't deliver to this area"}
            </div>
          )}
          {quote.status === 'below_minimum' && (
            <div
              className="px-3 py-2.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'rgba(217, 119, 6, 0.08)', color: '#d97706' }}
            >
              {quote.reason || `Minimum order of ${formatCurrency(quote.minimumOrder ?? 0)} required for delivery`}
            </div>
          )}
          {quote.status === 'error' && (
            <div
              className="px-3 py-2.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'rgba(220, 38, 38, 0.08)', color: '#dc2626' }}
            >
              {quote.reason || 'Failed to check delivery availability'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

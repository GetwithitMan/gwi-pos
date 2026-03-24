'use client'

/**
 * PaymentForm — Datacap Hosted Token iframe wrapper.
 *
 * Loads the Datacap CDN script, initializes the hosted token iframe,
 * and handles tokenization. On token received, calls POST /api/online/checkout
 * with the full payload. Handles success/decline/error states.
 *
 * Uses PayAPI (not POS gateway) — same pattern as src/app/(public)/order/page.tsx.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { CartItem } from '@/stores/site-cart-store'

// Datacap Hosted Web Token global (loaded via CDN script)
declare const DatacapHostedWebToken: {
  init: (tokenKey: string, iframeId: string, callback: (resp: DatacapTokenResponse) => void) => void
  requestToken: () => void
  removeMessageEventListener: () => void
}

interface DatacapTokenResponse {
  Token?: string
  Brand?: string
  Last4?: string
  Error?: string
}

interface PaymentFormProps {
  slug: string
  items: CartItem[]
  orderType: 'pickup' | 'delivery' | 'dine_in'
  customerInfo: { name: string; email: string; phone: string }
  specialRequests: string
  tipAmount: number
  couponCode: string | null
  giftCardNumber: string | null
  giftCardPin?: string
  tableContext: { table: string; section?: string } | null
  deliveryAddress?: string
  deliveryCity?: string
  deliveryState?: string
  deliveryZip?: string
  deliveryInstructions?: string
  deliveryZoneId?: string | null
  deliveryFee?: number
  onSuccess: (orderId: string, orderNumber: number, token: string) => void
  onError: (message: string) => void
  disabled?: boolean
}

export function PaymentForm({
  slug,
  items,
  orderType,
  customerInfo,
  specialRequests,
  tipAmount,
  couponCode,
  giftCardNumber,
  giftCardPin,
  tableContext,
  deliveryAddress,
  deliveryCity,
  deliveryState,
  deliveryZip,
  deliveryInstructions,
  deliveryZoneId,
  deliveryFee,
  onSuccess,
  onError,
  disabled,
}: PaymentFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [datacapReady, setDatacapReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const datacapInitialized = useRef(false)
  const idempotencyKey = useRef(crypto.randomUUID())

  // ── Stable ref for the Datacap callback to avoid stale closures ──
  const handleDatacapTokenRef = useRef<(resp: DatacapTokenResponse) => void>(null)

  // ── Handle Datacap token response ────────────────────────────
  const handleDatacapToken = useCallback(
    async (resp: DatacapTokenResponse) => {
      if (resp.Error) {
        setError(resp.Error)
        setLoading(false)
        return
      }

      if (!resp.Token) {
        setError('No payment token received. Please try again.')
        setLoading(false)
        return
      }

      // Flatten nested modifier childSelections recursively
      function flattenModifiers(mods: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null; depth: number; childSelections?: unknown[] }>): Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> {
        const result: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> = []
        for (const mod of mods) {
          result.push({ modifierId: mod.modifierId, name: mod.name, price: mod.price, quantity: mod.quantity, preModifier: mod.preModifier })
          if (mod.childSelections && Array.isArray(mod.childSelections)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result.push(...flattenModifiers(mod.childSelections as any))
          }
        }
        return result
      }

      // Build checkout payload
      const payload = {
        slug,
        token: resp.Token,
        cardBrand: resp.Brand ?? null,
        cardLast4: resp.Last4 ?? null,
        idempotencyKey: idempotencyKey.current,
        orderType,
        items: items.map((item) => ({
          menuItemId: item.menuItemId,
          name: item.name,
          basePrice: item.basePrice,
          quantity: item.quantity,
          itemType: item.itemType,
          specialInstructions: item.specialInstructions || null,
          modifiers: flattenModifiers(item.modifiers),
          pizzaData: item.pizzaData ?? null,
        })),
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        customerPhone: customerInfo.phone,
        specialRequests: specialRequests || null,
        tipAmount,
        couponCode: couponCode || null,
        giftCardNumber: giftCardNumber || null,
        giftCardPin: giftCardPin || null,
        tableId: tableContext?.table ?? null,
        tableContext: tableContext || null,
        ...(orderType === 'delivery'
          ? {
              deliveryAddress: deliveryAddress || null,
              deliveryCity: deliveryCity || null,
              deliveryState: deliveryState || null,
              deliveryZip: deliveryZip || null,
              deliveryInstructions: deliveryInstructions || null,
              deliveryZoneId: deliveryZoneId || null,
              deliveryFee: deliveryFee ?? 0,
            }
          : {}),
      }

      try {
        const res = await fetch('/api/online/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const json = await res.json()

        if (!res.ok) {
          setError(json.error || 'Payment failed. Please try a different card.')
          setLoading(false)
          // Generate new idempotency key for retry
          idempotencyKey.current = crypto.randomUUID()
          return
        }

        onSuccess(json.data.orderId, json.data.orderNumber, json.data.statusToken)
      } catch {
        setError('Network error. Please check your connection and try again.')
        setLoading(false)
        idempotencyKey.current = crypto.randomUUID()
      }
    },
    [slug, items, orderType, customerInfo, specialRequests, tipAmount, couponCode, giftCardNumber, giftCardPin, tableContext, deliveryAddress, deliveryCity, deliveryState, deliveryZip, deliveryInstructions, deliveryZoneId, deliveryFee, onSuccess]
  )

  // Always keep the ref pointing to the latest callback
  handleDatacapTokenRef.current = handleDatacapToken

  // ── Initialize Datacap ───────────────────────────────────────
  const initDatacap = useCallback(() => {
    const tokenKey = process.env.NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY ?? ''
    if (!tokenKey) {
      setError('Payment system not configured. Please contact the venue.')
      return
    }
    try {
      // Use stable ref wrapper so the listener always calls the latest closure
      DatacapHostedWebToken.init(tokenKey, 'datacap-site-token-iframe', (resp) => {
        handleDatacapTokenRef.current?.(resp)
      })
      datacapInitialized.current = true
      setDatacapReady(true)
    } catch (err) {
      console.error('Datacap init error:', err)
      setError('Failed to initialize payment form. Please refresh.')
    }
  }, []) // stable — no deps needed since we use ref

  // ── Load Datacap CDN script ──────────────────────────────────
  useEffect(() => {
    if (datacapInitialized.current) return

    const env = process.env.NEXT_PUBLIC_DATACAP_ENV ?? 'cert'
    const scriptSrc =
      env === 'production'
        ? 'https://token.dcap.com/v1/client/hosted'
        : 'https://token-cert.dcap.com/v1/client/hosted'

    const existing = document.querySelector(`script[src="${scriptSrc}"]`)
    if (existing) {
      initDatacap()
      return
    }

    const script = document.createElement('script')
    script.src = scriptSrc
    script.async = true
    script.onload = () => initDatacap()
    script.onerror = () => setError('Failed to load payment form. Please refresh.')
    document.body.appendChild(script)

    return () => {
      try {
        DatacapHostedWebToken.removeMessageEventListener()
      } catch {
        // library may not be loaded yet
      }
    }
  }, [initDatacap])

  // ── Trigger tokenization ─────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!datacapReady || loading || disabled) return
    setLoading(true)
    setError(null)
    try {
      DatacapHostedWebToken.requestToken()
    } catch {
      setError('Payment form error. Please refresh and try again.')
      setLoading(false)
    }
  }, [datacapReady, loading, disabled])

  return (
    <div className="space-y-4">
      {/* Datacap hosted iframe for card entry */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          borderColor: 'var(--site-border)',
          backgroundColor: 'var(--site-surface)',
          minHeight: '140px',
        }}
      >
        <iframe
          id="datacap-site-token-iframe"
          title="Card Entry"
          className="w-full border-0"
          style={{ height: '140px' }}
        />
      </div>

      {!datacapReady && !error && (
        <p className="text-xs text-center" style={{ color: 'var(--site-text-muted)' }}>
          Loading secure payment form...
        </p>
      )}

      {/* Error display */}
      {error && (
        <div
          className="px-4 py-3 rounded-lg text-sm"
          style={{
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            color: '#dc2626',
          }}
        >
          {error}
        </div>
      )}

      {/* Place Order button */}
      <button
        onClick={handleSubmit}
        disabled={!datacapReady || loading || disabled}
        className="w-full py-4 rounded-xl text-base font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: 'var(--site-brand)',
          color: 'var(--site-brand-text)',
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Processing...
          </span>
        ) : (
          'Place Order'
        )}
      </button>

      {/* Security note */}
      <div className="flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--site-text-muted)' }}>
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <span>Secure, encrypted payment</span>
      </div>
    </div>
  )
}

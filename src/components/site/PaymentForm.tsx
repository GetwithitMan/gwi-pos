'use client'

/**
 * PaymentForm — Tabbed payment method wrapper for online checkout.
 *
 * Supports three payment methods:
 *   Tab 1: Credit/Debit Card (Datacap Hosted Token iframe)
 *   Tab 2: Bank Account / ACH (Datacap PayAPI ACH)
 *   Tab 3: Apple Pay / Google Pay (Datacap Wallet — rendered above tabs when available)
 *
 * The card tab loads the Datacap CDN script, initializes the hosted token iframe,
 * and handles tokenization. The ACH tab renders the AchPaymentForm inline.
 * Wallet buttons appear above the tabs when configured.
 *
 * Uses PayAPI (not POS gateway) — same pattern as src/app/(public)/order/page.tsx.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { CartItem } from '@/stores/site-cart-store'
import { WalletPayButton, type WalletType } from '@/components/site/WalletPayButton'
import { AchPaymentForm } from '@/components/site/AchPaymentForm'

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

type PaymentTab = 'card' | 'ach'

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
  /** Venue name for wallet payment sheet display and ACH authorization text */
  merchantName?: string
  /** Apple Pay Merchant ID (from venue settings / Datacap provisioning) */
  applePayMid?: string | null
  /** Google Pay Business ID (from venue settings / Google Pay console) */
  googlePayBusinessId?: string | null
  /** Estimated total for wallet payment sheet (subtotal + tax + tip + surcharge - discounts) */
  estimatedTotal?: number
  /** Whether ACH payments are enabled for this venue */
  achEnabled?: boolean
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
  merchantName,
  applePayMid,
  googlePayBusinessId,
  estimatedTotal,
  achEnabled,
}: PaymentFormProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<PaymentTab>('card')
  const [loading, setLoading] = useState(false)
  const [datacapReady, setDatacapReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const datacapInitialized = useRef(false)
  const idempotencyKey = useRef(crypto.randomUUID())

  // ── Stable ref for the Datacap callback to avoid stale closures ──
  const handleDatacapTokenRef = useRef<(resp: DatacapTokenResponse) => void>(null)

  // ── Flatten nested modifier childSelections recursively ────────
  function flattenModifiers(mods: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null; depth: number; childSelections?: unknown[] }>): Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> {
    const result: Array<{ modifierId: string; name: string; price: number; quantity: number; preModifier: string | null }> = []
    for (const mod of mods) {
      result.push({ modifierId: mod.modifierId, name: mod.name, price: mod.price, quantity: mod.quantity, preModifier: mod.preModifier })
      if (mod.childSelections && Array.isArray(mod.childSelections)) {
        result.push(...flattenModifiers(mod.childSelections as any))
      }
    }
    return result
  }

  // ── Shared checkout submission (used by card and wallet flows) ──
  const submitCheckout = useCallback(
    async (token: string, cardBrand: string | null, cardLast4: string | null, walletType?: WalletType) => {
      const payload = {
        slug,
        token,
        cardBrand,
        cardLast4,
        walletType: walletType ?? null,
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

      const res = await fetch('/api/online/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (!res.ok) {
        // Generate new idempotency key for retry
        idempotencyKey.current = crypto.randomUUID()
        throw new Error(json.error || 'Payment failed. Please try a different card.')
      }

      onSuccess(json.data.orderId, json.data.orderNumber, json.data.statusToken)
    },
    [slug, items, orderType, customerInfo, specialRequests, tipAmount, couponCode, giftCardNumber, giftCardPin, tableContext, deliveryAddress, deliveryCity, deliveryState, deliveryZip, deliveryInstructions, deliveryZoneId, deliveryFee, onSuccess]
  )

  // ── Handle Datacap card token response (iframe flow) ───────────
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

      try {
        await submitCheckout(resp.Token, resp.Brand ?? null, resp.Last4 ?? null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
        setLoading(false)
        idempotencyKey.current = crypto.randomUUID()
      }
    },
    [submitCheckout]
  )

  // ── Handle wallet token (Apple Pay / Google Pay) ───────────────
  const handleWalletToken = useCallback(
    async (token: string, walletType: WalletType, brand: string | null, last4: string | null) => {
      setLoading(true)
      setError(null)
      try {
        await submitCheckout(token, brand, last4, walletType)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Payment failed. Please try again.'
        setError(msg)
        setLoading(false)
        idempotencyKey.current = crypto.randomUUID()
        throw err // Re-throw so the wallet sheet shows failure
      }
    },
    [submitCheckout]
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

  // ── Trigger card tokenization ──────────────────────────────────
  const handleCardSubmit = useCallback(() => {
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

  // Clear error when switching tabs
  const handleTabChange = useCallback((tab: PaymentTab) => {
    setActiveTab(tab)
    setError(null)
  }, [])

  // ── Wallet config ───────────────────────────────────────────
  const datacapTokenKey = process.env.NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY ?? ''
  const datacapEnv = process.env.NEXT_PUBLIC_DATACAP_ENV ?? 'cert'
  const walletAmount = (estimatedTotal ?? 0).toFixed(2)
  const hasWalletOption = !!(applePayMid || googlePayBusinessId) && !!datacapTokenKey

  // Show tabs only if ACH is enabled
  const showTabs = !!achEnabled

  return (
    <div className="space-y-4">
      {/* ── Wallet Pay Buttons (Apple Pay / Google Pay) ─────────── */}
      {hasWalletOption && (
        <WalletPayButton
          amount={walletAmount}
          merchantName={merchantName || 'Online Order'}
          tokenKey={datacapTokenKey}
          applePayMid={applePayMid}
          googlePayBusinessId={googlePayBusinessId}
          env={datacapEnv}
          onToken={handleWalletToken}
          onError={(msg) => setError(msg)}
          disabled={disabled || loading}
        />
      )}

      {/* ── Payment Method Tabs ──────────────────────────────────── */}
      {showTabs && (
        <div
          className="flex rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--site-border)' }}
        >
          <button
            type="button"
            onClick={() => handleTabChange('card')}
            className="flex-1 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: activeTab === 'card' ? 'var(--site-brand)' : 'var(--site-surface)',
              color: activeTab === 'card' ? 'var(--site-brand-text)' : 'var(--site-text)',
            }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
            </svg>
            Credit / Debit Card
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('ach')}
            className="flex-1 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: activeTab === 'ach' ? 'var(--site-brand)' : 'var(--site-surface)',
              color: activeTab === 'ach' ? 'var(--site-brand-text)' : 'var(--site-text)',
              borderLeft: '1px solid var(--site-border)',
            }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
            </svg>
            Bank Account (ACH)
          </button>
        </div>
      )}

      {/* ── Card Payment Tab ─────────────────────────────────────── */}
      {activeTab === 'card' && (
        <>
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
            onClick={handleCardSubmit}
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
        </>
      )}

      {/* ── ACH Payment Tab ──────────────────────────────────────── */}
      {activeTab === 'ach' && achEnabled && (
        <AchPaymentForm
          slug={slug}
          items={items}
          orderType={orderType}
          customerInfo={customerInfo}
          specialRequests={specialRequests}
          tipAmount={tipAmount}
          couponCode={couponCode}
          giftCardNumber={giftCardNumber}
          giftCardPin={giftCardPin}
          tableContext={tableContext}
          deliveryAddress={deliveryAddress}
          deliveryCity={deliveryCity}
          deliveryState={deliveryState}
          deliveryZip={deliveryZip}
          deliveryInstructions={deliveryInstructions}
          deliveryZoneId={deliveryZoneId}
          deliveryFee={deliveryFee}
          venueName={merchantName || 'this merchant'}
          onSuccess={onSuccess}
          onError={onError}
          disabled={disabled}
        />
      )}
    </div>
  )
}

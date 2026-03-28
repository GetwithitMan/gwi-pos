'use client'

/**
 * Guest Checkout Client — No authentication required.
 *
 * Flow:
 * 1. Shows cart items (from Zustand store)
 * 2. Customer info: name, phone, email (inline, no account)
 * 3. Order type: pickup (delivery if enabled)
 * 4. Tip selection
 * 5. Coupon code (optional)
 * 6. Gift card (optional)
 * 7. Datacap payment iframe
 * 8. Place order → redirect to order status
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSiteCartStore, useCartItems, useCartItemCount, useCartSubtotal } from '@/stores/site-cart-store'
import { CartItemRow } from '@/components/site/CartItemRow'
import { formatCurrency } from '@/lib/utils'

interface CheckoutConfig {
  venueName: string
  venueAddress: string | null
  prepTime: number
  tipSuggestions: number[]
  defaultTip: number
  requireZip: boolean
  allowSpecialRequests: boolean
  surchargeType: string | null
  surchargeAmount: number
  surchargeName: string
  deliveryEnabled: boolean
  slug: string
}

// Datacap global
declare const DatacapHostedWebToken: {
  init: (tokenKey: string, iframeId: string, callback: (resp: { Token?: string; Brand?: string; Last4?: string; Error?: string }) => void) => void
  requestToken: () => void
  removeMessageEventListener: () => void
}

const THEME_CSS = `
:root {
  --site-brand: #3B82F6;
  --site-brand-rgb: 59,130,246;
  --site-text-on-brand: #ffffff;
  --site-border: #e5e7eb;
  --site-surface: #ffffff;
  --site-text: #111827;
  --site-text-secondary: #6b7280;
  --site-primary: #3B82F6;
  --site-success: #16a34a;
}
`

export function CheckoutClient({ config }: { config: CheckoutConfig }) {
  const router = useRouter()
  const pathname = usePathname()
  const items = useCartItems()
  const itemCount = useCartItemCount()
  const subtotal = useCartSubtotal()
  const clearCart = useSiteCartStore(s => s.clearCart)

  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [specialRequests, setSpecialRequests] = useState('')
  const [tipPercent, setTipPercent] = useState<number | null>(config.defaultTip)
  const [tipCustom, setTipCustom] = useState(0)
  const [couponCode, setCouponCode] = useState('')
  const [couponDiscount, setCouponDiscount] = useState(0)
  const [couponApplied, setCouponApplied] = useState(false)
  const [couponError, setCouponError] = useState('')
  const [giftCardNumber, setGiftCardNumber] = useState('')
  const [giftCardPin, setGiftCardPin] = useState('')
  const [giftCardBalance, setGiftCardBalance] = useState(0)
  const [giftCardApplied, setGiftCardApplied] = useState(false)
  const [giftCardError, setGiftCardError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [datacapReady, setDatacapReady] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Redirect to menu if cart empty
  useEffect(() => {
    if (mounted && itemCount === 0) {
      const menuPath = pathname.replace(/\/checkout$/, '')
      router.replace(menuPath)
    }
  }, [mounted, itemCount, pathname, router])

  // Load Datacap script
  useEffect(() => {
    const tokenKey = process.env.NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY
    if (!tokenKey) return

    const cdnUrl = process.env.NEXT_PUBLIC_DATACAP_ENV === 'production'
      ? 'https://token.dcap.com/v2/hostedtoken.js'
      : 'https://token-cert.dcap.com/v2/hostedtoken.js'

    const script = document.createElement('script')
    script.src = cdnUrl
    script.async = true
    script.onload = () => {
      try {
        DatacapHostedWebToken.init(tokenKey, 'datacap-iframe', () => {})
        setDatacapReady(true)
      } catch { /* ignore */ }
    }
    document.head.appendChild(script)

    return () => {
      try { DatacapHostedWebToken.removeMessageEventListener() } catch { /* ignore */ }
    }
  }, [])

  // Tip calculation
  const tipAmount = useMemo(() => {
    if (tipPercent !== null) return Math.round(subtotal * tipPercent / 100 * 100) / 100
    return tipCustom
  }, [subtotal, tipPercent, tipCustom])

  // Surcharge
  const surchargeAmount = useMemo(() => {
    if (config.surchargeType === 'flat') return config.surchargeAmount
    if (config.surchargeType === 'percent') return Math.round(subtotal * config.surchargeAmount / 100 * 100) / 100
    return 0
  }, [subtotal, config])

  // Tax estimate (rough — server is authoritative)
  const taxEstimate = Math.round(subtotal * 0.08 * 100) / 100

  // Gift card applied amount
  const giftCardApplyAmount = giftCardApplied ? Math.min(giftCardBalance, subtotal + taxEstimate + tipAmount + surchargeAmount - couponDiscount) : 0

  // Total
  const total = Math.max(0, subtotal + taxEstimate + tipAmount + surchargeAmount - couponDiscount - giftCardApplyAmount)

  const isFormValid = name.trim().length > 0 && phone.trim().length > 0 && email.trim().length > 0

  // Apply coupon
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    setCouponError('')
    try {
      const res = await fetch('/api/public/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim(), slug: config.slug, subtotal }),
      })
      const data = await res.json()
      if (data.valid) {
        setCouponDiscount(data.discount || 0)
        setCouponApplied(true)
      } else {
        setCouponError(data.reason || 'Invalid coupon')
      }
    } catch {
      setCouponError('Failed to validate coupon')
    }
  }

  // Apply gift card
  const handleApplyGiftCard = async () => {
    if (!giftCardNumber.trim()) return
    setGiftCardError('')
    try {
      const res = await fetch('/api/public/gift-cards/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: giftCardNumber.trim(), pin: giftCardPin.trim() || undefined, slug: config.slug }),
      })
      const data = await res.json()
      if (data.valid) {
        setGiftCardBalance(data.balance)
        setGiftCardApplied(true)
      } else {
        setGiftCardError(data.reason || 'Invalid gift card')
      }
    } catch {
      setGiftCardError('Failed to check gift card')
    }
  }

  // Place order
  const handlePlaceOrder = useCallback(async () => {
    if (!isFormValid || processing) return
    setProcessing(true)
    setError('')

    const idempotencyKey = crypto.randomUUID()

    try {
      // Get Datacap token (skip if gift card covers full amount)
      let token = ''
      let cardBrand = ''
      let cardLast4 = ''

      if (total > 0) {
        // Request token from Datacap iframe
        const tokenResult = await new Promise<{ Token?: string; Brand?: string; Last4?: string; Error?: string }>((resolve) => {
          const tokenKey = process.env.NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY
          if (!tokenKey) { resolve({ Error: 'Payment not configured' }); return }
          DatacapHostedWebToken.init(tokenKey, 'datacap-iframe', resolve)
          DatacapHostedWebToken.requestToken()
        })

        if (tokenResult.Error || !tokenResult.Token) {
          setError(tokenResult.Error || 'Failed to process card. Please try again.')
          setProcessing(false)
          return
        }
        token = tokenResult.Token
        cardBrand = tokenResult.Brand || ''
        cardLast4 = tokenResult.Last4 || ''
      }

      // Submit order
      const res = await fetch('/api/online/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: config.slug,
          token: token || undefined,
          cardBrand: cardBrand || undefined,
          cardLast4: cardLast4 || undefined,
          items: items.map(item => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            modifiers: item.modifiers.map(m => ({
              modifierId: m.modifierId,
              name: m.name,
              price: m.price,
              quantity: m.quantity || 1,
              preModifier: m.preModifier || null,
            })),
          })),
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          tipAmount: tipAmount,
          specialRequests: specialRequests.trim() || undefined,
          orderType: 'takeout',
          couponCode: couponApplied ? couponCode.trim() : undefined,
          giftCardNumber: giftCardApplied ? giftCardNumber.trim() : undefined,
          giftCardPin: giftCardApplied && giftCardPin ? giftCardPin.trim() : undefined,
          idempotencyKey,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Order failed. Please try again.')
        setProcessing(false)
        return
      }

      // Success — clear cart and redirect to order status
      clearCart()
      const statusUrl = data.data?.statusToken
        ? `/api/public/order-status/${data.data.orderId}?token=${data.data.statusToken}`
        : pathname.replace(/\/checkout$/, '')

      // Show simple success page instead of redirect for now
      router.replace(`${pathname}?success=1&order=${data.data?.orderNumber || ''}`)
    } catch {
      setError('Network error. Please check your connection and try again.')
      setProcessing(false)
    }
  }, [isFormValid, processing, total, items, name, email, phone, tipAmount, specialRequests, couponApplied, couponCode, giftCardApplied, giftCardNumber, giftCardPin, config.slug, clearCart, router, pathname])

  if (!mounted || itemCount === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    )
  }

  // Simple success state
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  if (searchParams?.get('success') === '1') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-lg border border-gray-200">
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Placed!</h1>
            <p className="text-gray-500 mb-1">Order #{searchParams.get('order')}</p>
            <p className="text-gray-500 mb-6">Estimated ready in ~{config.prepTime} minutes</p>
            <p className="text-sm text-gray-400 mb-6">{config.venueAddress}</p>
            <a
              href={pathname.replace(/\/checkout.*$/, '')}
              className="inline-block px-6 py-3 rounded-xl text-white font-semibold"
              style={{ backgroundColor: 'var(--site-brand, #3B82F6)' }}
            >
              Back to Menu
            </a>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center">
            <button onClick={() => router.back()} className="mr-3 p-1 text-gray-500 hover:text-gray-900">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">Checkout</h1>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-32">
          {/* Order Items */}
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Your Order ({itemCount} items)</h2>
            <div className="divide-y divide-gray-100">
              {items.map(item => (
                <CartItemRow key={item.id} item={item} compact />
              ))}
            </div>
            <div className="flex justify-between mt-3 pt-3 border-t border-gray-100">
              <span className="font-semibold text-gray-900">Subtotal</span>
              <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
            </div>
          </section>

          {/* Pickup Info */}
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Pickup Order</h2>
            <p className="text-sm text-gray-500">{config.venueAddress || 'Address not available'}</p>
            <p className="text-sm text-gray-500">Ready in ~{config.prepTime} min</p>
          </section>

          {/* Customer Info — GUEST, no auth */}
          <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Your Info</h2>
            <input
              type="text"
              placeholder="Name *"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <input
              type="tel"
              placeholder="Phone *"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              inputMode="tel"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <input
              type="email"
              placeholder="Email *"
              value={email}
              onChange={e => setEmail(e.target.value)}
              inputMode="email"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            {config.allowSpecialRequests && (
              <textarea
                placeholder="Special requests (optional)"
                value={specialRequests}
                onChange={e => setSpecialRequests(e.target.value)}
                maxLength={200}
                rows={2}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm resize-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            )}
          </section>

          {/* Tip */}
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Tip</h2>
            <div className="flex gap-2 flex-wrap">
              {config.tipSuggestions.map(pct => (
                <button
                  key={pct}
                  onClick={() => { setTipPercent(pct); setTipCustom(0) }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] ${
                    tipPercent === pct ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={tipPercent === pct ? { backgroundColor: '#3B82F6' } : undefined}
                >
                  {pct}%
                  <span className="block text-xs opacity-75">{formatCurrency(Math.round(subtotal * pct / 100 * 100) / 100)}</span>
                </button>
              ))}
              <button
                onClick={() => { setTipPercent(null); setTipCustom(0) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] ${
                  tipPercent === null ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={tipPercent === null ? { backgroundColor: '#3B82F6' } : undefined}
              >
                Custom
              </button>
              <button
                onClick={() => { setTipPercent(0); setTipCustom(0) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] ${
                  tipPercent === 0 ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={tipPercent === 0 ? { backgroundColor: '#3B82F6' } : undefined}
              >
                No Tip
              </button>
            </div>
            {tipPercent === null && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tipCustom || ''}
                  onChange={e => setTipCustom(Number(e.target.value) || 0)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
              </div>
            )}
          </section>

          {/* Coupon */}
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Promo Code</h2>
            {couponApplied ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-600 font-medium">✓ {couponCode} — {formatCurrency(couponDiscount)} off</span>
                <button onClick={() => { setCouponApplied(false); setCouponDiscount(0); setCouponCode('') }} className="text-xs text-red-500">Remove</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter code"
                  value={couponCode}
                  onChange={e => { setCouponCode(e.target.value); setCouponError('') }}
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
                <button onClick={handleApplyCoupon} className="px-4 py-2 rounded-lg text-sm font-medium text-white min-h-[44px]" style={{ backgroundColor: '#3B82F6' }}>
                  Apply
                </button>
              </div>
            )}
            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
          </section>

          {/* Gift Card */}
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Gift Card</h2>
            {giftCardApplied ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-600 font-medium">✓ Card ending {giftCardNumber.slice(-4)} — {formatCurrency(giftCardApplyAmount)} applied</span>
                <button onClick={() => { setGiftCardApplied(false); setGiftCardBalance(0); setGiftCardNumber(''); setGiftCardPin('') }} className="text-xs text-red-500">Remove</button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Card number"
                  value={giftCardNumber}
                  onChange={e => { setGiftCardNumber(e.target.value); setGiftCardError('') }}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="PIN (optional)"
                    value={giftCardPin}
                    onChange={e => setGiftCardPin(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  />
                  <button onClick={handleApplyGiftCard} className="px-4 py-2 rounded-lg text-sm font-medium text-white min-h-[44px]" style={{ backgroundColor: '#3B82F6' }}>
                    Apply
                  </button>
                </div>
              </div>
            )}
            {giftCardError && <p className="text-xs text-red-500 mt-1">{giftCardError}</p>}
          </section>

          {/* Order Summary */}
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              {couponDiscount > 0 && <div className="flex justify-between text-green-600"><span>Promo discount</span><span>-{formatCurrency(couponDiscount)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Tax (estimate)</span><span>{formatCurrency(taxEstimate)}</span></div>
              {surchargeAmount > 0 && <div className="flex justify-between"><span className="text-gray-500">{config.surchargeName}</span><span>{formatCurrency(surchargeAmount)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Tip</span><span>{formatCurrency(tipAmount)}</span></div>
              {giftCardApplyAmount > 0 && <div className="flex justify-between text-green-600"><span>Gift card</span><span>-{formatCurrency(giftCardApplyAmount)}</span></div>}
              <div className="flex justify-between pt-2 border-t border-gray-100 font-bold text-base">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
          </section>

          {/* Payment — Datacap iframe (skip if gift card covers total) */}
          {total > 0 && (
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Payment</h2>
              <div id="datacap-iframe" className="min-h-[200px] border border-gray-200 rounded-lg overflow-hidden" />
              <p className="text-xs text-gray-400 mt-2 text-center">🔒 Secure, encrypted payment</p>
            </section>
          )}

          {total === 0 && giftCardApplied && (
            <section className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
              <p className="text-sm text-green-700 font-medium">Gift card covers the full amount — no card payment needed!</p>
            </section>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Fixed bottom: Place Order button */}
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4 z-40">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={handlePlaceOrder}
              disabled={!isFormValid || processing || (total > 0 && !datacapReady)}
              className={`w-full py-3.5 rounded-xl text-white font-semibold text-base transition-all min-h-[50px] ${
                (!isFormValid || processing) ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{ backgroundColor: '#3B82F6' }}
            >
              {processing ? 'Processing...' : `Place Order — ${formatCurrency(total)}`}
            </button>
            {!isFormValid && (
              <p className="text-xs text-gray-400 text-center mt-2">Fill in your name, phone, and email to continue</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

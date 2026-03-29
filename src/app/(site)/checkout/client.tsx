'use client'

/**
 * CheckoutPageClient — Full checkout flow.
 *
 * Sections: order type, customer info, special requests, tip, coupon,
 * gift card, cart summary, payment form, "Place Order" button.
 * On success, redirects to /order-status/[id]?token=xxx.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import {
  useCartItems,
  useCartItemCount,
  useCartSubtotal,
  useSiteCartStore,
} from '@/stores/site-cart-store'
import { CartItemRow } from '@/components/site/CartItemRow'
import { OrderTypeSelector } from '@/components/site/OrderTypeSelector'
import { TipSelector } from '@/components/site/TipSelector'
import { CartSummary } from '@/components/site/CartSummary'
import { PaymentForm } from '@/components/site/PaymentForm'

interface CheckoutPageClientProps {
  bootstrap: SiteBootstrapResponse
  slug: string
}

export function CheckoutPageClient({ bootstrap, slug }: CheckoutPageClientProps) {
  const router = useRouter()
  const items = useCartItems()
  const itemCount = useCartItemCount()
  const subtotal = useCartSubtotal()

  const orderType = useSiteCartStore((s) => s.orderType)
  const tipPercent = useSiteCartStore((s) => s.tipPercent)
  const tipAmount = useSiteCartStore((s) => s.tipAmount)
  const customerInfo = useSiteCartStore((s) => s.customerInfo)
  const specialRequests = useSiteCartStore((s) => s.specialRequests)
  const tableContext = useSiteCartStore((s) => s.tableContext)
  const couponCode = useSiteCartStore((s) => s.couponCode)
  const couponDiscount = useSiteCartStore((s) => s.couponDiscount)
  const giftCardNumber = useSiteCartStore((s) => s.giftCardNumber)
  const giftCardApplied = useSiteCartStore((s) => s.giftCardApplied)
  const clearCart = useSiteCartStore((s) => s.clearCart)

  const deliveryAddress = useSiteCartStore((s) => s.deliveryAddress)
  const deliveryCity = useSiteCartStore((s) => s.deliveryCity)
  const deliveryState = useSiteCartStore((s) => s.deliveryState)
  const deliveryZip = useSiteCartStore((s) => s.deliveryZip)
  const deliveryInstructions = useSiteCartStore((s) => s.deliveryInstructions)
  const deliveryZoneId = useSiteCartStore((s) => s.deliveryZoneId)
  const deliveryFee = useSiteCartStore((s) => s.deliveryFee)

  const setOrderType = useSiteCartStore((s) => s.setOrderType)
  const setTipPercent = useSiteCartStore((s) => s.setTipPercent)
  const setTipAmount = useSiteCartStore((s) => s.setTipAmount)
  const setCustomerInfo = useSiteCartStore((s) => s.setCustomerInfo)
  const setSpecialRequests = useSiteCartStore((s) => s.setSpecialRequests)
  const applyCoupon = useSiteCartStore((s) => s.applyCoupon)
  const removeCoupon = useSiteCartStore((s) => s.removeCoupon)
  const applyGiftCard = useSiteCartStore((s) => s.applyGiftCard)
  const removeGiftCard = useSiteCartStore((s) => s.removeGiftCard)

  const { orderingConfig, capabilities, venue, walletConfig } = bootstrap

  // ── Form validation ──────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [couponInput, setCouponInput] = useState(couponCode ?? '')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [giftCardInput, setGiftCardInput] = useState(giftCardNumber ?? '')
  const [giftCardPinInput, setGiftCardPinInput] = useState('')
  const [giftCardLoading, setGiftCardLoading] = useState(false)
  const [giftCardError, setGiftCardError] = useState<string | null>(null)
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Set default tip on mount
  useEffect(() => {
    if (orderingConfig.defaultTip > 0 && tipPercent === null && tipAmount === 0) {
      setTipPercent(orderingConfig.defaultTip)
      const amt = Math.round(subtotal * (orderingConfig.defaultTip / 100) * 100) / 100
      setTipAmount(amt)
    }
     
  }, [])

  // ── Redirect to menu if cart is empty ────────────────────────
  const isEmpty = mounted && itemCount === 0
  useEffect(() => {
    if (isEmpty) {
      router.replace('/menu')
    }
  }, [isEmpty, router])

  // ── Validate customer info ───────────────────────────────────
  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {}
    if (!customerInfo.name.trim()) errs.name = 'Name is required'
    if (!customerInfo.phone.trim()) errs.phone = 'Phone number is required'
    if (!customerInfo.email.trim()) {
      errs.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email)) {
      errs.email = 'Enter a valid email'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [customerInfo])

  // ── Coupon validation ────────────────────────────────────────
  const handleApplyCoupon = useCallback(async () => {
    const code = couponInput.trim()
    if (!code) return
    setCouponLoading(true)
    setCouponError(null)

    try {
      const res = await fetch('/api/public/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, slug, subtotal }),
      })
      const json = await res.json()

      if (!res.ok || !json.valid) {
        setCouponError(json.reason || 'Invalid coupon code')
        removeCoupon()
      } else {
        applyCoupon(code, json.discount ?? 0)
        setCouponError(null)
      }
    } catch {
      setCouponError('Could not validate coupon. Please try again.')
    } finally {
      setCouponLoading(false)
    }
  }, [couponInput, slug, subtotal, applyCoupon, removeCoupon])

  const handleRemoveCoupon = useCallback(() => {
    removeCoupon()
    setCouponInput('')
    setCouponError(null)
  }, [removeCoupon])

  // ── Gift card balance check ──────────────────────────────────
  const handleCheckGiftCard = useCallback(async () => {
    const number = giftCardInput.trim()
    if (!number) return
    setGiftCardLoading(true)
    setGiftCardError(null)

    try {
      const res = await fetch('/api/public/gift-cards/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, pin: giftCardPinInput || undefined, slug }),
      })
      const json = await res.json()

      if (!res.ok || !json.valid) {
        setGiftCardError(json.reason || 'Invalid gift card')
        removeGiftCard()
        setGiftCardBalance(null)
      } else {
        const balance = json.balance ?? 0
        setGiftCardBalance(balance)
        // Apply min of balance and order total remaining
        const remaining = Math.max(0, subtotal - couponDiscount + tipAmount)
        const applied = Math.min(balance, remaining)
        applyGiftCard(number, applied)
        setGiftCardError(null)
      }
    } catch {
      setGiftCardError('Could not check gift card. Please try again.')
    } finally {
      setGiftCardLoading(false)
    }
  }, [giftCardInput, giftCardPinInput, slug, subtotal, couponDiscount, tipAmount, applyGiftCard, removeGiftCard])

  const handleRemoveGiftCard = useCallback(() => {
    removeGiftCard()
    setGiftCardInput('')
    setGiftCardPinInput('')
    setGiftCardError(null)
    setGiftCardBalance(null)
  }, [removeGiftCard])

  // ── Payment success ──────────────────────────────────────────
  const handlePaymentSuccess = useCallback(
    (orderId: string, _orderNumber: number, token: string) => {
      clearCart()
      router.push(`/order-status/${orderId}?token=${encodeURIComponent(token)}`)
    },
    [clearCart, router]
  )

  const handlePaymentError = useCallback((_message: string) => {
    // Error is already shown in PaymentForm
  }, [])

  // ── Estimated total for wallet payment sheet ─────────────────
  const estimatedTotal = useMemo(() => {
    let surcharge = 0
    if (orderingConfig.surchargeType === 'flat' && orderingConfig.surchargeAmount > 0) {
      surcharge = orderingConfig.surchargeAmount
    } else if (orderingConfig.surchargeType === 'percent' && orderingConfig.surchargeAmount > 0) {
      surcharge = Math.round(subtotal * (orderingConfig.surchargeAmount / 100) * 100) / 100
    }
    const afterDiscount = Math.max(0, subtotal - couponDiscount)
    const fee = orderType === 'delivery' ? deliveryFee : 0
    return afterDiscount + tipAmount + surcharge + fee - giftCardApplied
  }, [subtotal, couponDiscount, tipAmount, giftCardApplied, orderType, deliveryFee, orderingConfig])

  // ── Form validity for enabling payment ───────────────────────
  const isFormValid = useMemo(() => {
    const baseValid =
      customerInfo.name.trim().length > 0 &&
      customerInfo.phone.trim().length > 0 &&
      customerInfo.email.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email)

    if (orderType === 'delivery') {
      return baseValid && deliveryAddress.trim().length > 0 && deliveryZip.trim().length >= 5 && !!deliveryZoneId
    }
    return baseValid
  }, [customerInfo, orderType, deliveryAddress, deliveryZip, deliveryZoneId])

  // Don't render until hydrated (prevents SSR mismatch with Zustand)
  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-24">
        <div
          className="animate-spin h-8 w-8 border-2 rounded-full"
          style={{
            borderColor: 'var(--site-border)',
            borderTopColor: 'var(--site-brand)',
          }}
        />
      </div>
    )
  }

  if (itemCount === 0) return null

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1
        className="text-2xl mb-6"
        style={{
          fontFamily: 'var(--site-heading-font)',
          fontWeight: 'var(--site-heading-weight, 700)',
          color: 'var(--site-text)',
        }}
      >
        Checkout
      </h1>

      <div className="space-y-8">
        {/* ── Section: Order Type ───────────────────────────── */}
        <Section title="Order Type">
          <OrderTypeSelector
            value={orderType}
            onChange={setOrderType}
            venueAddress={venue.address}
            prepTime={orderingConfig.prepTime}
            canPlaceDeliveryOrder={capabilities.canPlaceDeliveryOrder}
            isDineIn={!!tableContext}
            slug={slug}
            subtotal={subtotal}
          />
        </Section>

        {/* ── Section: Your Items ───────────────────────────── */}
        <Section title={`Your Items (${itemCount})`}>
          <div className="divide-y" style={{ borderColor: 'var(--site-border)' }}>
            {items.map((item) => (
              <CartItemRow key={item.id} item={item} />
            ))}
          </div>
          <div className="flex justify-between items-center mt-3 pt-3 border-t" style={{ borderColor: 'var(--site-border)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--site-text-muted)' }}>
              Subtotal
            </span>
            <span className="text-sm font-bold" style={{ color: 'var(--site-text)' }}>
              {formatCurrency(subtotal)}
            </span>
          </div>
          <Link
            href="/our-menu"
            className="inline-block mt-2 text-xs font-medium hover:opacity-70 transition-colors"
            style={{ color: 'var(--site-brand)' }}
          >
            + Add more items
          </Link>
        </Section>

        {/* ── Section: Customer Info ────────────────────────── */}
        <Section title="Your Information">
          <div className="space-y-3">
            <InputField
              label="Name"
              type="text"
              value={customerInfo.name}
              onChange={(v) => setCustomerInfo({ name: v })}
              onBlur={validate}
              error={errors.name}
              placeholder="Your name"
              autoComplete="name"
            />
            <InputField
              label="Phone"
              type="tel"
              value={customerInfo.phone}
              onChange={(v) => setCustomerInfo({ phone: v })}
              onBlur={validate}
              error={errors.phone}
              placeholder="(555) 123-4567"
              autoComplete="tel"
            />
            <InputField
              label="Email"
              type="email"
              value={customerInfo.email}
              onChange={(v) => setCustomerInfo({ email: v })}
              onBlur={validate}
              error={errors.email}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
        </Section>

        {/* ── Section: Special Requests ─────────────────────── */}
        {orderingConfig.allowSpecialRequests && (
          <Section title="Special Requests">
            <textarea
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              placeholder="Allergies, dietary preferences, etc."
              maxLength={500}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors resize-none"
              style={{
                borderColor: 'var(--site-border)',
                backgroundColor: 'var(--site-surface)',
                color: 'var(--site-text)',
              }}
            />
          </Section>
        )}

        {/* ── Section: Tip ──────────────────────────────────── */}
        <Section title="Tip">
          <TipSelector
            subtotal={subtotal}
            tipSuggestions={orderingConfig.tipSuggestions}
            selectedPercent={tipPercent}
            tipAmount={tipAmount}
            onSelectPercent={setTipPercent}
            onSetAmount={setTipAmount}
          />
        </Section>

        {/* ── Section: Coupon ───────────────────────────────── */}
        {capabilities.canUseCoupons && (
          <Section title="Promo Code">
            {couponCode ? (
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl border"
                style={{
                  borderColor: 'var(--site-brand)',
                  backgroundColor: 'rgba(var(--site-brand-rgb), 0.05)',
                }}
              >
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--site-brand)' }}>
                    {couponCode}
                  </span>
                  <span className="text-xs ml-2" style={{ color: 'var(--site-text-muted)' }}>
                    (-{formatCurrency(couponDiscount)})
                  </span>
                </div>
                <button
                  onClick={handleRemoveCoupon}
                  className="text-xs font-medium hover:opacity-70"
                  style={{ color: 'var(--site-text-muted)' }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Enter code"
                  className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none"
                  style={{
                    borderColor: 'var(--site-border)',
                    backgroundColor: 'var(--site-surface)',
                    color: 'var(--site-text)',
                  }}
                />
                <button
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !couponInput.trim()}
                  className="px-5 py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--site-brand)',
                    color: 'var(--site-brand-text)',
                  }}
                >
                  {couponLoading ? 'Checking...' : 'Apply'}
                </button>
              </div>
            )}
            {couponError && (
              <p className="text-xs mt-2" style={{ color: '#dc2626' }}>
                {couponError}
              </p>
            )}
          </Section>
        )}

        {/* ── Section: Gift Card ────────────────────────────── */}
        {capabilities.canUseGiftCards && (
          <Section title="Gift Card">
            {giftCardNumber ? (
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl border"
                style={{
                  borderColor: 'var(--site-brand)',
                  backgroundColor: 'rgba(var(--site-brand-rgb), 0.05)',
                }}
              >
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--site-brand)' }}>
                    Gift Card ****{giftCardNumber.slice(-4)}
                  </span>
                  <span className="text-xs ml-2" style={{ color: 'var(--site-text-muted)' }}>
                    (-{formatCurrency(giftCardApplied)})
                  </span>
                  {giftCardBalance !== null && (
                    <span className="text-xs ml-1" style={{ color: 'var(--site-text-muted)' }}>
                      &middot; Balance: {formatCurrency(giftCardBalance)}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleRemoveGiftCard}
                  className="text-xs font-medium hover:opacity-70"
                  style={{ color: 'var(--site-text-muted)' }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={giftCardInput}
                    onChange={(e) => setGiftCardInput(e.target.value)}
                    placeholder="Card number"
                    className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none"
                    style={{
                      borderColor: 'var(--site-border)',
                      backgroundColor: 'var(--site-surface)',
                      color: 'var(--site-text)',
                    }}
                  />
                  <button
                    onClick={handleCheckGiftCard}
                    disabled={giftCardLoading || !giftCardInput.trim()}
                    className="px-5 py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--site-brand)',
                      color: 'var(--site-brand-text)',
                    }}
                  >
                    {giftCardLoading ? 'Checking...' : 'Apply'}
                  </button>
                </div>
                <input
                  type="text"
                  value={giftCardPinInput}
                  onChange={(e) => setGiftCardPinInput(e.target.value)}
                  placeholder="PIN (optional)"
                  className="w-full px-4 py-3 rounded-xl border text-sm outline-none"
                  style={{
                    borderColor: 'var(--site-border)',
                    backgroundColor: 'var(--site-surface)',
                    color: 'var(--site-text)',
                  }}
                />
              </div>
            )}
            {giftCardError && (
              <p className="text-xs mt-2" style={{ color: '#dc2626' }}>
                {giftCardError}
              </p>
            )}
          </Section>
        )}

        {/* ── Section: Order Summary ────────────────────────── */}
        <Section title="Order Summary">
          <CartSummary
            subtotal={subtotal}
            couponDiscount={couponDiscount}
            giftCardApplied={giftCardApplied}
            taxEstimate={null}
            tipAmount={tipAmount}
            surchargeType={orderingConfig.surchargeType}
            surchargeAmount={orderingConfig.surchargeAmount}
            surchargeName={orderingConfig.surchargeName}
            deliveryFee={orderType === 'delivery' ? deliveryFee : 0}
          />
        </Section>

        {/* ── Section: Payment ──────────────────────────────── */}
        <Section title="Payment">
          <PaymentForm
            slug={slug}
            items={items}
            orderType={orderType}
            customerInfo={customerInfo}
            specialRequests={specialRequests}
            tipAmount={tipAmount}
            couponCode={couponCode}
            giftCardNumber={giftCardNumber}
            giftCardPin={giftCardPinInput}
            tableContext={tableContext}
            deliveryAddress={deliveryAddress}
            deliveryCity={deliveryCity}
            deliveryState={deliveryState}
            deliveryZip={deliveryZip}
            deliveryInstructions={deliveryInstructions}
            deliveryZoneId={deliveryZoneId}
            deliveryFee={deliveryFee}
            onSuccess={handlePaymentSuccess}
            onError={handlePaymentError}
            disabled={!isFormValid}
            merchantName={venue.name}
            applePayMid={walletConfig?.applePayMid}
            googlePayBusinessId={walletConfig?.googlePayBusinessId}
            estimatedTotal={estimatedTotal}
            achEnabled={orderingConfig.achEnabled}
          />
          {!isFormValid && (
            <p className="text-xs mt-2 text-center" style={{ color: 'var(--site-text-muted)' }}>
              {orderType === 'delivery'
                ? 'Fill in your info and delivery address to continue'
                : 'Fill in your name, phone, and email to continue'}
            </p>
          )}
        </Section>
      </div>

      {/* Bottom padding for floating cart bar clearance */}
      <div className="h-8" />
    </div>
  )
}

// ─── Reusable Section ─────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        className="text-base font-bold mb-3"
        style={{
          fontFamily: 'var(--site-heading-font)',
          color: 'var(--site-text)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

// ─── Reusable Input Field ─────────────────────────────────────

function InputField({
  label,
  type,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  autoComplete,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  error?: string
  placeholder?: string
  autoComplete?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--site-text-muted)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors"
        style={{
          borderColor: error ? '#dc2626' : 'var(--site-border)',
          backgroundColor: 'var(--site-surface)',
          color: 'var(--site-text)',
        }}
      />
      {error && (
        <p className="text-xs mt-1" style={{ color: '#dc2626' }}>
          {error}
        </p>
      )}
    </div>
  )
}

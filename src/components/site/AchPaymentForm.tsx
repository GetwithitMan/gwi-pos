'use client'

/**
 * AchPaymentForm — Bank account (ACH) payment form for online checkout.
 *
 * Collects routing number, account number, account type, and account holder name.
 * Includes NACHA-required authorization checkbox.
 *
 * On submit, sends bank details directly to the checkout API (NOT tokenized client-side
 * for initial implementation — the server-side PayAPI call handles the ACH authorize).
 *
 * Security notes:
 *   - Account number is masked in the input field
 *   - Bank details are sent over TLS to our API, then to Datacap PayAPI
 *   - We never store raw bank account numbers — Datacap returns a reusable token
 *   - Routing number is validated client-side (9 digits + ABA checksum)
 */

import { useState, useCallback, useRef } from 'react'
import type { CartItem } from '@/stores/site-cart-store'

// ─── ABA Routing Number Validation ──────────────────────────────────────────

/**
 * Validate an ABA routing number using the official checksum algorithm.
 * The 9-digit number must satisfy: (3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9)) % 10 === 0
 */
function isValidRoutingNumber(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false
  const d = routing.split('').map(Number)
  const checksum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])
  return checksum % 10 === 0
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface AchPaymentFormProps {
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
  venueName: string
  onSuccess: (orderId: string, orderNumber: number, token: string) => void
  onError: (message: string) => void
  disabled?: boolean
}

export function AchPaymentForm({
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
  venueName,
  onSuccess,
  onError,
  disabled,
}: AchPaymentFormProps) {
  const [routingNumber, setRoutingNumber] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState<'Checking' | 'Savings'>('Checking')
  const [accountHolderName, setAccountHolderName] = useState(customerInfo.name || '')
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [routingError, setRoutingError] = useState<string | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const idempotencyKey = useRef(crypto.randomUUID())

  // ── Routing number change handler with validation ──────────────
  const handleRoutingChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 9)
    setRoutingNumber(digits)
    if (digits.length === 9) {
      setRoutingError(isValidRoutingNumber(digits) ? null : 'Invalid routing number')
    } else {
      setRoutingError(null)
    }
  }, [])

  // ── Account number change handler ─────────────────────────────
  const handleAccountChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 24)
    setAccountNumber(digits)
    setAccountError(digits.length > 0 && digits.length < 4 ? 'Account number too short' : null)
  }, [])

  // ── Form validation ───────────────────────────────────────────
  const isFormValid =
    routingNumber.length === 9 &&
    isValidRoutingNumber(routingNumber) &&
    accountNumber.length >= 4 &&
    accountHolderName.trim().length > 0 &&
    authorized &&
    !loading &&
    !disabled

  // ── Submit handler ────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!isFormValid) return
    setLoading(true)
    setError(null)

    // Flatten nested modifier childSelections recursively
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

    // Split name into first/last for Datacap
    const nameParts = accountHolderName.trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || nameParts[0] || ''

    const payload = {
      slug,
      paymentMethod: 'ach' as const,
      achDetails: {
        routingNumber,
        accountNumber,
        accountType,
        accountHolderFirstName: firstName,
        accountHolderLastName: lastName,
      },
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
        setError(json.error || 'ACH payment failed. Please check your bank details.')
        setLoading(false)
        idempotencyKey.current = crypto.randomUUID()
        return
      }

      onSuccess(json.data.orderId, json.data.orderNumber, json.data.statusToken)
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
      idempotencyKey.current = crypto.randomUUID()
    }
  }, [
    isFormValid, slug, routingNumber, accountNumber, accountType, accountHolderName,
    items, orderType, customerInfo, specialRequests, tipAmount, couponCode,
    giftCardNumber, giftCardPin, tableContext, deliveryAddress, deliveryCity,
    deliveryState, deliveryZip, deliveryInstructions, deliveryZoneId, deliveryFee, onSuccess,
  ])

  // ── Masked account display ────────────────────────────────────
  const maskedAccount = accountNumber.length > 4
    ? '\u2022'.repeat(accountNumber.length - 4) + accountNumber.slice(-4)
    : accountNumber

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })

  return (
    <div className="space-y-4">
      {/* Routing Number */}
      <div>
        <label
          htmlFor="ach-routing"
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--site-text)' }}
        >
          Routing Number
        </label>
        <input
          id="ach-routing"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="9-digit routing number"
          value={routingNumber}
          onChange={(e) => handleRoutingChange(e.target.value)}
          maxLength={9}
          className="w-full px-4 py-3 rounded-xl text-base outline-none transition-colors"
          style={{
            backgroundColor: 'var(--site-surface)',
            border: `1px solid ${routingError ? '#dc2626' : 'var(--site-border)'}`,
            color: 'var(--site-text)',
          }}
        />
        {routingError && (
          <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{routingError}</p>
        )}
      </div>

      {/* Account Number */}
      <div>
        <label
          htmlFor="ach-account"
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--site-text)' }}
        >
          Account Number
        </label>
        <input
          id="ach-account"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Bank account number"
          value={accountNumber}
          onChange={(e) => handleAccountChange(e.target.value)}
          maxLength={24}
          className="w-full px-4 py-3 rounded-xl text-base outline-none transition-colors"
          style={{
            backgroundColor: 'var(--site-surface)',
            border: `1px solid ${accountError ? '#dc2626' : 'var(--site-border)'}`,
            color: 'var(--site-text)',
          }}
        />
        {accountError && (
          <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{accountError}</p>
        )}
      </div>

      {/* Account Type Toggle */}
      <div>
        <label
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--site-text)' }}
        >
          Account Type
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAccountType('Checking')}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all"
            style={{
              backgroundColor: accountType === 'Checking' ? 'var(--site-brand)' : 'var(--site-surface)',
              color: accountType === 'Checking' ? 'var(--site-brand-text)' : 'var(--site-text)',
              border: `1px solid ${accountType === 'Checking' ? 'var(--site-brand)' : 'var(--site-border)'}`,
            }}
          >
            Checking
          </button>
          <button
            type="button"
            onClick={() => setAccountType('Savings')}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all"
            style={{
              backgroundColor: accountType === 'Savings' ? 'var(--site-brand)' : 'var(--site-surface)',
              color: accountType === 'Savings' ? 'var(--site-brand-text)' : 'var(--site-text)',
              border: `1px solid ${accountType === 'Savings' ? 'var(--site-brand)' : 'var(--site-border)'}`,
            }}
          >
            Savings
          </button>
        </div>
      </div>

      {/* Account Holder Name */}
      <div>
        <label
          htmlFor="ach-name"
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--site-text)' }}
        >
          Account Holder Name
        </label>
        <input
          id="ach-name"
          type="text"
          autoComplete="name"
          placeholder="Name on bank account"
          value={accountHolderName}
          onChange={(e) => setAccountHolderName(e.target.value)}
          maxLength={100}
          className="w-full px-4 py-3 rounded-xl text-base outline-none transition-colors"
          style={{
            backgroundColor: 'var(--site-surface)',
            border: '1px solid var(--site-border)',
            color: 'var(--site-text)',
          }}
        />
      </div>

      {/* NACHA Authorization Checkbox */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--site-surface)',
          border: '1px solid var(--site-border)',
        }}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded accent-current flex-shrink-0"
            style={{ accentColor: 'var(--site-brand)' }}
          />
          <span className="text-xs leading-relaxed" style={{ color: 'var(--site-text-muted)' }}>
            By checking this box and clicking &quot;Place Order&quot; below I authorize{' '}
            <strong style={{ color: 'var(--site-text)' }}>{venueName}</strong>{' '}
            to debit the bank account indicated on this form for the noted amount on{' '}
            <strong style={{ color: 'var(--site-text)' }}>{today}</strong>.
            I understand that because this is an ACH transaction, these funds may be
            withdrawn as soon as {today}. I understand that in the event this ACH
            transaction is returned by my financial institution, I may be subject to a
            returned item fee.
          </span>
        </label>
      </div>

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
        disabled={!isFormValid}
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
            Processing ACH Payment...
          </span>
        ) : (
          'Place Order'
        )}
      </button>

      {/* Settlement timing note */}
      <p className="text-xs text-center" style={{ color: 'var(--site-text-muted)' }}>
        ACH payments typically settle within 2-3 business days.
      </p>

      {/* Security note */}
      <div className="flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--site-text-muted)' }}>
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <span>Secure, encrypted bank transfer</span>
      </div>
    </div>
  )
}

'use client'

/**
 * GiftCardPurchaseClient — Virtual gift card purchase flow.
 *
 * Two modes:
 *   A. Datacap Virtual Gift (iframe-embedded storefront) — when datacapVirtualGift prop provided
 *   B. PayAPI 4-step form (original) — fallback when Datacap iframe not configured
 *
 * Mode A renders an iframe with postMessage listeners for:
 *   - widget_ready: hide loading spinner
 *   - height_change: auto-resize iframe
 *   - payment_success: show transitional message
 *   - payment_error: show error with retry
 *
 * Mode B steps:
 *   1. Choose amount ($25, $50, $100, or custom)
 *   2. Recipient info (name, email, message)
 *   3. Your info (purchaser name, email)
 *   4. Payment via Datacap hosted token iframe
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { PublicDatacapVirtualGiftSettings } from '@/lib/settings/types'

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

interface GiftCardPurchaseClientProps {
  bootstrap: SiteBootstrapResponse
  slug: string
  datacapVirtualGift?: PublicDatacapVirtualGiftSettings | null
}

// Allowed Datacap origins for postMessage validation
const DATACAP_ORIGINS = new Set([
  'https://paylink.dcap.com',
  'https://paylink-cert.dcap.com',
])

const PRESET_AMOUNTS = [25, 50, 100]
const MIN_AMOUNT = 5
const MAX_AMOUNT = 500

// ─── Datacap Virtual Gift Iframe Mode ─────────────────────────────────────────

function DatacapVirtualGiftWidget({ embeddedUrl, publicLinkUrl }: { embeddedUrl: string; publicLinkUrl: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeLoading, setIframeLoading] = useState(true)
  const [iframeHeight, setIframeHeight] = useState(600)
  const [iframeError, setIframeError] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [paymentErrorMsg, setPaymentErrorMsg] = useState('')
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // PostMessage listener
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Validate origin — only accept messages from Datacap domains
      if (!DATACAP_ORIGINS.has(event.origin)) return

      const data = event.data
      if (!data || typeof data !== 'object') return

      const type = data.type || data.event

      switch (type) {
        case 'widget_ready':
          setIframeLoading(false)
          if (loadTimeout.current) {
            clearTimeout(loadTimeout.current)
            loadTimeout.current = null
          }
          break

        case 'height_change':
          if (typeof data.height === 'number' && data.height > 200) {
            setIframeHeight(data.height)
          }
          break

        case 'payment_success':
          setPaymentStatus('success')
          break

        case 'payment_error':
          setPaymentStatus('error')
          setPaymentErrorMsg(
            typeof data.message === 'string' ? data.message : 'Payment failed. Please try again.'
          )
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Fallback timeout — if iframe doesn't send widget_ready in 15s, show fallback
  useEffect(() => {
    loadTimeout.current = setTimeout(() => {
      if (iframeLoading) {
        setIframeError(true)
        setIframeLoading(false)
      }
    }, 15_000)

    return () => {
      if (loadTimeout.current) clearTimeout(loadTimeout.current)
    }
  }, [iframeLoading])

  // Payment success transitional message
  if (paymentStatus === 'success') {
    return (
      <div className="py-12 md:py-20 px-4">
        <div className="max-w-md mx-auto text-center">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--site-brand) 15%, transparent)' }}
          >
            <svg className="w-8 h-8" style={{ color: 'var(--site-brand)' }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2
            className="text-2xl md:text-3xl mb-3"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Payment Received
          </h2>
          <p className="mb-6" style={{ color: 'var(--site-text-muted)' }}>
            Preparing your gift card... You will receive a confirmation shortly.
          </p>
          <a
            href="/"
            className="inline-block py-3 px-8 rounded-xl font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-brand-text)',
            }}
          >
            Back to Home
          </a>
        </div>
      </div>
    )
  }

  // Payment error with retry
  if (paymentStatus === 'error') {
    return (
      <div className="py-12 md:py-20 px-4">
        <div className="max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center bg-red-50">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h2
            className="text-2xl md:text-3xl mb-3"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Payment Error
          </h2>
          <p className="mb-6" style={{ color: 'var(--site-text-muted)' }}>
            {paymentErrorMsg}
          </p>
          <button
            onClick={() => {
              setPaymentStatus('idle')
              setPaymentErrorMsg('')
            }}
            className="inline-block py-3 px-8 rounded-xl font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-brand-text)',
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // iframe load error — show fallback link
  if (iframeError) {
    return (
      <div className="py-8 md:py-14 px-4">
        <div className="max-w-lg mx-auto text-center">
          <h1
            className="text-2xl md:text-3xl mb-2"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Purchase a Gift Card
          </h1>
          <p className="mb-6" style={{ color: 'var(--site-text-muted)' }}>
            The gift card form could not be loaded inline. Click below to continue on the Datacap secure page.
          </p>
          <a
            href={publicLinkUrl || embeddedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block py-3 px-8 rounded-xl font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-brand-text)',
            }}
          >
            Open Gift Card Store
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="py-8 md:py-14 px-4">
      <div className="max-w-2xl mx-auto">
        <h1
          className="text-2xl md:text-3xl mb-2 text-center"
          style={{
            fontFamily: 'var(--site-heading-font)',
            fontWeight: 'var(--site-heading-weight, 700)',
          }}
        >
          Purchase a Gift Card
        </h1>
        <p className="text-center mb-6" style={{ color: 'var(--site-text-muted)' }}>
          Choose an amount and send a virtual gift card
        </p>

        {/* Loading spinner */}
        {iframeLoading && (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-8 w-8" style={{ color: 'var(--site-brand)' }} viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-3 text-sm" style={{ color: 'var(--site-text-muted)' }}>
              Loading gift card store...
            </span>
          </div>
        )}

        {/* Datacap embedded iframe */}
        <div
          className="rounded-xl overflow-hidden transition-opacity"
          style={{
            border: '1px solid var(--site-border)',
            opacity: iframeLoading ? 0 : 1,
          }}
        >
          <iframe
            ref={iframeRef}
            src={embeddedUrl}
            title="Gift Card Store"
            className="w-full border-0"
            style={{ height: `${iframeHeight}px`, minHeight: '400px' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
            onLoad={() => {
              // If widget_ready postMessage hasn't fired yet, give it a moment
              // The 15s fallback timeout will catch true failures
            }}
          />
        </div>

        {/* Security note */}
        <div className="flex items-center justify-center gap-1.5 text-xs mt-4" style={{ color: 'var(--site-text-muted)' }}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <span>Secure payment powered by Datacap</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GiftCardPurchaseClient({ bootstrap, slug, datacapVirtualGift }: GiftCardPurchaseClientProps) {
  // ── Datacap Virtual Gift iframe mode ─────────────────────────────
  const useDatacapWidget = datacapVirtualGift?.enabled && datacapVirtualGift?.embeddedUrl

  // If Datacap Virtual Gift is enabled with an embedded URL, render the iframe widget
  if (useDatacapWidget) {
    return (
      <DatacapVirtualGiftWidget
        embeddedUrl={datacapVirtualGift.embeddedUrl!}
        publicLinkUrl={datacapVirtualGift.publicLinkUrl}
      />
    )
  }

  // ── Original PayAPI 4-step form (Mode B) ─────────────────────────
  return <PayApiGiftCardForm bootstrap={bootstrap} slug={slug} />
}

// ─── PayAPI Form (extracted from original component) ──────────────────────────

function PayApiGiftCardForm({ bootstrap, slug }: { bootstrap: SiteBootstrapResponse; slug: string }) {
  // ── Form State ─────────────────────────────────────────────────
  const [amount, setAmount] = useState<number>(50)
  const [customAmount, setCustomAmount] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [message, setMessage] = useState('')
  const [purchaserName, setPurchaserName] = useState('')
  const [purchaserEmail, setPurchaserEmail] = useState('')

  // ── UI State ───────────────────────────────────────────────────
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [datacapReady, setDatacapReady] = useState(false)
  const datacapInitialized = useRef(false)
  const idempotencyKey = useRef(crypto.randomUUID())

  // ── Success State ──────────────────────────────────────────────
  const [success, setSuccess] = useState(false)
  const [resultCardLast4, setResultCardLast4] = useState('')

  // ── Validation ─────────────────────────────────────────────────
  const effectiveAmount = isCustom ? parseFloat(customAmount) || 0 : amount

  const isStep1Valid = effectiveAmount >= MIN_AMOUNT && effectiveAmount <= MAX_AMOUNT
  const isStep2Valid = recipientName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)
  const isStep3Valid = purchaserName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaserEmail)

  // ── Datacap Token Callback ─────────────────────────────────────
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
        const res = await fetch('/api/public/gift-cards/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            amount: effectiveAmount,
            recipientName: recipientName.trim(),
            recipientEmail: recipientEmail.trim(),
            message: message.trim() || undefined,
            purchaserName: purchaserName.trim(),
            purchaserEmail: purchaserEmail.trim(),
            token: resp.Token,
            cardBrand: resp.Brand ?? undefined,
            cardLast4: resp.Last4 ?? undefined,
            idempotencyKey: idempotencyKey.current,
          }),
        })

        const json = await res.json()

        if (!res.ok) {
          setError(json.error || 'Payment failed. Please try a different card.')
          setLoading(false)
          idempotencyKey.current = crypto.randomUUID()
          return
        }

        setResultCardLast4(json.cardNumberLast4 || '****')
        setSuccess(true)
        setLoading(false)
      } catch {
        setError('Network error. Please check your connection and try again.')
        setLoading(false)
        idempotencyKey.current = crypto.randomUUID()
      }
    },
    [slug, effectiveAmount, recipientName, recipientEmail, message, purchaserName, purchaserEmail]
  )

  // ── Initialize Datacap ─────────────────────────────────────────
  const initDatacap = useCallback(() => {
    const tokenKey = process.env.NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY ?? ''
    if (!tokenKey) {
      setError('Payment system not configured. Please contact the venue.')
      return
    }
    try {
      DatacapHostedWebToken.init(tokenKey, 'datacap-gc-token-iframe', handleDatacapToken)
      datacapInitialized.current = true
      setDatacapReady(true)
    } catch (err) {
      console.error('Datacap init error:', err)
      setError('Failed to initialize payment form. Please refresh.')
    }
  }, [handleDatacapToken])

  // ── Load Datacap CDN Script (on step 4) ────────────────────────
  useEffect(() => {
    if (step !== 4 || datacapInitialized.current) return

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
  }, [step, initDatacap])

  // ── Submit Payment ─────────────────────────────────────────────
  const handlePayment = useCallback(() => {
    if (!datacapReady || loading) return
    setLoading(true)
    setError(null)
    try {
      DatacapHostedWebToken.requestToken()
    } catch {
      setError('Payment form error. Please refresh and try again.')
      setLoading(false)
    }
  }, [datacapReady, loading])

  // ── Success Screen ─────────────────────────────────────────────
  if (success) {
    return (
      <div className="py-12 md:py-20 px-4">
        <div className="max-w-md mx-auto text-center">
          {/* Check icon */}
          <div
            className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--site-brand) 15%, transparent)' }}
          >
            <svg className="w-8 h-8" style={{ color: 'var(--site-brand)' }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>

          <h1
            className="text-2xl md:text-3xl mb-3"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Gift Card Sent!
          </h1>

          <p className="mb-6" style={{ color: 'var(--site-text-muted)' }}>
            A {formatCurrency(effectiveAmount)} gift card has been sent to{' '}
            <strong style={{ color: 'var(--site-text)' }}>{recipientEmail}</strong>
          </p>

          <div
            className="rounded-xl p-5 mb-6 text-left space-y-2"
            style={{
              backgroundColor: 'var(--site-surface)',
              border: '1px solid var(--site-border)',
            }}
          >
            <div className="flex justify-between">
              <span style={{ color: 'var(--site-text-muted)' }}>Amount</span>
              <span className="font-semibold">{formatCurrency(effectiveAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--site-text-muted)' }}>Card Number</span>
              <span className="font-mono">****-****-{resultCardLast4}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--site-text-muted)' }}>Recipient</span>
              <span>{recipientName}</span>
            </div>
          </div>

          <a
            href="/"
            className="inline-block py-3 px-8 rounded-xl font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-brand-text)',
            }}
          >
            Back to Home
          </a>
        </div>
      </div>
    )
  }

  // ── Main Form ──────────────────────────────────────────────────
  return (
    <div className="py-8 md:py-14 px-4">
      <div className="max-w-lg mx-auto">
        <h1
          className="text-2xl md:text-3xl mb-2 text-center"
          style={{
            fontFamily: 'var(--site-heading-font)',
            fontWeight: 'var(--site-heading-weight, 700)',
          }}
        >
          Send a Gift Card
        </h1>
        <p className="text-center mb-8" style={{ color: 'var(--site-text-muted)' }}>
          Send a virtual gift card to someone special
        </p>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <button
              key={s}
              onClick={() => {
                if (s < step) setStep(s)
              }}
              disabled={s > step}
              className="flex items-center gap-1.5"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: s <= step ? 'var(--site-brand)' : 'var(--site-surface)',
                  color: s <= step ? 'var(--site-brand-text)' : 'var(--site-text-muted)',
                  border: s > step ? '1px solid var(--site-border)' : 'none',
                }}
              >
                {s < step ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  s
                )}
              </div>
              {s < 4 && (
                <div
                  className="w-8 h-0.5 rounded"
                  style={{
                    backgroundColor: s < step ? 'var(--site-brand)' : 'var(--site-border)',
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Error display */}
        {error && (
          <div
            className="px-4 py-3 rounded-lg text-sm mb-6"
            style={{
              backgroundColor: 'rgba(220, 38, 38, 0.08)',
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}

        {/* ── Step 1: Choose Amount ──────────────────────────────── */}
        {step === 1 && (
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: 'var(--site-surface)',
              border: '1px solid var(--site-border)',
            }}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ fontFamily: 'var(--site-heading-font)' }}
            >
              Choose Amount
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {PRESET_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setAmount(preset)
                    setIsCustom(false)
                    setError(null)
                  }}
                  className="py-3 rounded-xl text-base font-semibold transition-all"
                  style={{
                    backgroundColor:
                      !isCustom && amount === preset
                        ? 'var(--site-brand)'
                        : 'var(--site-bg)',
                    color:
                      !isCustom && amount === preset
                        ? 'var(--site-brand-text)'
                        : 'var(--site-text)',
                    border: '1px solid var(--site-border)',
                  }}
                >
                  ${preset}
                </button>
              ))}
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--site-text-muted)' }}>
                Custom Amount
              </label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-base"
                  style={{ color: 'var(--site-text-muted)' }}
                >
                  $
                </span>
                <input
                  type="number"
                  min={MIN_AMOUNT}
                  max={MAX_AMOUNT}
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value)
                    setIsCustom(true)
                    setError(null)
                  }}
                  onFocus={() => setIsCustom(true)}
                  placeholder={`${MIN_AMOUNT} – ${MAX_AMOUNT}`}
                  className="w-full pl-7 pr-4 py-3 rounded-xl text-base outline-none transition-all"
                  style={{
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    border: isCustom ? '2px solid var(--site-brand)' : '1px solid var(--site-border)',
                  }}
                />
              </div>
              {isCustom && customAmount && (parseFloat(customAmount) < MIN_AMOUNT || parseFloat(customAmount) > MAX_AMOUNT) && (
                <p className="text-xs mt-1" style={{ color: '#dc2626' }}>
                  Amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT}
                </p>
              )}
            </div>

            <button
              onClick={() => { setStep(2); setError(null) }}
              disabled={!isStep1Valid}
              className="w-full mt-6 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: 'var(--site-brand)',
                color: 'var(--site-brand-text)',
              }}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step 2: Recipient Info ─────────────────────────────── */}
        {step === 2 && (
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: 'var(--site-surface)',
              border: '1px solid var(--site-border)',
            }}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ fontFamily: 'var(--site-heading-font)' }}
            >
              Recipient Info
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--site-text-muted)' }}>
                  Recipient Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Their name"
                  className="w-full px-4 py-3 rounded-xl text-base outline-none"
                  style={{
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    border: '1px solid var(--site-border)',
                  }}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--site-text-muted)' }}>
                  Recipient Email <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="their@email.com"
                  className="w-full px-4 py-3 rounded-xl text-base outline-none"
                  style={{
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    border: '1px solid var(--site-border)',
                  }}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--site-text-muted)' }}>
                  Personal Message <span style={{ color: 'var(--site-text-muted)' }}>(optional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => {
                    if (e.target.value.length <= 200) setMessage(e.target.value)
                  }}
                  placeholder="Add a personal message..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl text-base outline-none resize-none"
                  style={{
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    border: '1px solid var(--site-border)',
                  }}
                />
                <p className="text-xs text-right mt-1" style={{ color: 'var(--site-text-muted)' }}>
                  {message.length}/200
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 rounded-xl font-semibold transition-all"
                style={{
                  backgroundColor: 'var(--site-bg)',
                  color: 'var(--site-text)',
                  border: '1px solid var(--site-border)',
                }}
              >
                Back
              </button>
              <button
                onClick={() => { setStep(3); setError(null) }}
                disabled={!isStep2Valid}
                className="flex-1 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--site-brand)',
                  color: 'var(--site-brand-text)',
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Your Info ──────────────────────────────────── */}
        {step === 3 && (
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: 'var(--site-surface)',
              border: '1px solid var(--site-border)',
            }}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ fontFamily: 'var(--site-heading-font)' }}
            >
              Your Info
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--site-text-muted)' }}>
                  Your Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={purchaserName}
                  onChange={(e) => setPurchaserName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-3 rounded-xl text-base outline-none"
                  style={{
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    border: '1px solid var(--site-border)',
                  }}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block" style={{ color: 'var(--site-text-muted)' }}>
                  Your Email <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="email"
                  value={purchaserEmail}
                  onChange={(e) => setPurchaserEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 rounded-xl text-base outline-none"
                  style={{
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    border: '1px solid var(--site-border)',
                  }}
                />
              </div>
            </div>

            {/* Summary */}
            <div
              className="rounded-lg p-4 mt-5 space-y-1.5 text-sm"
              style={{
                backgroundColor: 'var(--site-bg)',
                border: '1px solid var(--site-border)',
              }}
            >
              <div className="flex justify-between">
                <span style={{ color: 'var(--site-text-muted)' }}>Gift Card Amount</span>
                <span className="font-semibold">{formatCurrency(effectiveAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--site-text-muted)' }}>To</span>
                <span>{recipientName} ({recipientEmail})</span>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 rounded-xl font-semibold transition-all"
                style={{
                  backgroundColor: 'var(--site-bg)',
                  color: 'var(--site-text)',
                  border: '1px solid var(--site-border)',
                }}
              >
                Back
              </button>
              <button
                onClick={() => { setStep(4); setError(null) }}
                disabled={!isStep3Valid}
                className="flex-1 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--site-brand)',
                  color: 'var(--site-brand-text)',
                }}
              >
                Continue to Payment
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Payment ────────────────────────────────────── */}
        {step === 4 && (
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: 'var(--site-surface)',
              border: '1px solid var(--site-border)',
            }}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ fontFamily: 'var(--site-heading-font)' }}
            >
              Payment — {formatCurrency(effectiveAmount)}
            </h2>

            {/* Order summary */}
            <div
              className="rounded-lg p-4 mb-5 space-y-1.5 text-sm"
              style={{
                backgroundColor: 'var(--site-bg)',
                border: '1px solid var(--site-border)',
              }}
            >
              <div className="flex justify-between">
                <span style={{ color: 'var(--site-text-muted)' }}>Gift card for</span>
                <span>{recipientName}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--site-text-muted)' }}>Email</span>
                <span>{recipientEmail}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1.5" style={{ borderTop: '1px solid var(--site-border)' }}>
                <span>Total</span>
                <span>{formatCurrency(effectiveAmount)}</span>
              </div>
            </div>

            {/* Datacap hosted iframe for card entry */}
            <div
              className="rounded-xl border overflow-hidden mb-4"
              style={{
                borderColor: 'var(--site-border)',
                backgroundColor: 'var(--site-bg)',
                minHeight: '140px',
              }}
            >
              <iframe
                id="datacap-gc-token-iframe"
                title="Card Entry"
                className="w-full border-0"
                style={{ height: '140px' }}
              />
            </div>

            {!datacapReady && !error && (
              <p className="text-xs text-center mb-4" style={{ color: 'var(--site-text-muted)' }}>
                Loading secure payment form...
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(3)}
                disabled={loading}
                className="flex-1 py-3 rounded-xl font-semibold transition-all"
                style={{
                  backgroundColor: 'var(--site-bg)',
                  color: 'var(--site-text)',
                  border: '1px solid var(--site-border)',
                }}
              >
                Back
              </button>
              <button
                onClick={handlePayment}
                disabled={!datacapReady || loading}
                className="flex-[2] py-3 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                  `Pay ${formatCurrency(effectiveAmount)}`
                )}
              </button>
            </div>

            {/* Security note */}
            <div className="flex items-center justify-center gap-1.5 text-xs mt-4" style={{ color: 'var(--site-text-muted)' }}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <span>Secure, encrypted payment</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

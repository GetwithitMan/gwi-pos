'use client'

/**
 * WalletPayButton — Datacap Apple Pay & Google Pay wallet integration.
 *
 * Loads Datacap's Wallet client scripts (DatacapApplePay / DatacapGooglePay),
 * renders branded wallet buttons, and returns a Datacap token on authorization.
 *
 * The token format is identical to the Hosted Web Token iframe — a DC4: prefixed
 * string that can be sent directly to PayAPI /credit/sale.
 *
 * Flow per Datacap docs:
 *   1. Load wallet script from wallet[-cert].dcap.com
 *   2. DatacapApplePay.init(callback, tokenKey, merchantName, applePayMid, amount)
 *      DatacapGooglePay.init(callback, tokenKey, merchantName, googlePayBusinessId, amount)
 *   3. Wallet client renders the branded button inside a target div
 *   4. User taps button → native payment sheet → wallet returns token via callback
 *   5. Callback receives { Token, Brand, Last4, Customer, Error }
 *   6. Parent component submits token to /api/online/checkout with walletType
 */

import { useEffect, useRef, useState } from 'react'

// ─── Datacap Wallet Globals (loaded via CDN scripts) ─────────────────────────

declare const DatacapApplePay: {
  init: (
    callback: (resp: WalletTokenResponse) => Promise<string>,
    tokenKey: string,
    merchantName: string,
    applePayMid: string,
    amount: string,
  ) => void
}

declare const DatacapGooglePay: {
  init: (
    callback: (resp: WalletTokenResponse) => Promise<string>,
    tokenKey: string,
    merchantName: string,
    googlePayBusinessId: string,
    amount: string,
  ) => void
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WalletTokenResponse {
  Token?: string
  Brand?: string
  Last4?: string
  ExpirationMonth?: string
  ExpirationYear?: string
  Error?: string
  Customer?: {
    Address?: string[]
    City?: string
    Email?: string
    FirstName?: string
    LastName?: string
    Phone?: string
    State?: string
    Zip?: string
  }
}

export type WalletType = 'apple_pay' | 'google_pay'

interface WalletPayButtonProps {
  /** Total amount to display on the wallet payment sheet (e.g. "15.99") */
  amount: string
  /** Merchant display name shown on the payment sheet */
  merchantName: string
  /** Datacap token key (NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY) */
  tokenKey: string
  /** Apple Pay Merchant ID — if falsy, Apple Pay button is hidden */
  applePayMid?: string | null
  /** Google Pay Business ID — if falsy, Google Pay button is hidden */
  googlePayBusinessId?: string | null
  /** 'cert' or 'production' — determines which Datacap wallet endpoint to use */
  env?: string
  /** Called when wallet authorization succeeds */
  onToken: (token: string, walletType: WalletType, brand: string | null, last4: string | null) => Promise<void>
  /** Called on wallet error or cancellation */
  onError?: (message: string) => void
  /** Disable buttons (e.g. while form is incomplete) */
  disabled?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WalletPayButton({
  amount,
  merchantName,
  tokenKey,
  applePayMid,
  googlePayBusinessId,
  env = 'cert',
  onToken,
  onError,
  disabled,
}: WalletPayButtonProps) {
  const [applePayAvailable, setApplePayAvailable] = useState(false)
  const [googlePayAvailable, setGooglePayAvailable] = useState(false)
  const [applePayLoaded, setApplePayLoaded] = useState(false)
  const [googlePayLoaded, setGooglePayLoaded] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Keep amount in a ref so the callback closure always sees the latest value
  const amountRef = useRef(amount)
  amountRef.current = amount

  const applePayInitialized = useRef(false)
  const googlePayInitialized = useRef(false)

  // ── Apple Pay Detection ──────────────────────────────────────────────────

  useEffect(() => {
    if (!applePayMid) return
    // Apple Pay is only available in Safari on iOS/macOS
    try {
      if (
        typeof window !== 'undefined' &&
        (window as any).ApplePaySession &&
        (window as any).ApplePaySession.canMakePayments()
      ) {
        setApplePayAvailable(true)
      }
    } catch {
      // Not available
    }
  }, [applePayMid])

  // ── Google Pay Detection ─────────────────────────────────────────────────

  useEffect(() => {
    if (!googlePayBusinessId) return
    // Google Pay is broadly available in modern browsers
    // The Datacap Google Pay library handles the isReadyToPay check internally
    // and only renders the button if the user has Google Pay set up.
    // We mark it available and let the Datacap lib handle visibility.
    setGooglePayAvailable(true)
  }, [googlePayBusinessId])

  // ── Load Apple Pay Wallet Script ─────────────────────────────────────────

  useEffect(() => {
    if (!applePayAvailable || !applePayMid || applePayInitialized.current) return

    const walletHost = env === 'production' ? 'wallet.dcap.com' : 'wallet-cert.dcap.com'
    const scriptSrc = `https://${walletHost}/v1/client/applepay`

    const existing = document.querySelector(`script[src="${scriptSrc}"]`)
    if (existing) {
      setApplePayLoaded(true)
      return
    }

    const script = document.createElement('script')
    script.src = scriptSrc
    script.async = true
    script.onload = () => setApplePayLoaded(true)
    script.onerror = () => {
      console.error('[WalletPayButton] Failed to load Apple Pay script')
    }
    document.head.appendChild(script)
  }, [applePayAvailable, applePayMid, env])

  // ── Load Google Pay Wallet Scripts ───────────────────────────────────────

  useEffect(() => {
    if (!googlePayAvailable || !googlePayBusinessId || googlePayInitialized.current) return

    const walletHost = env === 'production' ? 'wallet.dcap.com' : 'wallet-cert.dcap.com'

    // Google Pay requires two scripts: the Datacap wrapper and Google's pay.js
    const scripts = [
      `https://pay.google.com/gp/p/js/pay.js`,
      `https://${walletHost}/v1/client/googlepay`,
    ]

    let loadedCount = 0
    const onScriptLoad = () => {
      loadedCount++
      if (loadedCount >= scripts.length) {
        setGooglePayLoaded(true)
      }
    }

    for (const src of scripts) {
      const existing = document.querySelector(`script[src="${src}"]`)
      if (existing) {
        onScriptLoad()
        continue
      }
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = onScriptLoad
      script.onerror = () => {
        console.error(`[WalletPayButton] Failed to load script: ${src}`)
      }
      document.head.appendChild(script)
    }
  }, [googlePayAvailable, googlePayBusinessId, env])

  // ── Initialize Apple Pay ─────────────────────────────────────────────────

  useEffect(() => {
    if (!applePayLoaded || !applePayMid || !tokenKey || applePayInitialized.current) return
    if (typeof DatacapApplePay === 'undefined') return

    try {
      const callback = (resp: WalletTokenResponse): Promise<string> => {
        return new Promise((resolve, reject) => {
          if (resp.Error) {
            setError(resp.Error)
            setProcessing(false)
            onErrorRef.current?.(resp.Error)
            reject(resp.Error)
            return
          }

          if (!resp.Token) {
            const msg = 'No payment token received from Apple Pay'
            setError(msg)
            setProcessing(false)
            onErrorRef.current?.(msg)
            reject(msg)
            return
          }

          setProcessing(true)
          setError(null)
          onTokenRef.current(
            resp.Token,
            'apple_pay',
            resp.Brand ?? null,
            resp.Last4 ?? null,
          )
            .then(() => {
              resolve('Approved')
            })
            .catch((err) => {
              const msg = err instanceof Error ? err.message : 'Payment failed'
              setError(msg)
              reject(msg)
            })
            .finally(() => setProcessing(false))
        })
      }

      DatacapApplePay.init(callback, tokenKey, merchantName, applePayMid, amount)
      applePayInitialized.current = true
    } catch (err) {
      console.error('[WalletPayButton] Apple Pay init error:', err)
    }
  }, [applePayLoaded, applePayMid, tokenKey, merchantName, amount])

  // ── Initialize Google Pay ────────────────────────────────────────────────

  useEffect(() => {
    if (!googlePayLoaded || !googlePayBusinessId || !tokenKey || googlePayInitialized.current) return
    if (typeof DatacapGooglePay === 'undefined') return

    try {
      const callback = (resp: WalletTokenResponse): Promise<string> => {
        return new Promise((resolve, reject) => {
          if (resp.Error) {
            setError(resp.Error)
            setProcessing(false)
            onErrorRef.current?.(resp.Error)
            reject(resp.Error)
            return
          }

          if (!resp.Token) {
            const msg = 'No payment token received from Google Pay'
            setError(msg)
            setProcessing(false)
            onErrorRef.current?.(msg)
            reject(msg)
            return
          }

          setProcessing(true)
          setError(null)
          onTokenRef.current(
            resp.Token,
            'google_pay',
            resp.Brand ?? null,
            resp.Last4 ?? null,
          )
            .then(() => {
              resolve('Approved')
            })
            .catch((err) => {
              const msg = err instanceof Error ? err.message : 'Payment failed'
              setError(msg)
              reject(msg)
            })
            .finally(() => setProcessing(false))
        })
      }

      DatacapGooglePay.init(callback, tokenKey, merchantName, googlePayBusinessId, amount)
      googlePayInitialized.current = true
    } catch (err) {
      console.error('[WalletPayButton] Google Pay init error:', err)
    }
  }, [googlePayLoaded, googlePayBusinessId, tokenKey, merchantName, amount])

  // ── Nothing to render if no wallets available ────────────────────────────

  if (!applePayMid && !googlePayBusinessId) return null
  if (!applePayAvailable && !googlePayAvailable) return null

  return (
    <div className="space-y-3">
      {/* Apple Pay button target — Datacap renders the button inside this div */}
      {applePayAvailable && applePayMid && (
        <div
          id="apple-pay-button"
          className={`transition-opacity ${disabled || processing ? 'opacity-50 pointer-events-none' : ''}`}
          style={{ minHeight: '48px' }}
        />
      )}

      {/* Google Pay button target — Datacap renders the button inside this div */}
      {googlePayAvailable && googlePayBusinessId && (
        <div
          id="google-pay-button"
          className={`transition-opacity ${disabled || processing ? 'opacity-50 pointer-events-none' : ''}`}
          style={{ minHeight: '48px' }}
        />
      )}

      {/* Processing indicator */}
      {processing && (
        <div className="flex items-center justify-center gap-2 py-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--site-brand)' }}>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
            Processing wallet payment...
          </span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div
          className="px-4 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            color: '#dc2626',
          }}
        >
          {error}
        </div>
      )}

      {/* Divider between wallet and card entry */}
      {(applePayAvailable || googlePayAvailable) && (
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 border-t" style={{ borderColor: 'var(--site-border)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--site-text-muted)' }}>
            or pay with card
          </span>
          <div className="flex-1 border-t" style={{ borderColor: 'var(--site-border)' }} />
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Script from 'next/script'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/stores/toast-store'

/* ------------------------------------------------------------------ */
/* Datacap WebToken global – loaded via external <script>              */
/* ------------------------------------------------------------------ */
declare global {
  interface Window {
    DatacapWebToken?: {
      requestToken: (
        tokenKey: string,
        formId: string,
        callback: (response: DatacapTokenResponse) => void,
      ) => void
      validateCardNumber: (cardNumber: string) => boolean
    }
  }
}

interface DatacapTokenResponse {
  Error?: string
  Token?: string
  Brand?: string
  Last4?: string
  ExpirationMonth?: string
  ExpirationYear?: string
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */
interface SaveCardFormProps {
  onTokenized: (result: {
    token: string
    last4: string
    cardBrand: string
    expiryMonth: string
    expiryYear: string
  }) => void
  onCancel: () => void
  loading?: boolean
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const FORM_ID = 'datacap-save-card-form'

const TOKEN_ENV = process.env.NEXT_PUBLIC_DATACAP_TOKEN_ENV ?? 'cert'
const TOKEN_KEY = process.env.NEXT_PUBLIC_DATACAP_TOKEN_KEY ?? ''
const SCRIPT_URL =
  TOKEN_ENV === 'prod'
    ? 'https://token.dcap.com/v1/client'
    : 'https://token-cert.dcap.com/v1/client'

/** Detect card brand from the raw (unformatted) number prefix. */
function detectCardBrand(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('4')) return 'Visa'
  if (/^5[1-5]/.test(raw)) return 'Mastercard'
  if (/^3[47]/.test(raw)) return 'Amex'
  if (raw.startsWith('6')) return 'Discover'
  return ''
}

/** Format a card number string with spaces every 4 digits. */
function formatCardNumber(raw: string): string {
  return raw.replace(/(.{4})(?=.)/g, '$1 ')
}

/** Strip all non-digit characters. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export { SaveCardForm }
export default function SaveCardForm({ onTokenized, onCancel, loading: externalLoading }: SaveCardFormProps) {
  const [cardNumber, setCardNumber] = useState('')
  const [expiryMonth, setExpiryMonth] = useState('')
  const [expiryYear, setExpiryYear] = useState('')
  const [cvv, setCvv] = useState('')
  const [tokenizing, setTokenizing] = useState(false)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [error, setError] = useState('')

  const cardInputRef = useRef<HTMLInputElement>(null)

  // Raw digits (no spaces) for validation
  const rawCardNumber = digitsOnly(cardNumber)
  const brand = detectCardBrand(rawCardNumber)

  // Max card length varies by brand
  const maxDigits = brand === 'Amex' ? 15 : 16

  /* ---------- Validation ---------- */
  const isCardNumberValid = useCallback(() => {
    if (!rawCardNumber || rawCardNumber.length < 13) return false
    if (scriptLoaded && window.DatacapWebToken) {
      return window.DatacapWebToken.validateCardNumber(rawCardNumber)
    }
    // Fallback Luhn check when script not yet loaded
    let sum = 0
    let alt = false
    for (let i = rawCardNumber.length - 1; i >= 0; i--) {
      let n = parseInt(rawCardNumber[i], 10)
      if (alt) {
        n *= 2
        if (n > 9) n -= 9
      }
      sum += n
      alt = !alt
    }
    return sum % 10 === 0
  }, [rawCardNumber, scriptLoaded])

  const isExpiryValid = expiryMonth.length === 2 && expiryYear.length === 2 &&
    parseInt(expiryMonth, 10) >= 1 && parseInt(expiryMonth, 10) <= 12
  const isCvvValid = brand === 'Amex' ? cvv.length === 4 : cvv.length === 3
  const allValid = isCardNumberValid() && isExpiryValid && isCvvValid

  const isLoading = tokenizing || externalLoading

  /* ---------- Handlers ---------- */
  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = digitsOnly(e.target.value).slice(0, maxDigits)
    setCardNumber(formatCardNumber(raw))
    setError('')
  }

  const handleExpiryMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = digitsOnly(e.target.value).slice(0, 2)
    setExpiryMonth(raw)
    setError('')
  }

  const handleExpiryYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = digitsOnly(e.target.value).slice(0, 2)
    setExpiryYear(raw)
    setError('')
  }

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const maxCvv = brand === 'Amex' ? 4 : 3
    const raw = digitsOnly(e.target.value).slice(0, maxCvv)
    setCvv(raw)
    setError('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!allValid || isLoading) return

    if (!window.DatacapWebToken) {
      setError('Card tokenization service not loaded. Please wait and try again.')
      return
    }

    if (!TOKEN_KEY) {
      setError('Datacap token key is not configured.')
      return
    }

    setTokenizing(true)
    setError('')

    window.DatacapWebToken.requestToken(TOKEN_KEY, FORM_ID, (response) => {
      setTokenizing(false)

      if (response.Error) {
        const msg = response.Error
        setError(msg)
        toast.error(`Card tokenization failed: ${msg}`)
        return
      }

      if (!response.Token) {
        setError('No token returned from processor.')
        toast.error('Card tokenization failed: no token returned.')
        return
      }

      onTokenized({
        token: response.Token,
        last4: response.Last4 ?? rawCardNumber.slice(-4),
        cardBrand: response.Brand ?? brand,
        expiryMonth: response.ExpirationMonth ?? expiryMonth,
        expiryYear: response.ExpirationYear ?? expiryYear,
      })
    })
  }

  /* ---------- Auto-focus card input on mount ---------- */
  useEffect(() => {
    if (scriptLoaded && cardInputRef.current) {
      cardInputRef.current.focus()
    }
  }, [scriptLoaded])

  /* ---------- Render ---------- */
  return (
    <>
      <Script
        src={SCRIPT_URL}
        strategy="lazyOnload"
        onLoad={() => setScriptLoaded(true)}
        onError={() => {
          setError('Failed to load card tokenization service.')
          toast.error('Failed to load Datacap tokenization script.')
        }}
      />

      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-5">
        {/* Card Number */}
        <div className="space-y-1.5">
          <Label>Card Number</Label>
          <div className="relative">
            <Input
              ref={cardInputRef}
              data-token="card_number"
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="4111 1111 1111 1111"
              value={cardNumber}
              onChange={handleCardNumberChange}
              className="h-12 text-lg pr-20"
              disabled={isLoading}
            />
            {brand && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
                {brand}
              </span>
            )}
          </div>
          {rawCardNumber.length >= 13 && !isCardNumberValid() && (
            <p className="text-sm text-red-500">Invalid card number</p>
          )}
        </div>

        {/* Expiry + CVV row */}
        <div className="grid grid-cols-3 gap-3">
          {/* Expiry Month */}
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Input
              data-token="exp_month"
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp-month"
              placeholder="MM"
              value={expiryMonth}
              onChange={handleExpiryMonthChange}
              className="h-12 text-lg text-center"
              disabled={isLoading}
            />
          </div>

          {/* Expiry Year */}
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Input
              data-token="exp_year"
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp-year"
              placeholder="YY"
              value={expiryYear}
              onChange={handleExpiryYearChange}
              className="h-12 text-lg text-center"
              disabled={isLoading}
            />
          </div>

          {/* CVV */}
          <div className="space-y-1.5">
            <Label>CVV</Label>
            <Input
              data-token="cvv"
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder={brand === 'Amex' ? '1234' : '123'}
              value={cvv}
              onChange={handleCvvChange}
              className="h-12 text-lg text-center"
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="flex-1 h-12"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="flex-1 h-12"
            disabled={!allValid || isLoading || !scriptLoaded}
            isLoading={tokenizing}
          >
            {tokenizing ? 'Saving...' : 'Save Card'}
          </Button>
        </div>
      </form>
    </>
  )
}

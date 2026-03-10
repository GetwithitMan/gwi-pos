'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'

// ─── Card Brand Detection ───────────────────────────────────────────────────

type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown'

function detectCardBrand(number: string): CardBrand {
  const digits = number.replace(/\D/g, '')
  if (/^4/.test(digits)) return 'visa'
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^6(?:011|5)/.test(digits)) return 'discover'
  return 'unknown'
}

const BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  unknown: '',
}

const BRAND_COLORS: Record<CardBrand, string> = {
  visa: '#1A1F71',
  mastercard: '#EB001B',
  amex: '#006FCF',
  discover: '#FF6600',
  unknown: '#64748b',
}

// ─── Card Number Formatting ─────────────────────────────────────────────────

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '')
  const brand = detectCardBrand(digits)
  // Amex: 4-6-5 grouping
  if (brand === 'amex') {
    const parts = [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
    return parts.filter(Boolean).join(' ')
  }
  // Default: 4-4-4-4 grouping
  const parts = [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12), digits.slice(12, 16)]
  return parts.filter(Boolean).join(' ')
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ManualCardEntryResult {
  approved: boolean
  authCode?: string
  recordNo?: string
  cardType: string
  cardLast4: string
  entryMethod: 'Manual'
  amountAuthorized?: string
  isPartialApproval?: boolean
  sequenceNo?: string
  error?: { code: string; message: string; isRetryable: boolean } | null
}

interface ManualCardEntryModalProps {
  isOpen: boolean
  onClose: () => void
  amount: number
  tipAmount?: number
  orderId: string
  readerId?: string  // Optional — server auto-resolves from location if not provided
  onSuccess: (result: ManualCardEntryResult) => void
  onError?: (error: string) => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ManualCardEntryModal({
  isOpen,
  onClose,
  amount,
  tipAmount = 0,
  orderId,
  readerId,
  onSuccess,
  onError,
}: ManualCardEntryModalProps) {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cardBrand = useMemo(() => detectCardBrand(cardNumber), [cardNumber])
  const rawDigits = useMemo(() => cardNumber.replace(/\D/g, ''), [cardNumber])
  const totalAmount = amount + tipAmount

  // ─── Validation ──────────────────────────────────────────────────────

  const isCardValid = useMemo(() => {
    const len = rawDigits.length
    if (cardBrand === 'amex') return len === 15
    return len >= 13 && len <= 19
  }, [rawDigits, cardBrand])

  const isExpiryValid = useMemo(() => {
    const digits = expiry.replace(/\D/g, '')
    if (digits.length !== 4) return false
    const month = parseInt(digits.slice(0, 2), 10)
    const year = parseInt(digits.slice(2, 4), 10)
    if (month < 1 || month > 12) return false
    const now = new Date()
    const currentYear = now.getFullYear() % 100
    const currentMonth = now.getMonth() + 1
    if (year < currentYear) return false
    if (year === currentYear && month < currentMonth) return false
    return true
  }, [expiry])

  const isCvvValid = useMemo(() => {
    const len = cvv.length
    if (cardBrand === 'amex') return len === 4
    return len === 3
  }, [cvv, cardBrand])

  const isFormValid = isCardValid && isExpiryValid && isCvvValid

  // ─── Input Handlers ──────────────────────────────────────────────────

  const handleCardNumberChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    // Amex max 15, others max 19
    const max = detectCardBrand(raw) === 'amex' ? 15 : 19
    setCardNumber(formatCardNumber(raw.slice(0, max)))
    setError(null)
  }, [])

  const handleExpiryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    setExpiry(formatExpiry(raw))
    setError(null)
  }, [])

  const handleCvvChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    setCvv(raw)
    setError(null)
  }, [])

  const handleZipChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 5)
    setZipCode(raw)
  }, [])

  // ─── Submit ──────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!isFormValid || isProcessing) return

    setIsProcessing(true)
    setError(null)

    const expiryDigits = expiry.replace(/\D/g, '')
    const expiryMonth = expiryDigits.slice(0, 2)
    const expiryYear = expiryDigits.slice(2, 4)

    try {
      const res = await fetch('/api/datacap/keyed-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          amount,
          tipAmount: tipAmount || undefined,
          cardNumber: rawDigits,
          expiryMonth,
          expiryYear,
          cvv,
          zipCode: zipCode || undefined,
          readerId: readerId || undefined,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        const msg = json.error || `Server error (${res.status})`
        setError(msg)
        onError?.(msg)
        return
      }

      const data = json.data
      if (data.approved) {
        onSuccess(data as ManualCardEntryResult)
      } else {
        const errMsg = data.error?.message || 'Card declined'
        setError(errMsg)
        onError?.(errMsg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error'
      setError(msg)
      onError?.(msg)
    } finally {
      setIsProcessing(false)
    }
  }, [isFormValid, isProcessing, expiry, rawDigits, cvv, zipCode, orderId, amount, tipAmount, readerId, onSuccess, onError])

  // ─── Reset on close ──────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (isProcessing) return
    setCardNumber('')
    setExpiry('')
    setCvv('')
    setZipCode('')
    setError(null)
    onClose()
  }, [isProcessing, onClose])

  if (!isOpen) return null

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.97)',
          backdropFilter: 'blur(20px)',
          borderRadius: 16,
          padding: 28,
          width: 420,
          maxWidth: '95vw',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 700, margin: 0 }}>Manual Card Entry</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>Type card details to process payment</p>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              color: '#94a3b8',
              fontSize: 20,
              width: 36,
              height: 36,
              borderRadius: 8,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            x
          </button>
        </div>

        {/* Amount Display */}
        <div style={{
          padding: '14px 16px',
          background: 'rgba(99, 102, 241, 0.1)',
          borderRadius: 10,
          border: '1px solid rgba(99, 102, 241, 0.2)',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ color: '#94a3b8', fontSize: 14 }}>Total Charge</span>
          <span style={{ color: '#818cf8', fontSize: 22, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>
            {formatCurrency(totalAmount)}
          </span>
        </div>

        {/* Card Number */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Card Number
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              value={cardNumber}
              onChange={handleCardNumberChange}
              placeholder="0000 0000 0000 0000"
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '12px 14px',
                paddingRight: cardBrand !== 'unknown' ? 80 : 14,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${isCardValid && rawDigits.length > 0 ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 10,
                color: '#f1f5f9',
                fontSize: 18,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: 2,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {cardBrand !== 'unknown' && (
              <div style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <div style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: BRAND_COLORS[cardBrand],
                }} />
                <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
                  {BRAND_LABELS[cardBrand]}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Expiry + CVV Row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Expiry (MM/YY)
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp"
              value={expiry}
              onChange={handleExpiryChange}
              placeholder="MM/YY"
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${isExpiryValid && expiry.length >= 4 ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 10,
                color: '#f1f5f9',
                fontSize: 18,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: 2,
                outline: 'none',
                textAlign: 'center',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              CVV
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="cc-csc"
              value={cvv}
              onChange={handleCvvChange}
              placeholder={cardBrand === 'amex' ? '0000' : '000'}
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${isCvvValid ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 10,
                color: '#f1f5f9',
                fontSize: 18,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: 4,
                outline: 'none',
                textAlign: 'center',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* ZIP Code (Optional) */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Billing ZIP Code <span style={{ color: '#475569', fontWeight: 400, textTransform: 'none' }}>(optional)</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            value={zipCode}
            onChange={handleZipChange}
            placeholder="00000"
            disabled={isProcessing}
            style={{
              width: 140,
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              color: '#f1f5f9',
              fontSize: 18,
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: 2,
              outline: 'none',
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* PCI Notice */}
        <div style={{
          padding: '10px 14px',
          background: 'rgba(234, 179, 8, 0.08)',
          borderRadius: 8,
          border: '1px solid rgba(234, 179, 8, 0.15)',
          marginBottom: 16,
        }}>
          <p style={{ color: '#ca8a04', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
            Card data is sent directly to the payment processor and is not stored on this device or server.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239, 68, 68, 0.12)',
            borderRadius: 8,
            border: '1px solid rgba(239, 68, 68, 0.3)',
            marginBottom: 16,
          }}>
            <p style={{ color: '#f87171', fontSize: 13, fontWeight: 600, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            style={{
              flex: 1,
              padding: '14px 0',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: '#94a3b8',
              fontSize: 15,
              fontWeight: 600,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isFormValid || isProcessing}
            style={{
              flex: 2,
              padding: '14px 0',
              borderRadius: 10,
              border: 'none',
              background: isFormValid && !isProcessing
                ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                : 'rgba(99, 102, 241, 0.2)',
              color: isFormValid && !isProcessing ? '#fff' : '#6366f1',
              fontSize: 15,
              fontWeight: 700,
              cursor: isFormValid && !isProcessing ? 'pointer' : 'not-allowed',
              opacity: isFormValid && !isProcessing ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: isFormValid && !isProcessing ? '0 4px 12px rgba(99, 102, 241, 0.4)' : 'none',
            }}
          >
            {isProcessing ? (
              <>
                <div style={{
                  width: 16,
                  height: 16,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                Processing...
              </>
            ) : (
              <>Charge {formatCurrency(totalAmount)}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * Public Payment Page — /pay/[token]
 *
 * Mobile-friendly payment form for Text-to-Pay links.
 * Shows order summary, optional tip selector, and card entry form.
 * No authentication required — secured by the unique token.
 *
 * PCI Compliant: Card data is submitted directly to the server API
 * which passes it to Datacap. Card data is never stored.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

// ── Types ───────────────────────────────────────────────────────────────────

interface OrderData {
  venueName: string
  orderNumber: number
  items: { name: string; quantity: number; price: number }[]
  subtotal: number
  tax: number
  total: number
  amountDue: number
  allowTip: boolean
  tipSuggestions: number[]
  expiresAt: string
  tipExemptAmount?: number
}

type PageState = 'loading' | 'ready' | 'processing' | 'success' | 'error' | 'expired' | 'completed'

// ── Component ───────────────────────────────────────────────────────────────

export default function PayPage() {
  const params = useParams()
  const token = params.token as string

  const [pageState, setPageState] = useState<PageState>('loading')
  const [orderData, setOrderData] = useState<OrderData | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Card form state
  const [cardNumber, setCardNumber] = useState('')
  const [expDate, setExpDate] = useState('')
  const [cvv, setCvv] = useState('')
  const [zipCode, setZipCode] = useState('')

  // Tip state
  const [selectedTipPercent, setSelectedTipPercent] = useState<number | null>(null)
  const [customTip, setCustomTip] = useState('')
  const [tipMode, setTipMode] = useState<'percent' | 'custom'>('percent')

  // Success state
  const [receiptData, setReceiptData] = useState<{
    totalCharged: number
    cardLast4: string
    tipAmount: number
  } | null>(null)

  // ── Fetch order data ────────────────────────────────────────────────────

  useEffect(() => {
    if (!token) return

    fetch(`/api/public/pay/${token}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          if (json.status === 'expired') {
            setPageState('expired')
          } else if (json.status === 'completed') {
            setPageState('completed')
          } else {
            setErrorMessage(json.error || 'Failed to load payment details')
            setPageState('error')
          }
          return
        }
        setOrderData(json.data)
        setPageState('ready')
      })
      .catch(err => {
        console.warn('payment page order load failed:', err)
        setErrorMessage('Unable to load payment details. Please check your connection.')
        setPageState('error')
      })
  }, [token])

  // ── Tip calculation ─────────────────────────────────────────────────────

  const tipAmount = useCallback(() => {
    if (!orderData) return 0
    if (tipMode === 'custom') {
      return parseFloat(customTip) || 0
    }
    if (selectedTipPercent !== null) {
      const tipBasis = orderData.tipExemptAmount
        ? Math.max(0, orderData.amountDue - orderData.tipExemptAmount)
        : orderData.amountDue
      return Math.round(tipBasis * selectedTipPercent) / 100
    }
    return 0
  }, [orderData, tipMode, customTip, selectedTipPercent])

  const totalWithTip = orderData ? orderData.amountDue + tipAmount() : 0

  // ── Card number formatting ──────────────────────────────────────────────

  function formatCardNumber(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 16)
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ')
  }

  function formatExpDate(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 4)
    if (digits.length > 2) {
      return `${digits.slice(0, 2)}/${digits.slice(2)}`
    }
    return digits
  }

  // ── Submit payment ──────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const rawCard = cardNumber.replace(/\s/g, '')
    if (rawCard.length < 13) {
      setErrorMessage('Please enter a valid card number')
      return
    }

    const expParts = expDate.split('/')
    if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
      setErrorMessage('Please enter a valid expiration date (MM/YY)')
      return
    }

    if (cvv.length < 3) {
      setErrorMessage('Please enter a valid CVV')
      return
    }

    setErrorMessage('')
    setPageState('processing')

    try {
      const res = await fetch(`/api/public/pay/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardNumber: rawCard,
          expMonth: expParts[0],
          expYear: expParts[1],
          cvv,
          zipCode: zipCode || undefined,
          tipAmount: tipAmount(),
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        setErrorMessage(json.error || 'Payment failed. Please try again.')
        setPageState('ready')
        return
      }

      setReceiptData({
        totalCharged: json.data.totalCharged,
        cardLast4: json.data.cardLast4,
        tipAmount: json.data.tipAmount,
      })
      setPageState('success')
    } catch {
      setErrorMessage('Payment failed. Please check your connection and try again.')
      setPageState('ready')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      }}>
        {/* Loading */}
        {pageState === 'loading' && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{
              width: '40px', height: '40px', border: '3px solid #e5e7eb',
              borderTopColor: '#2563eb', borderRadius: '50%', margin: '0 auto 16px',
              animation: 'spin 1s linear infinite',
            }} />
            <p style={{ color: '#6b7280', fontSize: '16px' }}>Loading payment details...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Expired */}
        {pageState === 'expired' && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9203;</div>
            <h2 style={{ margin: '0 0 8px', color: '#1f2937', fontSize: '20px' }}>Link Expired</h2>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              This payment link has expired. Please ask your server for a new one.
            </p>
          </div>
        )}

        {/* Already Completed */}
        {pageState === 'completed' && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9989;</div>
            <h2 style={{ margin: '0 0 8px', color: '#1f2937', fontSize: '20px' }}>Already Paid</h2>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>
              This payment has already been completed. Thank you!
            </p>
          </div>
        )}

        {/* Error */}
        {pageState === 'error' && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#10060;</div>
            <h2 style={{ margin: '0 0 8px', color: '#1f2937', fontSize: '20px' }}>Error</h2>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>{errorMessage}</p>
          </div>
        )}

        {/* Success */}
        {pageState === 'success' && receiptData && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: '#059669', padding: '32px 24px', color: 'white' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>&#9989;</div>
              <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 600 }}>Payment Successful</h2>
              <p style={{ margin: 0, opacity: 0.9, fontSize: '14px' }}>Thank you for your payment!</p>
            </div>
            <div style={{ padding: '24px' }}>
              <div style={{ fontSize: '36px', fontWeight: 700, color: '#1f2937', marginBottom: '16px' }}>
                ${receiptData.totalCharged.toFixed(2)}
              </div>
              {receiptData.tipAmount > 0 && (
                <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 8px' }}>
                  Includes ${receiptData.tipAmount.toFixed(2)} tip
                </p>
              )}
              <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>
                Charged to card ending in {receiptData.cardLast4}
              </p>
            </div>
          </div>
        )}

        {/* Ready — Payment Form */}
        {(pageState === 'ready' || pageState === 'processing') && orderData && (
          <>
            {/* Header */}
            <div style={{ background: '#1f2937', color: 'white', padding: '20px 24px', textAlign: 'center' }}>
              <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 600 }}>{orderData.venueName}</h1>
              <p style={{ margin: 0, opacity: 0.8, fontSize: '13px' }}>Order #{orderData.orderNumber}</p>
            </div>

            {/* Order Summary */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
              {orderData.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', fontSize: '14px', color: '#374151',
                }}>
                  <span>
                    {item.quantity > 1 && <span style={{ color: '#6b7280' }}>{item.quantity}x </span>}
                    {item.name}
                  </span>
                  <span style={{ fontWeight: 500 }}>${(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '12px', paddingTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                  <span>Subtotal</span>
                  <span>${orderData.subtotal.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
                  <span>Tax</span>
                  <span>${orderData.tax.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 700, color: '#1f2937' }}>
                  <span>Amount Due</span>
                  <span>${orderData.amountDue.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Tip Selector */}
            {orderData.allowTip && (
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
                <p style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600, color: '#1f2937' }}>Add a Tip</p>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  {orderData.tipSuggestions.map((pct) => {
                    const isSelected = tipMode === 'percent' && selectedTipPercent === pct
                    const payTipBasis = orderData.tipExemptAmount
                      ? Math.max(0, orderData.amountDue - orderData.tipExemptAmount)
                      : orderData.amountDue
                    const tipDollar = Math.round(payTipBasis * pct) / 100
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => {
                          setTipMode('percent')
                          setSelectedTipPercent(isSelected ? null : pct)
                          setCustomTip('')
                        }}
                        style={{
                          flex: 1,
                          padding: '10px 4px',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid #2563eb' : '1px solid #d1d5db',
                          background: isSelected ? '#eff6ff' : 'white',
                          color: isSelected ? '#2563eb' : '#374151',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 600,
                          textAlign: 'center',
                          lineHeight: 1.3,
                        }}
                      >
                        {pct}%
                        <br />
                        <span style={{ fontWeight: 400, fontSize: '12px', opacity: 0.7 }}>
                          ${tipDollar.toFixed(2)}
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setTipMode('custom')
                      setSelectedTipPercent(null)
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 4px',
                      borderRadius: '8px',
                      border: tipMode === 'custom' ? '2px solid #2563eb' : '1px solid #d1d5db',
                      background: tipMode === 'custom' ? '#eff6ff' : 'white',
                      color: tipMode === 'custom' ? '#2563eb' : '#374151',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    Custom
                  </button>
                </div>
                {tipMode === 'custom' && (
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: '16px' }}>$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={customTip}
                      onChange={(e) => setCustomTip(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 28px',
                        borderRadius: '8px',
                        border: '1px solid #d1d5db',
                        fontSize: '16px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}
                {tipAmount() > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '15px', fontWeight: 600, color: '#1f2937' }}>
                    <span>Total with Tip</span>
                    <span>${totalWithTip.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Card Entry Form */}
            <form onSubmit={handleSubmit} style={{ padding: '20px 24px' }}>
              <p style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600, color: '#1f2937' }}>Payment Details</p>

              {errorMessage && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
                  padding: '10px 12px', marginBottom: '16px', color: '#991b1b', fontSize: '13px',
                }}>
                  {errorMessage}
                </div>
              )}

              {/* Card Number */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Card Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="1234 5678 9012 3456"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  disabled={pageState === 'processing'}
                  style={{
                    width: '100%', padding: '12px', borderRadius: '8px',
                    border: '1px solid #d1d5db', fontSize: '16px', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                {/* Exp Date */}
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Exp Date</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="MM/YY"
                    value={expDate}
                    onChange={(e) => setExpDate(formatExpDate(e.target.value))}
                    disabled={pageState === 'processing'}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '8px',
                      border: '1px solid #d1d5db', fontSize: '16px', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                {/* CVV */}
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>CVV</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="123"
                    maxLength={4}
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    disabled={pageState === 'processing'}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '8px',
                      border: '1px solid #d1d5db', fontSize: '16px', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* ZIP Code */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>Billing ZIP Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="12345"
                  maxLength={10}
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/[^0-9-]/g, '').slice(0, 10))}
                  disabled={pageState === 'processing'}
                  style={{
                    width: '100%', padding: '12px', borderRadius: '8px',
                    border: '1px solid #d1d5db', fontSize: '16px', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={pageState === 'processing'}
                style={{
                  width: '100%',
                  padding: '16px',
                  borderRadius: '10px',
                  border: 'none',
                  background: pageState === 'processing' ? '#93c5fd' : '#2563eb',
                  color: 'white',
                  fontSize: '17px',
                  fontWeight: 700,
                  cursor: pageState === 'processing' ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                {pageState === 'processing'
                  ? 'Processing...'
                  : `Pay $${totalWithTip.toFixed(2)}`
                }
              </button>

              <p style={{ textAlign: 'center', margin: '16px 0 0', fontSize: '11px', color: '#9ca3af' }}>
                Secure payment powered by Datacap. Your card information is never stored.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

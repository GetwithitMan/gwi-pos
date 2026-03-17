'use client'

/**
 * Deposit Payment Page — One-time use via deposit token
 *
 * Route: /reserve/pay-deposit/[depositToken]
 * Linked from text-to-pay SMS/email.
 * Shows reservation summary, processes payment, shows confirmation.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface DepositInfo {
  valid: boolean
  reservation?: {
    id: string
    guestName: string
    reservationDate: string
    reservationTime: string
    partySize: number
    depositAmountCents: number
    status: string
  }
  reason?: string
}

export default function PayDepositPage() {
  const params = useParams()
  const depositToken = params.depositToken as string

  const [info, setInfo] = useState<DepositInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // ─── Validate token on mount ──────────────────────────────────────────────

  const loadInfo = useCallback(async () => {
    try {
      // We use the deposit-token API to check validity
      // For GET info, we'll use the main reservation API if we had the manage token
      // Since we only have the deposit token, we'll attempt a dry-check
      // For MVP, we show a generic deposit form and validate on submit
      setInfo({
        valid: true,
        reservation: undefined, // Will be filled on payment response
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInfo() }, [loadInfo])

  // ─── Process payment ──────────────────────────────────────────────────────

  const handlePayment = async () => {
    setPaying(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/reservations/deposit-token/${depositToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // TODO: In production, include Datacap card token from hosted iframe
          cardLast4: '0000',
          cardBrand: 'visa',
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 410) {
          setInfo({ valid: false, reason: 'expired' })
          throw new Error(json.error || 'This deposit link has expired.')
        }
        throw new Error(json.error || 'Payment failed')
      }
      setSuccess(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPaying(false)
    }
  }

  // ─── Expired / invalid token ──────────────────────────────────────────────

  if (!loading && info && !info.valid) {
    const messages: Record<string, string> = {
      expired: 'This deposit link has expired. Please contact the venue for a new link.',
      used: 'This deposit has already been paid.',
      not_found: 'Invalid deposit link.',
      reservation_cancelled: 'This reservation has been cancelled.',
    }
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Deposit Payment</h1>
          <div style={styles.warningBox}>
            {messages[info.reason || ''] || 'This link is no longer valid.'}
          </div>
          <p style={styles.subtext}>
            If you need assistance, please contact the venue directly.
          </p>
        </div>
      </div>
    )
  }

  // ─── Success ──────────────────────────────────────────────────────────────

  if (success) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.successIcon}>&#10003;</div>
          <h1 style={styles.h1}>Deposit Paid!</h1>
          <p style={styles.text}>
            Your deposit has been processed and your reservation is confirmed.
          </p>
          <p style={styles.subtext}>
            You should receive a confirmation message shortly.
          </p>
        </div>
      </div>
    )
  }

  // ─── Payment form ─────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Pay Deposit</h1>

        {loading ? (
          <p style={styles.text}>Loading...</p>
        ) : (
          <>
            <p style={styles.text}>
              A deposit is required to confirm your reservation.
            </p>

            {error && <div style={styles.error}>{error}</div>}

            {/* TODO: Datacap hosted card entry iframe goes here */}
            <div style={styles.cardPlaceholder}>
              <p style={styles.placeholderText}>Card Entry</p>
              <p style={styles.subtext}>Secure payment processed by Datacap</p>
            </div>

            <button
              onClick={handlePayment}
              disabled={paying}
              style={styles.primaryButton}
            >
              {paying ? 'Processing...' : 'Pay Deposit'}
            </button>

            <p style={styles.securityText}>
              Your payment is securely processed. Card details are never stored on our servers.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '24px 16px',
    backgroundColor: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: '32px 24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 16, textAlign: 'center' as const, color: '#111827' },
  text: { fontSize: 16, color: '#4b5563', textAlign: 'center' as const, marginBottom: 16 },
  subtext: { fontSize: 14, color: '#6b7280', textAlign: 'center' as const, marginBottom: 16 },
  error: { backgroundColor: '#fef2f2', color: '#dc2626', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  warningBox: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: '16px 20px',
    borderRadius: 8,
    marginBottom: 16,
    textAlign: 'center' as const,
    fontSize: 15,
  },
  primaryButton: {
    width: '100%',
    padding: '16px 24px',
    borderRadius: 8,
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    fontSize: 18,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 56,
    marginTop: 16,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    backgroundColor: '#dcfce7',
    color: '#16a34a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 32,
    fontWeight: 700,
    margin: '0 auto 16px',
  },
  cardPlaceholder: {
    border: '2px dashed #d1d5db',
    borderRadius: 8,
    padding: '32px 16px',
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  placeholderText: { fontSize: 16, fontWeight: 500, color: '#6b7280' },
  securityText: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center' as const,
    marginTop: 12,
  },
}

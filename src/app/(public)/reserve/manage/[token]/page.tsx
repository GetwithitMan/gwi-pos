'use client'

/**
 * Public Reservation Management — Self-service view/modify/cancel
 *
 * Route: /reserve/manage/[token]
 * Uses manageToken from confirmation email/SMS.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface ReservationData {
  id: string
  status: string
  readonly: boolean
  confirmationCode: string
  guestName: string
  guestPhone: string | null
  guestEmail: string | null
  partySize: number
  reservationDate: string
  reservationTime: string
  duration: number
  specialRequests: string | null
  occasion: string | null
  table: string | null
  depositStatus: string | null
  depositAmountCents: number | null
  holdExpiresAt: string | null
}

interface CancelPreview {
  depositAmountCents: number
  depositPaid: boolean
  refundAmountCents: number
  refundTier: string
  nonRefundableCents: number
  message: string
}

export default function ManageReservationPage() {
  const params = useParams()
  const token = params.token as string

  const [reservation, setReservation] = useState<ReservationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Modify state
  const [showModify, setShowModify] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [modifyLoading, setModifyLoading] = useState(false)

  // Cancel state
  const [showCancel, setShowCancel] = useState(false)
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  // ─── Load reservation ─────────────────────────────────────────────────────

  const loadReservation = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/reservations/${token}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Not found')
      setReservation(json)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { loadReservation() }, [loadReservation])

  // ─── Confirm (pending → confirmed) ────────────────────────────────────────

  const handleConfirm = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/public/reservations/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to confirm')
      setMessage('Reservation confirmed!')
      await loadReservation()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Modify ───────────────────────────────────────────────────────────────

  const handleModify = async () => {
    if (!newDate && !newTime) {
      setError('Please select a new date or time')
      return
    }
    setModifyLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/reservations/${token}/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newDate || undefined,
          time: newTime || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || json.reasons?.join(', ') || 'Failed to modify')
      setMessage(json.message || 'Reservation updated!')
      setShowModify(false)
      await loadReservation()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setModifyLoading(false)
    }
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  const handleCancelPreview = async () => {
    setCancelLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/reservations/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Cannot cancel')
      setCancelPreview(json)
      setShowCancel(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCancelLoading(false)
    }
  }

  const handleCancelConfirm = async () => {
    setCancelLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/reservations/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, reason: 'Guest cancelled online' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to cancel')
      setMessage('Reservation cancelled.')
      setShowCancel(false)
      await loadReservation()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCancelLoading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading && !reservation) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.text}>Loading reservation...</p>
        </div>
      </div>
    )
  }

  if (error && !reservation) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Reservation Not Found</h1>
          <p style={styles.text}>{error}</p>
        </div>
      </div>
    )
  }

  if (!reservation) return null

  const isReadonly = reservation.readonly
  const isPending = reservation.status === 'pending'
  const isConfirmed = reservation.status === 'confirmed'

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Your Reservation</h1>

        {/* Status banner */}
        <div style={{
          ...styles.statusBanner,
          backgroundColor: getStatusColor(reservation.status),
        }}>
          {reservation.status.replace('_', ' ').toUpperCase()}
          {isReadonly && ' (Read Only)'}
        </div>

        {/* Confirmation code */}
        <p style={styles.confirmCode}>{reservation.confirmationCode}</p>

        {error && <div style={styles.error}>{error}</div>}
        {message && <div style={styles.success}>{message}</div>}

        {/* Details */}
        <div style={styles.detailsCard}>
          <p><strong>Name:</strong> {reservation.guestName}</p>
          <p><strong>Date:</strong> {new Date(reservation.reservationDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p><strong>Time:</strong> {formatTime(reservation.reservationTime)}</p>
          <p><strong>Party:</strong> {reservation.partySize} {reservation.partySize === 1 ? 'guest' : 'guests'}</p>
          {reservation.table && <p><strong>Table:</strong> {reservation.table}</p>}
          {reservation.occasion && <p><strong>Occasion:</strong> {reservation.occasion}</p>}
          {reservation.specialRequests && <p><strong>Requests:</strong> {reservation.specialRequests}</p>}
        </div>

        {!isReadonly && (
          <div style={styles.actionSection}>
            {/* Confirm button for pending */}
            {isPending && reservation.depositStatus !== 'required' && (
              <button onClick={handleConfirm} disabled={loading} style={styles.primaryButton}>
                Confirm Reservation
              </button>
            )}

            {/* Deposit payment link for pending with required deposit */}
            {isPending && reservation.depositStatus === 'required' && (
              <p style={styles.depositWarning}>
                A deposit payment is required to confirm this reservation.
                {reservation.holdExpiresAt && (
                  <> Hold expires at {new Date(reservation.holdExpiresAt).toLocaleTimeString()}.</>
                )}
              </p>
            )}

            {/* Calendar download */}
            {(isConfirmed || isPending) && (
              <a
                href={`/api/public/reservations/${token}/calendar`}
                style={styles.secondaryButton}
              >
                Add to Calendar
              </a>
            )}

            {/* Modify */}
            {isConfirmed && !showModify && (
              <button onClick={() => setShowModify(true)} style={styles.outlineButton}>
                Change Date/Time
              </button>
            )}

            {showModify && (
              <div style={styles.modifySection}>
                <label style={styles.label}>New Date</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  style={styles.input}
                />
                <label style={styles.label}>New Time</label>
                <input
                  type="time"
                  value={newTime}
                  onChange={e => setNewTime(e.target.value)}
                  style={styles.input}
                />
                <div style={styles.buttonRow}>
                  <button onClick={() => setShowModify(false)} style={styles.backButton}>Cancel</button>
                  <button onClick={handleModify} disabled={modifyLoading} style={styles.primaryButton}>
                    {modifyLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* Cancel */}
            {(isConfirmed || isPending) && !showCancel && (
              <button
                onClick={handleCancelPreview}
                disabled={cancelLoading}
                style={styles.dangerButton}
              >
                {cancelLoading ? 'Loading...' : 'Cancel Reservation'}
              </button>
            )}

            {showCancel && cancelPreview && (
              <div style={styles.cancelSection}>
                <h3 style={{ ...styles.h3, color: '#dc2626' }}>Cancel Reservation?</h3>
                <p style={styles.text}>{cancelPreview.message}</p>
                <div style={styles.buttonRow}>
                  <button onClick={() => setShowCancel(false)} style={styles.backButton}>Keep Reservation</button>
                  <button onClick={handleCancelConfirm} disabled={cancelLoading} style={styles.dangerButton}>
                    {cancelLoading ? 'Cancelling...' : 'Yes, Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: '#fef3c7',
    confirmed: '#dcfce7',
    checked_in: '#dbeafe',
    seated: '#e0e7ff',
    completed: '#f3f4f6',
    cancelled: '#fee2e2',
    no_show: '#fef2f2',
  }
  return colors[status] || '#f3f4f6'
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
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' as const, color: '#111827' },
  h3: { fontSize: 18, fontWeight: 600, marginBottom: 8 },
  statusBanner: {
    textAlign: 'center' as const,
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.5px',
    marginBottom: 16,
  },
  confirmCode: { fontSize: 16, fontWeight: 600, textAlign: 'center' as const, color: '#2563eb', marginBottom: 16 },
  detailsCard: { backgroundColor: '#f8fafc', borderRadius: 8, padding: '16px 20px', marginBottom: 16, lineHeight: '1.8' },
  text: { fontSize: 15, color: '#4b5563', textAlign: 'center' as const, marginBottom: 12 },
  error: { backgroundColor: '#fef2f2', color: '#dc2626', padding: '12px 16px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  success: { backgroundColor: '#dcfce7', color: '#16a34a', padding: '12px 16px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  label: { display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4, marginTop: 12, color: '#374151' },
  input: { width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16, boxSizing: 'border-box' as const, minHeight: 48 },
  actionSection: { display: 'flex', flexDirection: 'column' as const, gap: 12, marginTop: 16 },
  buttonRow: { display: 'flex', gap: 12, marginTop: 16, justifyContent: 'center' },
  primaryButton: { padding: '14px 24px', borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', border: 'none', fontSize: 16, fontWeight: 600, cursor: 'pointer', minHeight: 48, textDecoration: 'none', textAlign: 'center' as const, display: 'inline-block' },
  secondaryButton: { padding: '14px 24px', borderRadius: 8, backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', fontSize: 16, fontWeight: 500, cursor: 'pointer', minHeight: 48, textDecoration: 'none', textAlign: 'center' as const, display: 'inline-block' },
  outlineButton: { padding: '14px 24px', borderRadius: 8, backgroundColor: '#fff', color: '#374151', border: '1px solid #d1d5db', fontSize: 16, fontWeight: 500, cursor: 'pointer', minHeight: 48 },
  backButton: { padding: '14px 24px', borderRadius: 8, backgroundColor: '#f3f4f6', color: '#374151', border: 'none', fontSize: 16, fontWeight: 500, cursor: 'pointer', minHeight: 48 },
  dangerButton: { padding: '14px 24px', borderRadius: 8, backgroundColor: '#dc2626', color: '#fff', border: 'none', fontSize: 16, fontWeight: 600, cursor: 'pointer', minHeight: 48 },
  depositWarning: { fontSize: 14, color: '#d97706', backgroundColor: '#fef3c7', padding: '12px 16px', borderRadius: 8, textAlign: 'center' as const },
  modifySection: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 16 },
  cancelSection: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 16 },
}

'use client'

/**
 * Public Reservation Booking Wizard — 4-step flow
 *
 * Step 1: Date + Party Size + Time slot
 * Step 2: Guest info (name, phone, email, occasion, dietary, requests)
 * Step 3: Deposit payment (if required)
 * Step 4: Confirmation + Add to Calendar + manage link
 *
 * Route: /reserve/[slug]?locationId=xxx
 */

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TimeSlot {
  time: string
  available: boolean
  availableTables: number
  maxPartySize: number
  reason?: string
}

interface BookingData {
  date: string
  time: string
  partySize: number
  guestName: string
  guestPhone: string
  guestEmail: string
  occasion: string
  dietaryRestrictions: string
  specialRequests: string
  smsOptIn: boolean
  website: string // honeypot
}

interface BookingResult {
  id: string
  status: string
  manageToken: string
  depositRequired: boolean
  depositToken?: string
  depositExpiresAt?: string
  confirmationCode: string
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReserveBookingPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const locationId = searchParams.get('locationId') || ''

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [result, setResult] = useState<BookingResult | null>(null)
  const [maxPartySize, setMaxPartySize] = useState(20)

  const [data, setData] = useState<BookingData>({
    date: '',
    time: '',
    partySize: 2,
    guestName: '',
    guestPhone: '',
    guestEmail: '',
    occasion: '',
    dietaryRestrictions: '',
    specialRequests: '',
    smsOptIn: false,
    website: '', // honeypot
  })

  const update = useCallback((field: keyof BookingData, value: string | number | boolean) => {
    setData(prev => ({ ...prev, [field]: value }))
    setError(null)
  }, [])

  // ─── Step 1: Load availability ────────────────────────────────────────────

  const loadSlots = useCallback(async () => {
    if (!data.date || !locationId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/public/reservations/availability?date=${data.date}&partySize=${data.partySize}&locationId=${locationId}`
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load availability')
      setEnabled(json.enabled)
      setSlots(json.slots || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [data.date, data.partySize, locationId])

  useEffect(() => {
    if (data.date && locationId) loadSlots()
  }, [data.date, data.partySize, loadSlots, locationId])

  // ─── Step 2 → 3/4: Submit booking ────────────────────────────────────────

  const submitBooking = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (!data.guestName || (!data.guestPhone && !data.guestEmail)) {
      setError('Please provide your name and at least a phone number or email')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const idempotencyKey = `${locationId}:${data.date}:${data.time}:${data.guestPhone || data.guestEmail}:${Date.now()}`
      const res = await fetch('/api/public/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          guestName: data.guestName,
          guestPhone: data.guestPhone || undefined,
          guestEmail: data.guestEmail || undefined,
          partySize: data.partySize,
          date: data.date,
          time: data.time,
          occasion: data.occasion || undefined,
          dietaryRestrictions: data.dietaryRestrictions || undefined,
          specialRequests: data.specialRequests || undefined,
          smsOptIn: data.smsOptIn,
          website: data.website, // honeypot
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create reservation')
      setResult(json)
      // Skip to deposit step if required, else go to confirmation
      setStep(json.depositRequired ? 3 : 4)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [data, locationId])

  // ─── Call-us page when online booking is disabled ─────────────────────────

  if (enabled === false) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Make a Reservation</h1>
          <p style={styles.text}>
            Online booking is not currently available. Please call us to make a reservation.
          </p>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Progress bar */}
        <div style={styles.progress}>
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              style={{
                ...styles.progressDot,
                backgroundColor: s <= step ? '#2563eb' : '#d1d5db',
              }}
            />
          ))}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Step 1: Date + Party Size + Time */}
        {step === 1 && (
          <div>
            <h1 style={styles.h1}>Book a Table</h1>

            <label htmlFor="party-size" style={styles.label}>Party Size</label>
            <select
              id="party-size"
              value={data.partySize}
              onChange={e => update('partySize', parseInt(e.target.value))}
              style={styles.select}
            >
              {Array.from({ length: maxPartySize }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
              ))}
            </select>

            <label htmlFor="reservation-date" style={styles.label}>Date</label>
            <input
              id="reservation-date"
              type="date"
              value={data.date}
              onChange={e => update('date', e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              style={styles.input}
            />

            {loading && <p style={styles.text}>Loading available times...</p>}

            {slots.length > 0 && (
              <>
                <label style={styles.label}>Available Times</label>
                <div style={styles.slotGrid}>
                  {slots.filter(s => s.available).map(slot => (
                    <button
                      key={slot.time}
                      onClick={() => {
                        update('time', slot.time)
                        setStep(2)
                      }}
                      className="slot-button-focus"
                      style={{
                        ...styles.slotButton,
                        ...(data.time === slot.time ? styles.slotButtonActive : {}),
                      }}
                    >
                      {formatTime(slot.time)}
                    </button>
                  ))}
                </div>
                {slots.filter(s => s.available).length === 0 && !loading && (
                  <p style={styles.text}>No tables available for this date and party size.</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 2: Guest Info */}
        {step === 2 && (
          <form onSubmit={submitBooking}>
            <h1 style={styles.h1}>Your Details</h1>
            <p style={styles.subtext}>
              {formatTime(data.time)} · {new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {data.partySize} {data.partySize === 1 ? 'guest' : 'guests'}
            </p>

            <label htmlFor="guest-name" style={styles.label}>Name *</label>
            <input
              id="guest-name"
              type="text"
              value={data.guestName}
              onChange={e => update('guestName', e.target.value)}
              required
              autoComplete="name"
              style={styles.input}
            />

            <label htmlFor="guest-phone" style={styles.label}>Phone</label>
            <input
              id="guest-phone"
              type="tel"
              value={data.guestPhone}
              onChange={e => update('guestPhone', e.target.value)}
              autoComplete="tel"
              style={styles.input}
            />

            <label htmlFor="guest-email" style={styles.label}>Email</label>
            <input
              id="guest-email"
              type="email"
              value={data.guestEmail}
              onChange={e => update('guestEmail', e.target.value)}
              autoComplete="email"
              style={styles.input}
            />

            <label htmlFor="occasion" style={styles.label}>Occasion</label>
            <select
              id="occasion"
              value={data.occasion}
              onChange={e => update('occasion', e.target.value)}
              style={styles.select}
            >
              <option value="">None</option>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="date_night">Date Night</option>
              <option value="business">Business</option>
              <option value="celebration">Celebration</option>
              <option value="other">Other</option>
            </select>

            <label htmlFor="dietary-restrictions" style={styles.label}>Dietary Restrictions</label>
            <input
              id="dietary-restrictions"
              type="text"
              value={data.dietaryRestrictions}
              onChange={e => update('dietaryRestrictions', e.target.value)}
              placeholder="e.g., gluten-free, vegetarian"
              style={styles.input}
            />

            <label htmlFor="special-requests" style={styles.label}>Special Requests</label>
            <textarea
              id="special-requests"
              value={data.specialRequests}
              onChange={e => update('specialRequests', e.target.value)}
              placeholder="Any special requests?"
              rows={3}
              style={styles.textarea}
            />

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={data.smsOptIn}
                onChange={e => update('smsOptIn', e.target.checked)}
              />
              <span style={styles.checkboxText}>
                I agree to receive SMS reminders about my reservation. Msg & data rates may apply.
              </span>
            </label>

            {/* Honeypot — hidden from real users */}
            <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={data.website}
                onChange={e => update('website', e.target.value)}
              />
            </div>

            <div style={styles.buttonRow}>
              <button type="button" onClick={() => setStep(1)} style={styles.backButton}>
                Back
              </button>
              <button type="submit" disabled={loading} style={styles.primaryButton}>
                {loading ? 'Booking...' : 'Complete Reservation'}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Deposit Payment */}
        {step === 3 && result && (
          <div>
            <h1 style={styles.h1}>Deposit Required</h1>
            <p style={styles.text}>
              A deposit is required to confirm your reservation.
            </p>
            {result.depositToken && (
              <a
                href={`/reserve/pay-deposit/${result.depositToken}`}
                style={styles.primaryButton}
              >
                Pay Deposit
              </a>
            )}
            <p style={styles.subtext}>
              Your reservation is held for a limited time. Please complete payment to confirm.
            </p>
          </div>
        )}

        {/* Step 4: Confirmation */}
        {step === 4 && result && (
          <div>
            <div style={styles.successIcon}>&#10003;</div>
            <h1 style={styles.h1}>Reservation Confirmed!</h1>
            <p style={styles.confirmCode}>
              Confirmation: {result.confirmationCode}
            </p>
            <div style={styles.detailsCard}>
              <p><strong>Date:</strong> {new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              <p><strong>Time:</strong> {formatTime(data.time)}</p>
              <p><strong>Party:</strong> {data.partySize} {data.partySize === 1 ? 'guest' : 'guests'}</p>
            </div>

            <div style={styles.buttonRow}>
              <a
                href={`/api/public/reservations/${result.manageToken}/calendar`}
                style={styles.secondaryButton}
              >
                Add to Calendar
              </a>
              <a
                href={`/reserve/manage/${result.manageToken}`}
                style={styles.primaryButton}
              >
                Manage Reservation
              </a>
            </div>
          </div>
        )}
      </div>

      <style>{`.slot-button-focus:focus { outline: 2px solid #2563eb; outline-offset: 2px; }`}</style>

      {/* JSON-LD for SEO — only when booking is enabled */}
      {enabled && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Restaurant',
              name: slug,
              potentialAction: {
                '@type': 'ReserveAction',
                target: {
                  '@type': 'EntryPoint',
                  urlTemplate: typeof window !== 'undefined' ? window.location.href : '',
                  actionPlatform: 'http://schema.org/DesktopWebPlatform',
                },
                result: { '@type': 'FoodEstablishmentReservation' },
              },
            }).replace(/</g, '\\u003c'),
          }}
        />
      )}
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
  progress: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 24,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    transition: 'background-color 0.2s',
  },
  h1: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 16,
    textAlign: 'center' as const,
    color: '#111827',
  },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 4,
    marginTop: 16,
    color: '#374151',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 16,
    boxSizing: 'border-box' as const,
    minHeight: 48,
  },
  select: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 16,
    boxSizing: 'border-box' as const,
    minHeight: 48,
    backgroundColor: '#fff',
  },
  textarea: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 16,
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
  },
  slotGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: 8,
    marginTop: 8,
  },
  slotButton: {
    padding: '12px 8px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 48,
    transition: 'all 0.15s',
  },
  slotButtonActive: {
    backgroundColor: '#2563eb',
    color: '#fff',
    borderColor: '#2563eb',
  },
  text: {
    fontSize: 16,
    color: '#4b5563',
    textAlign: 'center' as const,
    marginTop: 16,
  },
  subtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  error: {
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    marginTop: 24,
    justifyContent: 'center',
  },
  primaryButton: {
    padding: '14px 24px',
    borderRadius: 8,
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 48,
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center' as const,
  },
  backButton: {
    padding: '14px 24px',
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    fontSize: 16,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 48,
  },
  secondaryButton: {
    padding: '14px 24px',
    borderRadius: 8,
    backgroundColor: '#fff',
    color: '#2563eb',
    border: '1px solid #2563eb',
    fontSize: 16,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 48,
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center' as const,
  },
  callButton: {
    display: 'block',
    padding: '16px 24px',
    borderRadius: 8,
    backgroundColor: '#2563eb',
    color: '#fff',
    fontSize: 18,
    fontWeight: 600,
    textDecoration: 'none',
    textAlign: 'center' as const,
    marginTop: 24,
    minHeight: 48,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    cursor: 'pointer',
  },
  checkboxText: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: '1.4',
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
  confirmCode: {
    fontSize: 18,
    fontWeight: 600,
    textAlign: 'center' as const,
    color: '#2563eb',
    marginBottom: 16,
  },
  detailsCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: '16px 20px',
    marginBottom: 16,
    lineHeight: '1.8',
  },
}

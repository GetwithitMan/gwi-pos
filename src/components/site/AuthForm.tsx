'use client'

/**
 * AuthForm — Customer authentication form with Phone (OTP) and Email (magic link) tabs.
 *
 * Used on the /account page for customer portal login.
 */

import { useState, useRef, useEffect, useCallback } from 'react'

interface AuthFormProps {
  slug: string
  onAuthenticated?: (customer: { id: string; name: string }) => void
  onGuest?: () => void
}

type Tab = 'phone' | 'email'
type PhoneStep = 'input' | 'verify'
type EmailStep = 'input' | 'sent'

export function AuthForm({ slug, onAuthenticated, onGuest }: AuthFormProps) {
  const [tab, setTab] = useState<Tab>('phone')

  // Phone state
  const [phone, setPhone] = useState('')
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('input')
  const [otpCode, setOtpCode] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  // Email state
  const [email, setEmail] = useState('')
  const [emailStep, setEmailStep] = useState<EmailStep>('input')

  // Shared state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const otpInputRef = useRef<HTMLInputElement>(null)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-focus OTP input when step changes
  useEffect(() => {
    if (phoneStep === 'verify') {
      otpInputRef.current?.focus()
    }
  }, [phoneStep])

  // Cleanup cooldown timer
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  const startCooldown = useCallback(() => {
    setResendCooldown(60)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  const authUrl = `/api/public/portal/${slug}/auth`

  // ── Phone: Send OTP ──────────────────────────────────────────────
  const handleSendOTP = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-otp', phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send code')
        return
      }
      setPhoneStep('verify')
      startCooldown()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Phone: Verify OTP ────────────────────────────────────────────
  const handleVerifyOTP = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-otp', phone, code: otpCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Verification failed')
        return
      }
      onAuthenticated?.({ id: data.customerId, name: data.customerName || '' })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Phone: Resend OTP ────────────────────────────────────────────
  const handleResendOTP = async () => {
    if (resendCooldown > 0) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-otp', phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to resend code')
        return
      }
      startCooldown()
      setOtpCode('')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Email: Send Magic Link ───────────────────────────────────────
  const handleSendMagicLink = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-magic-link', email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send login link')
        return
      }
      setEmailStep('sent')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const btnStyle: React.CSSProperties = {
    backgroundColor: 'var(--site-brand)',
    color: 'var(--site-text-on-brand)',
    borderRadius: 'var(--site-btn-radius)',
    fontWeight: 'var(--site-btn-font-weight)' as any,
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* ── Tab Toggle ──────────────────────────────────────────── */}
      <div
        className="flex rounded-lg p-1 mb-6"
        style={{ backgroundColor: 'var(--site-bg-secondary)' }}
      >
        {(['phone', 'email'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              setError('')
            }}
            className="flex-1 py-2 px-4 text-sm font-medium rounded-md transition-all"
            style={
              tab === t
                ? {
                    backgroundColor: 'var(--site-bg)',
                    color: 'var(--site-text)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  }
                : { color: 'var(--site-text-muted)' }
            }
          >
            {t === 'phone' ? 'Phone' : 'Email'}
          </button>
        ))}
      </div>

      {/* ── Error Banner ────────────────────────────────────────── */}
      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm"
          style={{
            backgroundColor: 'color-mix(in srgb, #ef4444 10%, transparent)',
            color: '#dc2626',
            border: '1px solid color-mix(in srgb, #ef4444 20%, transparent)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Phone Tab ───────────────────────────────────────────── */}
      {tab === 'phone' && phoneStep === 'input' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendOTP()
          }}
        >
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--site-text)' }}
          >
            Phone Number
          </label>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="w-full px-4 py-3 rounded-lg text-base mb-4"
            style={{
              backgroundColor: 'var(--site-bg)',
              color: 'var(--site-text)',
              border: '1px solid var(--site-border)',
            }}
            required
          />
          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className="w-full py-3 px-4 text-base transition-opacity hover:opacity-90 disabled:opacity-50"
            style={btnStyle}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner /> Sending...
              </span>
            ) : (
              'Send Code'
            )}
          </button>
        </form>
      )}

      {tab === 'phone' && phoneStep === 'verify' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleVerifyOTP()
          }}
        >
          <p className="text-sm mb-4" style={{ color: 'var(--site-text-muted)' }}>
            Enter the 6-digit code sent to <strong style={{ color: 'var(--site-text)' }}>{phone}</strong>
          </p>
          <input
            ref={otpInputRef}
            type="text"
            inputMode="numeric"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            className="w-full px-4 py-3 rounded-lg text-center text-2xl tracking-[0.5em] font-mono mb-4"
            style={{
              backgroundColor: 'var(--site-bg)',
              color: 'var(--site-text)',
              border: '1px solid var(--site-border)',
            }}
            required
          />
          <button
            type="submit"
            disabled={loading || otpCode.length !== 6}
            className="w-full py-3 px-4 text-base transition-opacity hover:opacity-90 disabled:opacity-50"
            style={btnStyle}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner /> Verifying...
              </span>
            ) : (
              'Verify'
            )}
          </button>
          <div className="flex items-center justify-between mt-4">
            <button
              type="button"
              onClick={() => {
                setPhoneStep('input')
                setOtpCode('')
                setError('')
              }}
              className="text-sm hover:underline"
              style={{ color: 'var(--site-text-muted)' }}
            >
              Change number
            </button>
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={resendCooldown > 0 || loading}
              className="text-sm hover:underline disabled:opacity-50"
              style={{ color: 'var(--site-brand)' }}
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {/* ── Email Tab ───────────────────────────────────────────── */}
      {tab === 'email' && emailStep === 'input' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMagicLink()
          }}
        >
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--site-text)' }}
          >
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-lg text-base mb-4"
            style={{
              backgroundColor: 'var(--site-bg)',
              color: 'var(--site-text)',
              border: '1px solid var(--site-border)',
            }}
            required
          />
          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full py-3 px-4 text-base transition-opacity hover:opacity-90 disabled:opacity-50"
            style={btnStyle}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner /> Sending...
              </span>
            ) : (
              'Send Magic Link'
            )}
          </button>
        </form>
      )}

      {tab === 'email' && emailStep === 'sent' && (
        <div className="text-center py-4">
          <div
            className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--site-brand) 10%, transparent)' }}
          >
            <svg className="w-6 h-6" style={{ color: 'var(--site-brand)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--site-text)' }}
          >
            Check Your Email
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--site-text-muted)' }}>
            We sent a login link to <strong style={{ color: 'var(--site-text)' }}>{email}</strong>.
            Click the link in the email to sign in.
          </p>
          <button
            type="button"
            onClick={() => {
              setEmailStep('input')
              setError('')
            }}
            className="text-sm hover:underline"
            style={{ color: 'var(--site-brand)' }}
          >
            Try a different email
          </button>
        </div>
      )}

      {/* ── Guest Link ──────────────────────────────────────────── */}
      {onGuest && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onGuest}
            className="text-sm hover:underline"
            style={{ color: 'var(--site-text-muted)' }}
          >
            Continue as Guest
          </button>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

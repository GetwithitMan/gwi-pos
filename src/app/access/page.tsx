'use client'

/**
 * GWI Access Gate — Clerk Email + Password Verification
 *
 * Users added to the GWI Access allowlist receive a Clerk invitation.
 * They log in here with their Clerk email + password to access the demo terminal.
 * Includes forgot password flow via Clerk FAPI reset_password_email_code.
 */

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

type Mode = 'login' | 'forgot' | 'verify'

function AccessGate() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/settings'

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('')
  const [signInId, setSignInId] = useState('')
  const [clientToken, setClientToken] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetPassword, setResetPassword] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setLoading(true)

    try {
      const res = await fetch('/api/access/clerk-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid email or password')
      } else {
        router.push(data.redirect || nextPath)
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() }),
      })
      const data = await res.json()

      if (data.data?.signInId) {
        setSignInId(data.data.signInId)
      }
      if (data.data?.clientToken) {
        setClientToken(data.data.clientToken)
      }
      setMode('verify')
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signInId, clientToken, code: resetCode.trim(), password: resetPassword }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Reset failed. Please try again.')
        return
      }

      setSuccessMessage('Password updated. Please sign in with your new password.')
      setResetCode('')
      setResetPassword('')
      setSignInId('')
      setClientToken('')
      setMode('login')
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot password — enter email ──────────────────────────────────────
  if (mode === 'forgot') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Reset Password</h1>
            <p className="text-gray-400 text-sm mt-1">Enter your email to receive a reset code</p>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email address
                </label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Sending code...' : 'Send Reset Code'}
              </button>
            </form>
          </div>

          <button
            onClick={() => { setMode('login'); setError('') }}
            className="mt-4 w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            &larr; Back to sign in
          </button>
        </div>
      </div>
    )
  }

  // ── Verify — enter code + new password ────────────────────────────────
  if (mode === 'verify') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Enter Reset Code</h1>
            <p className="text-gray-400 text-sm mt-1">Check your email for a 6-digit code</p>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Reset code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-2xl text-center placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent tracking-widest font-mono"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  New password
                </label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Min. 8 characters"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || resetCode.length < 6 || resetPassword.length < 8}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Resetting...' : 'Set New Password'}
              </button>
            </form>
          </div>

          <button
            onClick={() => { setMode('forgot'); setError(''); setResetCode(''); setResetPassword('') }}
            className="mt-4 w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            &larr; Back
          </button>
        </div>
      </div>
    )
  }

  // ── Login (default) ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">GWI Point of Sale</h1>
          <p className="text-gray-400 text-sm mt-1">Authorized access only</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
          {successMessage && (
            <div className="mb-4 px-3 py-2 bg-green-950 border border-green-900 rounded-lg">
              <p className="text-green-400 text-sm">{successMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              {loading ? 'Verifying...' : 'Sign in'}
            </button>
          </form>

          <button
            onClick={() => { setMode('forgot'); setError(''); setSuccessMessage(''); setResetEmail(email) }}
            className="mt-4 w-full text-center text-gray-500 hover:text-gray-400 text-sm transition-colors"
          >
            Forgot your password?
          </button>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          GWI Point of Sale · Authorized access only
        </p>
      </div>
    </div>
  )
}

export default function AccessPage() {
  return (
    <Suspense>
      <AccessGate />
    </Suspense>
  )
}

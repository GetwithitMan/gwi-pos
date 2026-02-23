'use client'

/**
 * GWI Access Gate — Clerk Email + Password Verification
 *
 * Users added to the GWI Access allowlist receive a Clerk invitation.
 * They log in here with their Clerk email + password to access the demo terminal.
 * Password reset uses Clerk FAPI client-side — no redirects to Mission Control.
 */

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { requestPasswordReset, completePasswordReset } from '@/lib/clerk-password-reset'

function AccessGate() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawNext = searchParams.get('next') || '/settings'
  // Sanitize: only allow same-origin paths, never redirect back to /access itself
  const nextPath = (rawNext.startsWith('/') && rawNext !== '/access' && !rawNext.startsWith('/access?'))
    ? rawNext
    : '/settings'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login')
  const [resetEmail, setResetEmail] = useState('')
  const [signInId, setSignInId] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
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

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await requestPasswordReset(resetEmail.trim().toLowerCase())
    if (result.ok && result.signInId) {
      setSignInId(result.signInId)
      setMode('reset')
    } else {
      setError(result.error || 'Could not send reset code')
    }
    setLoading(false)
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await completePasswordReset(signInId, resetCode, newPassword)
    if (result.ok) {
      setMode('login')
      setSuccess('Password reset successfully. You can now sign in with your new password.')
      setResetEmail('')
      setSignInId('')
      setResetCode('')
      setNewPassword('')
    } else {
      setError(result.error || 'Could not reset password')
    }
    setLoading(false)
  }

  // ── Forgot password ─────────────────────────────────────────────────
  if (mode === 'forgot') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Reset Password</h1>
            <p className="text-gray-400 text-sm mt-1">Enter your email to receive a reset code</p>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !resetEmail}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Sending...' : 'Send Reset Code'}
              </button>
            </form>
          </div>

          <button
            onClick={() => { setMode('login'); setError('') }}
            className="mt-6 w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            &larr; Back to sign in
          </button>

          <p className="text-center text-gray-600 text-xs mt-6">GWI Point of Sale</p>
        </div>
      </div>
    )
  }

  // ── Reset password ──────────────────────────────────────────────────
  if (mode === 'reset') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Enter Reset Code</h1>
            <p className="text-gray-400 text-sm mt-1">We sent a code to {resetEmail}</p>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Reset code</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="000000"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  required
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center tracking-widest"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !resetCode || !newPassword}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          </div>

          <button
            onClick={() => { setMode('login'); setError(''); setResetCode(''); setNewPassword('') }}
            className="mt-6 w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            &larr; Back to sign in
          </button>

          <p className="text-center text-gray-600 text-xs mt-6">GWI Point of Sale</p>
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

            {success && (
              <p className="text-green-400 text-sm bg-green-950 border border-green-900 rounded-lg px-3 py-2">
                {success}
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
            type="button"
            onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}
            className="mt-4 w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
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

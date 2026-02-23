'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

type Mode = 'login' | 'picking'

const MC_SIGN_IN_URL = 'https://app.thepasspos.com/sign-in'

/**
 * /admin-login
 *
 * Venue-local admin login page. Accessible at {slug}.ordercontrolcenter.com/admin-login.
 * Modes:
 *   login   — email + password
 *   picking — multi-venue selector (owner with 2+ venues)
 *
 * Password reset is handled via Mission Control's Clerk-native sign-in page
 * where Clerk's SDK manages the full FAPI flow client-side.
 */
function AdminLoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showResetHelp, setShowResetHelp] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [venues, setVenues] = useState<Array<{ slug: string; name: string; domain: string }>>([])
  const [ownerToken, setOwnerToken] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((s) => s.login)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/venue-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 403 && data.needsSetup) {
          setError('Your admin account has not been set up yet. Please contact GWI support to activate your login.')
        } else {
          setError(data.error || 'Login failed. Please check your credentials.')
        }
        return
      }

      if (data.data.multiVenue) {
        setVenues(data.data.venues)
        setOwnerToken(data.data.ownerToken)
        setMode('picking')
        return
      }

      login(data.data.employee)
      router.replace('/settings')
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Shared layout wrapper ──────────────────────────────────────────────
  const PageWrapper = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {children}
        <p className="text-center text-gray-600 text-xs mt-6">Powered by GWI Point of Sale</p>
      </div>
    </div>
  )

  const LockIcon = () => (
    <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )

  const BuildingIcon = () => (
    <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  )

  const Logo = ({ icon }: { icon: React.ReactNode }) => (
    <div className="w-14 h-14 bg-blue-600/20 border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
      {icon}
    </div>
  )

  const Spinner = () => (
    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
  )

  // ── Venue picker ───────────────────────────────────────────────────────
  if (mode === 'picking') {
    return (
      <PageWrapper>
        <div className="text-center mb-8">
          <Logo icon={<BuildingIcon />} />
          <h1 className="text-2xl font-bold text-white">Select Venue</h1>
          <p className="text-gray-400 text-sm mt-1">Choose which venue to manage</p>
        </div>

        <div className="space-y-3">
          {venues.map((venue) => (
            <a
              key={venue.slug}
              href={`https://${venue.domain}/auth/owner?token=${ownerToken}`}
              className="block bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl p-5 hover:border-blue-500/50 hover:bg-gray-800/70 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">{venue.name}</h2>
                  <p className="text-gray-500 text-sm mt-0.5">{venue.domain}</p>
                </div>
                <span className="text-gray-500 group-hover:text-blue-400 transition-colors text-sm font-medium">
                  Open &rarr;
                </span>
              </div>
            </a>
          ))}
        </div>

        <button
          onClick={() => setMode('login')}
          className="mt-6 w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
        >
          &larr; Back to login
        </button>
      </PageWrapper>
    )
  }

  // ── Login (default) ───────────────────────────────────────────────────
  return (
    <PageWrapper>
      <div className="text-center mb-8">
        <Logo icon={<LockIcon />} />
        <h1 className="text-2xl font-bold text-white">Admin Login</h1>
        <p className="text-gray-400 text-sm mt-1">Sign in to access your venue settings</p>
      </div>

      <div className="bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 rounded-2xl p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <><Spinner /> Signing in...</> : 'Sign In'}
          </button>
        </form>

        {showResetHelp ? (
          <div className="mt-4 px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-blue-300 text-sm">
              Reset your password at{' '}
              <a
                href={MC_SIGN_IN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-200"
              >
                app.thepasspos.com
              </a>
              , then come back here to sign in.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowResetHelp(true)}
            className="mt-4 w-full text-center text-gray-500 hover:text-gray-400 text-sm transition-colors"
          >
            Forgot your password?
          </button>
        )}
      </div>
    </PageWrapper>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginContent />
    </Suspense>
  )
}

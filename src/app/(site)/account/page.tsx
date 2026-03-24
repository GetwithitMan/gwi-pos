'use client'

/**
 * Account Page — Auth gate + customer dashboard.
 *
 * Handles magic link token verification from URL params,
 * shows AuthForm if not logged in, and dashboard if logged in.
 */

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSiteModeContext } from '@/components/site/SiteShell'
import { useSiteAuth } from '@/hooks/useSiteAuth'
import { AuthForm } from '@/components/site/AuthForm'

export default function AccountPage() {
  const { slug } = useSiteModeContext()
  const { isAuthenticated, customer, isLoading, logout, refresh } = useSiteAuth(slug)
  const searchParams = useSearchParams()
  const router = useRouter()

  const [verifyingToken, setVerifyingToken] = useState(false)
  const [tokenError, setTokenError] = useState('')

  // ── Auto-verify magic link token from URL ─────────────────────────
  const verifyMagicLink = useCallback(async (token: string) => {
    setVerifyingToken(true)
    setTokenError('')
    try {
      const res = await fetch(`/api/public/portal/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-magic-link', token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTokenError(data.error || 'Failed to verify login link')
        return
      }
      // Clean URL and refresh auth state
      router.replace('/account')
      await refresh()
    } catch {
      setTokenError('Network error. Please try again.')
    } finally {
      setVerifyingToken(false)
    }
  }, [slug, router, refresh])

  useEffect(() => {
    const token = searchParams.get('token')
    if (token && !isAuthenticated && !isLoading) {
      verifyMagicLink(token)
    }
  }, [searchParams, isAuthenticated, isLoading, verifyMagicLink])

  // ── Loading state ─────────────────────────────────────────────────
  if (isLoading || verifyingToken) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div
            className="w-8 h-8 mx-auto mb-4 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--site-brand)', borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
            {verifyingToken ? 'Verifying login link...' : 'Loading...'}
          </p>
        </div>
      </div>
    )
  }

  // ── Not authenticated: show auth form ─────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="py-12 md:py-16 px-4 md:px-6">
        <div className="max-w-sm mx-auto">
          <h1
            className="text-2xl md:text-3xl text-center mb-2"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Sign In
          </h1>
          <p className="text-center text-sm mb-8" style={{ color: 'var(--site-text-muted)' }}>
            Access your order history, rewards, and more.
          </p>

          {tokenError && (
            <div
              className="mb-6 px-4 py-3 rounded-lg text-sm"
              style={{
                backgroundColor: 'color-mix(in srgb, #ef4444 10%, transparent)',
                color: '#dc2626',
                border: '1px solid color-mix(in srgb, #ef4444 20%, transparent)',
              }}
            >
              {tokenError}
            </div>
          )}

          <AuthForm
            slug={slug}
            onAuthenticated={() => refresh()}
            onGuest={() => router.push('/menu')}
          />
        </div>
      </div>
    )
  }

  // ── Authenticated: dashboard ──────────────────────────────────────
  return (
    <div className="py-12 md:py-16 px-4 md:px-6">
      <div className="max-w-lg mx-auto">
        {/* Welcome */}
        <h1
          className="text-2xl md:text-3xl mb-8"
          style={{
            fontFamily: 'var(--site-heading-font)',
            fontWeight: 'var(--site-heading-weight, 700)',
          }}
        >
          Welcome, {customer?.name || 'Guest'}
        </h1>

        {/* Loyalty Points Card */}
        {customer && customer.loyaltyPoints > 0 && (
          <div
            className="rounded-xl p-6 mb-6"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--site-brand) 8%, var(--site-bg))',
              border: '1px solid color-mix(in srgb, var(--site-brand) 20%, transparent)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--site-text-muted)' }}>
                  Loyalty Points
                </p>
                <p
                  className="text-3xl font-bold mt-1"
                  style={{ color: 'var(--site-brand)' }}
                >
                  {customer.loyaltyPoints.toLocaleString()}
                </p>
              </div>
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--site-brand)', color: 'var(--site-text-on-brand)' }}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Quick Links */}
        <div className="space-y-3">
          <Link
            href="/account/orders"
            className="flex items-center justify-between p-4 rounded-xl transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-bg-secondary)',
              border: '1px solid var(--site-border)',
            }}
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" style={{ color: 'var(--site-text-muted)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
              <span className="text-base font-medium" style={{ color: 'var(--site-text)' }}>
                Order History
              </span>
            </div>
            <svg className="w-5 h-5" style={{ color: 'var(--site-text-muted)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>

          <Link
            href="/account/rewards"
            className="flex items-center justify-between p-4 rounded-xl transition-colors hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-bg-secondary)',
              border: '1px solid var(--site-border)',
            }}
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" style={{ color: 'var(--site-text-muted)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
              </svg>
              <span className="text-base font-medium" style={{ color: 'var(--site-text)' }}>
                Rewards
              </span>
            </div>
            <svg className="w-5 h-5" style={{ color: 'var(--site-text-muted)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        </div>

        {/* Logout */}
        <button
          onClick={async () => {
            await logout()
            router.push('/account')
          }}
          className="mt-8 w-full py-3 px-4 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
          style={{
            backgroundColor: 'var(--site-bg-secondary)',
            color: 'var(--site-text-muted)',
            border: '1px solid var(--site-border)',
          }}
        >
          Log Out
        </button>
      </div>
    </div>
  )
}

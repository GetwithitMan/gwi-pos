'use client'

/**
 * Rewards Page — Loyalty points balance and available rewards.
 *
 * Session-authenticated via useSiteAuth. Redirects to /account if not logged in.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSiteModeContext } from '@/components/site/SiteShell'
import { useSiteAuth } from '@/hooks/useSiteAuth'

interface Reward {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  pointCost: number
  rewardType: string
  rewardValue: number | null
  redeemable: boolean
}

export default function RewardsPage() {
  const { slug } = useSiteModeContext()
  const { isAuthenticated, customer, isLoading: authLoading } = useSiteAuth(slug)
  const router = useRouter()

  const [points, setPoints] = useState(0)
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/account')
    }
  }, [authLoading, isAuthenticated, router])

  // Fetch rewards
  useEffect(() => {
    if (!slug || !isAuthenticated) return

    async function fetchRewards() {
      try {
        const res = await fetch(`/api/public/portal/${slug}/rewards`)
        if (!res.ok) {
          if (res.status === 401) {
            router.replace('/account')
            return
          }
          throw new Error('Failed to fetch rewards')
        }
        const data = await res.json()
        setPoints(data.points ?? 0)
        setRewards(
          (data.rewards ?? []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            name: r.name as string,
            description: r.description as string | null,
            imageUrl: r.imageUrl as string | null,
            pointCost: Number(r.pointCost),
            rewardType: r.rewardType as string,
            rewardValue: r.rewardValue != null ? Number(r.rewardValue) : null,
            redeemable: r.redeemable as boolean,
          })),
        )
      } catch {
        setError('Failed to load rewards.')
        // Fall back to points from auth hook
        setPoints(customer?.loyaltyPoints ?? 0)
      } finally {
        setLoading(false)
      }
    }

    fetchRewards()
  }, [slug, isAuthenticated, router, customer?.loyaltyPoints])

  // Loading
  if (authLoading || (isAuthenticated && loading)) {
    return (
      <div className="py-12 md:py-16 px-4 md:px-6">
        <div className="max-w-lg mx-auto">
          <div className="h-8 w-36 rounded-lg mb-8 animate-pulse" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
          <div className="h-32 rounded-xl mb-8 animate-pulse" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-20 rounded-xl animate-pulse"
                style={{ backgroundColor: 'var(--site-bg-secondary)' }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return null

  return (
    <div className="py-12 md:py-16 px-4 md:px-6">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/account"
            className="p-2 rounded-lg transition-colors hover:opacity-80"
            style={{ color: 'var(--site-text-muted)' }}
            aria-label="Back to account"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <h1
            className="text-2xl md:text-3xl"
            style={{
              fontFamily: 'var(--site-heading-font)',
              fontWeight: 'var(--site-heading-weight, 700)',
            }}
          >
            Rewards
          </h1>
        </div>

        {/* Points Balance */}
        <div
          className="rounded-xl p-8 mb-8 text-center"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--site-brand) 8%, var(--site-bg))',
            border: '1px solid color-mix(in srgb, var(--site-brand) 20%, transparent)',
          }}
        >
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--site-text-muted)' }}>
            Your Points Balance
          </p>
          <p
            className="text-5xl font-bold"
            style={{ color: 'var(--site-brand)' }}
          >
            {points.toLocaleString()}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--site-text-muted)' }}>
            points
          </p>
        </div>

        {/* How to earn */}
        <div
          className="rounded-xl p-5 mb-8"
          style={{
            backgroundColor: 'var(--site-bg-secondary)',
            border: '1px solid var(--site-border)',
          }}
        >
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--site-text)' }}>
            How to Earn
          </h2>
          <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
            Earn <strong style={{ color: 'var(--site-text)' }}>1 point</strong> for every{' '}
            <strong style={{ color: 'var(--site-text)' }}>$1 spent</strong>. Points are
            automatically added to your account after each order.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-6 px-4 py-3 rounded-lg text-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, #ef4444 10%, transparent)',
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}

        {/* Available Rewards */}
        {rewards.length > 0 && (
          <>
            <h2
              className="text-lg font-semibold mb-4"
              style={{ color: 'var(--site-text)' }}
            >
              Available Rewards
            </h2>
            <div className="space-y-3">
              {rewards.map((reward) => (
                <div
                  key={reward.id}
                  className="p-4 rounded-xl flex items-center gap-4"
                  style={{
                    backgroundColor: 'var(--site-bg-secondary)',
                    border: '1px solid var(--site-border)',
                    opacity: reward.redeemable ? 1 : 0.5,
                  }}
                >
                  {reward.imageUrl && (
                    <img
                      src={reward.imageUrl}
                      alt={reward.name}
                      className="w-12 h-12 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--site-text)' }}>
                      {reward.name}
                    </p>
                    {reward.description && (
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--site-text-muted)' }}>
                        {reward.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--site-brand)' }}>
                      {reward.pointCost.toLocaleString()}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--site-text-muted)' }}>pts</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Empty rewards */}
        {rewards.length === 0 && !error && (
          <div
            className="text-center py-8 px-4 rounded-xl"
            style={{
              backgroundColor: 'var(--site-bg-secondary)',
              border: '1px solid var(--site-border)',
            }}
          >
            <svg
              className="w-10 h-10 mx-auto mb-3"
              style={{ color: 'var(--site-text-muted)' }}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
            <p className="text-sm font-medium" style={{ color: 'var(--site-text)' }}>
              Rewards Coming Soon
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--site-text-muted)' }}>
              Keep earning points — rewards will be available soon!
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

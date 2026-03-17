'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { RewardCard } from '@/components/portal/RewardCard'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Reward {
  id: string
  name: string
  description: string
  imageUrl: string | null
  pointCost: number
  rewardType: string
  rewardValue: unknown
  redeemable: boolean
  customerRedemptions: number
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RewardsPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [points, setPoints] = useState<number>(0)
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Redeem state
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState<string | null>(null)
  const [redemptionCode, setRedemptionCode] = useState<string | null>(null)
  const [redemptionExpiry, setRedemptionExpiry] = useState<string | null>(null)

  const fetchRewards = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/portal/${slug}/rewards`)
      if (res.status === 401) {
        // Not authenticated — redirect to my-orders for login
        router.push(`/portal/${slug}/my-orders`)
        return
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load rewards')
      setPoints(json.points ?? 0)
      setRewards(json.rewards ?? [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [slug, router])

  useEffect(() => {
    fetchRewards()
  }, [fetchRewards])

  // ─── Redeem handler ───────────────────────────────────────────────────────

  const handleRedeem = async (rewardId: string) => {
    setRedeemingId(rewardId)
    setError(null)
    try {
      const res = await fetch(`/api/public/portal/${slug}/rewards/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to redeem reward')

      setRedemptionCode(json.redemptionCode)
      setRedemptionExpiry(json.expiresAt)
      setPoints(json.pointsRemaining ?? 0)
      setShowConfirm(null)

      // Refresh rewards list to update redeemable states
      const refreshRes = await fetch(`/api/public/portal/${slug}/rewards`)
      if (refreshRes.ok) {
        const refreshJson = await refreshRes.json()
        setRewards(refreshJson.rewards ?? [])
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRedeemingId(null)
    }
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-500 text-center">Loading rewards...</p>
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Points Balance */}
      <div
        className="rounded-xl p-6 text-center shadow-sm"
        style={{
          background: `linear-gradient(135deg, var(--brand-primary, #3B82F6), var(--brand-secondary, #6366F1))`,
        }}
      >
        <p className="text-white/80 text-sm font-medium mb-1">Your Points Balance</p>
        <p className="text-4xl font-bold text-white">{points.toLocaleString()}</p>
        <p className="text-white/60 text-xs mt-1">points available</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Redemption code display */}
      {redemptionCode && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <p className="text-green-700 font-semibold text-sm mb-2">Reward Redeemed!</p>
          <p className="text-3xl font-bold text-green-800 tracking-wider font-mono mb-2">
            {redemptionCode}
          </p>
          <p className="text-xs text-green-600">
            Show this code when you visit.
            {redemptionExpiry && (
              <> Valid until {new Date(redemptionExpiry).toLocaleDateString()}.</>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setRedemptionCode(null)
              setRedemptionExpiry(null)
            }}
            className="mt-3 text-sm text-green-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Rewards Grid */}
      {rewards.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-gray-600">No rewards available at this time. Check back soon!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {rewards.map((reward) => (
            <RewardCard
              key={reward.id}
              name={reward.name}
              description={reward.description}
              pointCost={Number(reward.pointCost)}
              imageUrl={reward.imageUrl}
              canRedeem={reward.redeemable}
              onRedeem={() => setShowConfirm(reward.id)}
            />
          ))}
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Redemption</h3>
            <p className="text-sm text-gray-600 mb-1">
              Redeem{' '}
              <span className="font-medium">
                {rewards.find((r) => r.id === showConfirm)?.name}
              </span>
              ?
            </p>
            <p className="text-sm text-gray-600 mb-4">
              This will deduct{' '}
              <span className="font-semibold">
                {Number(
                  rewards.find((r) => r.id === showConfirm)?.pointCost ?? 0,
                ).toLocaleString()}{' '}
                points
              </span>{' '}
              from your balance.
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRedeem(showConfirm)}
                disabled={redeemingId === showConfirm}
                className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-primary, #3B82F6)' }}
              >
                {redeemingId === showConfirm ? 'Redeeming...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

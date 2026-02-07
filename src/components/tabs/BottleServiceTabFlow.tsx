'use client'

import { useState, useEffect } from 'react'

interface BottleServiceTier {
  id: string
  name: string
  description: string | null
  color: string
  depositAmount: number
  minimumSpend: number
  autoGratuityPercent: number | null
  isActive: boolean
}

interface BottleServiceTabFlowProps {
  orderId: string
  locationId: string
  readerId: string
  employeeId: string
  onComplete: (result: {
    approved: boolean
    tier: BottleServiceTier
    cardholderName?: string
    cardType: string
    cardLast4: string
  }) => void
  onCancel: () => void
}

type FlowState = 'select_tier' | 'authorizing' | 'done' | 'error'

export default function BottleServiceTabFlow({
  orderId,
  locationId,
  readerId,
  employeeId,
  onComplete,
  onCancel,
}: BottleServiceTabFlowProps) {
  const [tiers, setTiers] = useState<BottleServiceTier[]>([])
  const [selectedTier, setSelectedTier] = useState<BottleServiceTier | null>(null)
  const [flowState, setFlowState] = useState<FlowState>('select_tier')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load tiers on mount
  useEffect(() => {
    fetch(`/api/bottle-service/tiers?locationId=${locationId}`)
      .then(res => res.json())
      .then(json => {
        setTiers(json.data || [])
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load bottle service tiers')
        setLoading(false)
      })
  }, [locationId])

  const handleSelectTier = async (tier: BottleServiceTier) => {
    setSelectedTier(tier)
    setFlowState('authorizing')
    setError(null)

    try {
      const res = await fetch(`/api/orders/${orderId}/bottle-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readerId,
          employeeId,
          tierId: tier.id,
        }),
      })

      const json = await res.json()

      if (!res.ok || !json.data?.approved) {
        setFlowState('error')
        setError(json.data?.error?.message || json.error || 'Deposit pre-authorization failed')
        return
      }

      setFlowState('done')
      onComplete({
        approved: true,
        tier,
        cardholderName: json.data.cardholderName,
        cardType: json.data.cardType,
        cardLast4: json.data.cardLast4,
      })
    } catch {
      setFlowState('error')
      setError('Failed to open bottle service tab')
    }
  }

  const handleRetry = () => {
    setFlowState('select_tier')
    setSelectedTier(null)
    setError(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-white/60 text-sm">Loading tiers...</p>
      </div>
    )
  }

  if (tiers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-white/60 text-sm">No bottle service tiers configured.</p>
        <p className="text-white/40 text-xs">Add tiers in Settings &gt; Payments &gt; Bottle Service</p>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-white/60 hover:text-white/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  // Tier selection screen
  if (flowState === 'select_tier') {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="text-center mb-2">
          <h3 className="text-lg font-semibold text-white">Bottle Service</h3>
          <p className="text-white/50 text-sm">Select a tier to open tab</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {tiers.map(tier => (
            <button
              key={tier.id}
              onClick={() => handleSelectTier(tier)}
              className="relative overflow-hidden rounded-xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: `linear-gradient(135deg, ${tier.color}33, ${tier.color}11)`,
                border: `1px solid ${tier.color}66`,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-bold text-lg">{tier.name}</span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-bold"
                  style={{ backgroundColor: tier.color, color: '#000' }}
                >
                  ${tier.depositAmount.toLocaleString()}
                </span>
              </div>
              {tier.description && (
                <p className="text-white/50 text-sm mb-2">{tier.description}</p>
              )}
              <div className="flex gap-4 text-xs text-white/40">
                <span>Min Spend: ${tier.minimumSpend.toLocaleString()}</span>
                {tier.autoGratuityPercent && (
                  <span>Auto-Grat: {tier.autoGratuityPercent}%</span>
                )}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-white/60 hover:text-white/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  // Authorizing screen
  if (flowState === 'authorizing') {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse"
          style={{ backgroundColor: selectedTier?.color || '#D4AF37' }}
        >
          <svg className="w-8 h-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        </div>
        <p className="text-white font-semibold">{selectedTier?.name} — Authorizing Deposit</p>
        <p className="text-white/50 text-sm">
          Pre-authorizing ${selectedTier?.depositAmount.toLocaleString()}...
        </p>
        <p className="text-white/30 text-xs">Please have customer tap or insert card</p>
      </div>
    )
  }

  // Error screen
  if (flowState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <p className="text-red-400 font-semibold">Authorization Failed</p>
        <p className="text-white/50 text-sm text-center">{error}</p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-white/60 hover:text-white/80 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return null
}

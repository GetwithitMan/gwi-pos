'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getActivePricingRules, getPricingRuleEndTime } from '@/lib/settings'
import type { PricingRule } from '@/lib/settings'

/**
 * Customer-facing countdown banner for active pricing rules.
 * Only shows rules with showCfdCountdown=true.
 * Fetches settings on mount, refreshes every 60s.
 */
export function CFDPricingCountdown() {
  const [rules, setRules] = useState<PricingRule[]>([])
  const [bannerRule, setBannerRule] = useState<PricingRule | null>(null)
  const [remaining, setRemaining] = useState(0)
  const rulesRef = useRef<PricingRule[]>([])

  // Fetch settings
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/settings')
        .then(res => res.json())
        .then(raw => {
          if (cancelled) return
          const s = (raw.data ?? raw).settings || (raw.data ?? raw)
          const r: PricingRule[] = s?.pricingRules ?? []
          setRules(r)
          rulesRef.current = r
        })
        .catch(() => {})
    }
    load()
    // Re-fetch every 5 minutes in case settings changed
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const recompute = useCallback(() => {
    const active = getActivePricingRules(rulesRef.current)
    // Only show rules with showCfdCountdown enabled and that are discounts (not increases)
    const cfdRules = active.filter(r =>
      r.showCfdCountdown &&
      r.adjustmentType !== 'percent-increase' &&
      r.adjustmentType !== 'fixed-increase'
    )

    if (cfdRules.length === 0) {
      setBannerRule(null)
      return
    }

    const top = cfdRules[0]
    setBannerRule(top)

    const endTime = getPricingRuleEndTime(top)
    if (endTime) {
      setRemaining(Math.max(0, Math.ceil((endTime.getTime() - Date.now()) / 60000)))
    } else {
      setRemaining(0)
    }
  }, [])

  useEffect(() => {
    rulesRef.current = rules
    recompute()
    const interval = setInterval(recompute, 60000)
    return () => clearInterval(interval)
  }, [rules, recompute])

  if (!bannerRule) return null

  const color = /^#[0-9a-fA-F]{6}$/.test(bannerRule.color) ? bannerRule.color : '#10b981'
  const timeText = remaining <= 0
    ? 'ending soon'
    : remaining >= 60
      ? `${Math.floor(remaining / 60)}h ${remaining % 60 > 0 ? `${remaining % 60}m` : ''} left`
      : `${remaining} min left`

  return (
    <div
      className="text-center py-3 px-6 text-white font-medium text-lg"
      style={{ backgroundColor: `${color}cc` }}
    >
      <span className="mr-3">{bannerRule.name}</span>
      <span className="opacity-80">{timeText}</span>
    </div>
  )
}

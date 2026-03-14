'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { getActivePricingRules, getPricingRuleEndTime, DEFAULT_SETTINGS } from '@/lib/settings'
import type { PricingRule } from '@/lib/settings'
import { useSocket } from '@/hooks/useSocket'

/**
 * Compact banner shown at the top of the POS when pricing rules are active.
 * Self-contained: fetches settings from /api/settings on mount.
 * Displays the highest-priority active rule and a countdown to when it ends.
 * Refreshes every 60 seconds and immediately on settings:updated socket event.
 */
export function HappyHourBanner() {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([])
  const [bannerRule, setBannerRule] = useState<PricingRule | null>(null)
  const [activeCount, setActiveCount] = useState(0)
  const [remainingMinutes, setRemainingMinutes] = useState(0)
  const [scopeHint, setScopeHint] = useState('')
  const rulesRef = useRef<PricingRule[]>([])
  const { socket } = useSocket()

  // Fetch settings on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then(res => res.json())
      .then(raw => {
        if (cancelled) return
        const data = raw.data ?? raw
        const s = data.settings || data
        const rules: PricingRule[] = s.pricingRules ?? []
        setPricingRules(rules)
        rulesRef.current = rules
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const recompute = useCallback(() => {
    const rules = rulesRef.current
    if (!rules.length) {
      setBannerRule(null)
      setActiveCount(0)
      return
    }
    const active = getActivePricingRules(rules)
    setActiveCount(active.length)
    if (active.length === 0) {
      setBannerRule(null)
      return
    }

    // Banner selection per contract:
    // Prefer highest-priority active rule with appliesTo: 'all'
    const globalRule = active.find(r => r.appliesTo === 'all')
    if (globalRule) {
      setBannerRule(globalRule)
      setScopeHint('')
    } else {
      // Show highest-priority scoped rule
      const topScoped = active[0]
      // Suppress banner for single-item-specific rules
      if (topScoped.appliesTo === 'items' && topScoped.itemIds.length <= 1) {
        setBannerRule(null)
        return
      }
      setBannerRule(topScoped)
      // Generate scope hint
      if (topScoped.appliesTo === 'categories') {
        setScopeHint(` - ${topScoped.categoryIds.length} categories`)
      } else if (topScoped.appliesTo === 'items') {
        setScopeHint(` - ${topScoped.itemIds.length} items`)
      } else {
        setScopeHint('')
      }
    }

    // Update countdown for the selected banner rule
    const selectedRule = globalRule || active[0]
    if (selectedRule) {
      const endTime = getPricingRuleEndTime(selectedRule)
      if (endTime) {
        const diffMs = endTime.getTime() - Date.now()
        setRemainingMinutes(Math.max(0, Math.ceil(diffMs / 60000)))
      } else {
        setRemainingMinutes(0)
      }
    }
  }, [])

  // Recompute on rules change, then every 60s
  useEffect(() => {
    rulesRef.current = pricingRules
    recompute()
    const interval = setInterval(recompute, 60000)
    return () => clearInterval(interval)
  }, [pricingRules, recompute])

  // On settings:updated socket event, refetch and force immediate recompute
  useEffect(() => {
    if (!socket) return
    const handler = (payload: any) => {
      const s = payload?.settings
      if (s?.pricingRules) {
        setPricingRules(s.pricingRules)
        rulesRef.current = s.pricingRules
        recompute()
      }
    }
    socket.on('settings:updated', handler)
    return () => { socket.off('settings:updated', handler) }
  }, [socket, recompute])

  if (!bannerRule) return null

  // Use rule color as background with opacity, fallback to emerald-600
  const ruleColor = /^#[0-9a-fA-F]{6}$/.test(bannerRule.color) ? bannerRule.color : '#059669'

  // Color transitions: amber when <= 15 min remaining
  const isClosing = remainingMinutes > 0 && remainingMinutes <= 15
  const bgStyle = isClosing
    ? 'background-color: rgb(217 119 6 / 0.9)'
    : `background-color: ${ruleColor}e6`

  const formatRemaining = () => {
    if (remainingMinutes <= 0) return 'ending now'
    if (remainingMinutes >= 60) {
      const hours = Math.floor(remainingMinutes / 60)
      const mins = remainingMinutes % 60
      return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`
    }
    return `${remainingMinutes}m left`
  }

  const moreText = activeCount > 1 ? ` +${activeCount - 1} more` : ''

  return (
    <div
      className="text-white text-center py-1.5 px-4 text-sm font-medium flex items-center justify-center gap-2 shrink-0"
      style={{ backgroundColor: isClosing ? 'rgb(217 119 6 / 0.9)' : `${ruleColor}e6` }}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{bannerRule.name}{scopeHint}</span>
      {moreText && <span className="opacity-75">{moreText}</span>}
      <span className="opacity-75">-</span>
      <span className="opacity-90">{formatRemaining()}</span>
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'

interface UpsellSuggestion {
  ruleId: string
  ruleName: string
  suggestItemId: string
  suggestItemName: string
  suggestItemPrice: number
  message: string
  priority: number
}

interface UpsellPromptBannerProps {
  orderId: string | null | undefined
  locationId: string | undefined
  employeeId?: string | null
  itemCount: number
  onAddItem?: (menuItemId: string) => void
}

/**
 * Upsell prompt banner.
 *
 * After order items change, evaluates upsell rules and shows suggestion cards
 * offering to add items. Tracks shown/accepted/dismissed events for analytics.
 * Only active when upsellPrompts.enabled and showOnItemAdd are true in settings.
 */
export function UpsellPromptBanner({
  orderId,
  locationId,
  employeeId,
  itemCount,
  onAddItem,
}: UpsellPromptBannerProps) {
  const [suggestions, setSuggestions] = useState<UpsellSuggestion[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetchKeyRef = useRef<string>('')

  const fetchSuggestions = useCallback(async () => {
    if (!orderId || orderId.startsWith('temp-') || itemCount < 1) {
      setSuggestions([])
      return
    }

    const fetchKey = `${orderId}-${itemCount}`
    if (fetchKey === lastFetchKeyRef.current) return
    lastFetchKeyRef.current = fetchKey

    try {
      const res = await fetch(`/api/orders/${orderId}/upsell-suggestions`)
      if (!res.ok) {
        setSuggestions([])
        return
      }
      const data = await res.json()
      setSuggestions(data.data?.suggestions ?? [])
    } catch {
      // Silent fail — upsell suggestions are non-critical
      setSuggestions([])
    }
  }, [orderId, itemCount])

  // Debounce suggestion checks after item changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchSuggestions, 600)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [fetchSuggestions])

  // Reset dismissed set when order changes
  useEffect(() => {
    setDismissed(new Set())
    lastFetchKeyRef.current = ''
  }, [orderId])

  // Fire-and-forget event tracking
  const trackEvent = useCallback((
    ruleId: string,
    action: 'shown' | 'accepted' | 'dismissed',
    suggestion: UpsellSuggestion,
    addedAmount?: number,
  ) => {
    if (!locationId || !orderId) return
    void fetch('/api/upsell-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        ruleId,
        orderId,
        employeeId: employeeId || null,
        suggestedItemId: suggestion.suggestItemId,
        suggestedItemName: suggestion.suggestItemName,
        suggestedItemPrice: suggestion.suggestItemPrice,
        action,
        addedAmount: addedAmount ?? null,
      }),
    }).catch(console.error)
  }, [locationId, orderId, employeeId])

  // Track 'shown' events once per suggestion
  const shownRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const s of suggestions) {
      const key = `${orderId}-${s.ruleId}`
      if (!shownRef.current.has(key)) {
        shownRef.current.add(key)
        trackEvent(s.ruleId, 'shown', s)
      }
    }
  }, [suggestions, orderId, trackEvent])

  // Reset shown tracking on order change
  useEffect(() => {
    shownRef.current = new Set()
  }, [orderId])

  const handleAccept = async (suggestion: UpsellSuggestion) => {
    if (adding) return
    setAdding(suggestion.ruleId)

    try {
      // Call parent handler to add the item
      if (onAddItem) {
        onAddItem(suggestion.suggestItemId)
      }

      // Track acceptance
      trackEvent(suggestion.ruleId, 'accepted', suggestion, suggestion.suggestItemPrice)

      // Remove suggestion from list
      setSuggestions(prev => prev.filter(s => s.ruleId !== suggestion.ruleId))
      // Reset fetch key to re-evaluate on next item change
      lastFetchKeyRef.current = ''
    } finally {
      setAdding(null)
    }
  }

  const handleDismiss = (suggestion: UpsellSuggestion) => {
    setDismissed(prev => new Set(prev).add(suggestion.ruleId))
    trackEvent(suggestion.ruleId, 'dismissed', suggestion)
  }

  // Filter out dismissed suggestions
  const visible = suggestions.filter(s => !dismissed.has(s.ruleId))

  if (visible.length === 0) return null

  return (
    <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {visible.map(suggestion => (
        <div
          key={suggestion.ruleId}
          style={{
            padding: '10px 14px',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(99, 102, 241, 0.08) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'upsellFadeIn 0.25s ease-out',
          }}
        >
          {/* Price badge */}
          <div style={{
            flexShrink: 0,
            background: 'rgba(59, 130, 246, 0.2)',
            borderRadius: '8px',
            padding: '6px 10px',
            textAlign: 'center',
            minWidth: '60px',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#3b82f6', lineHeight: 1.1 }}>
              {formatCurrency(suggestion.suggestItemPrice)}
            </div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>
              upsell
            </div>
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', lineHeight: 1.2 }}>
              {suggestion.suggestItemName}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', lineHeight: 1.3 }}>
              {suggestion.message || `Add ${suggestion.suggestItemName}?`}
            </div>
          </div>

          {/* Actions */}
          <div style={{ flexShrink: 0, display: 'flex', gap: '6px' }}>
            <button
              onClick={() => handleDismiss(suggestion)}
              disabled={adding === suggestion.ruleId}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                color: '#94a3b8',
                fontSize: '11px',
                fontWeight: 600,
                padding: '6px 10px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              No Thanks
            </button>
            <button
              onClick={() => handleAccept(suggestion)}
              disabled={adding === suggestion.ruleId}
              style={{
                background: adding === suggestion.ruleId
                  ? 'rgba(59, 130, 246, 0.15)'
                  : 'rgba(59, 130, 246, 0.25)',
                border: '1px solid rgba(59, 130, 246, 0.5)',
                borderRadius: '6px',
                color: '#3b82f6',
                fontSize: '11px',
                fontWeight: 700,
                padding: '6px 12px',
                cursor: adding === suggestion.ruleId ? 'wait' : 'pointer',
                transition: 'all 0.15s ease',
                opacity: adding === suggestion.ruleId ? 0.6 : 1,
              }}
            >
              {adding === suggestion.ruleId ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      ))}

      {/* Keyframe for fade-in */}
      <style>{`
        @keyframes upsellFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

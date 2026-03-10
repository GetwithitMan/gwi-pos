'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'

interface ComboSuggestion {
  comboTemplateId: string
  comboName: string
  menuItemId: string
  basePrice: number
  savings: number
  matchedItemIds: string[]
  matchedItems: { id: string; name: string; price: number }[]
}

interface ComboSuggestionBannerProps {
  orderId: string | null | undefined
  itemCount: number
  hasSentItems: boolean
}

/**
 * Combo auto-suggest banner.
 *
 * After order items change, checks if the current items match any combo
 * templates and shows a dismissible banner offering to convert for savings.
 * Only checks when the order has 2+ unsent items.
 */
export function ComboSuggestionBanner({
  orderId,
  itemCount,
  hasSentItems,
}: ComboSuggestionBannerProps) {
  const [suggestions, setSuggestions] = useState<ComboSuggestion[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetchKeyRef = useRef<string>('')

  const fetchSuggestions = useCallback(async () => {
    if (!orderId || orderId.startsWith('temp-') || itemCount < 2 || hasSentItems) {
      setSuggestions([])
      return
    }

    const fetchKey = `${orderId}-${itemCount}`
    if (fetchKey === lastFetchKeyRef.current) return
    lastFetchKeyRef.current = fetchKey

    try {
      const res = await fetch(`/api/orders/${orderId}/combo-suggestions`)
      if (!res.ok) {
        setSuggestions([])
        return
      }
      const data = await res.json()
      setSuggestions(data.data?.suggestions ?? [])
    } catch {
      // Silent fail — suggestions are non-critical
      setSuggestions([])
    }
  }, [orderId, itemCount, hasSentItems])

  // Debounce suggestion checks after item changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchSuggestions, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [fetchSuggestions])

  // Reset dismissed set when order changes
  useEffect(() => {
    setDismissed(new Set())
    lastFetchKeyRef.current = ''
  }, [orderId])

  const handleApply = async (suggestion: ComboSuggestion) => {
    if (!orderId || applying) return
    setApplying(suggestion.comboTemplateId)

    try {
      const res = await fetch(`/api/orders/${orderId}/apply-combo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comboTemplateId: suggestion.comboTemplateId,
          itemIds: suggestion.matchedItemIds,
        }),
      })

      if (res.ok) {
        // Remove this suggestion from the list
        setSuggestions(prev => prev.filter(s => s.comboTemplateId !== suggestion.comboTemplateId))
        // Reset fetch key so next item change re-checks
        lastFetchKeyRef.current = ''
      }
    } catch {
      // Silent fail
    } finally {
      setApplying(null)
    }
  }

  const handleDismiss = (comboTemplateId: string) => {
    setDismissed(prev => new Set(prev).add(comboTemplateId))
  }

  // Filter out dismissed suggestions
  const visible = suggestions.filter(s => !dismissed.has(s.comboTemplateId))

  if (visible.length === 0) return null

  return (
    <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {visible.map(suggestion => (
        <div
          key={suggestion.comboTemplateId}
          style={{
            padding: '10px 14px',
            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'fadeInUp 0.25s ease-out',
          }}
        >
          {/* Savings badge */}
          <div style={{
            flexShrink: 0,
            background: 'rgba(34, 197, 94, 0.2)',
            borderRadius: '8px',
            padding: '6px 10px',
            textAlign: 'center',
            minWidth: '60px',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#22c55e', lineHeight: 1.1 }}>
              {formatCurrency(suggestion.savings)}
            </div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>
              savings
            </div>
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', lineHeight: 1.2 }}>
              {suggestion.comboName}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', lineHeight: 1.3 }}>
              {suggestion.matchedItems.map(i => i.name).join(' + ')} → {formatCurrency(suggestion.basePrice)}
            </div>
          </div>

          {/* Actions */}
          <div style={{ flexShrink: 0, display: 'flex', gap: '6px' }}>
            <button
              onClick={() => handleDismiss(suggestion.comboTemplateId)}
              disabled={applying === suggestion.comboTemplateId}
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
              Skip
            </button>
            <button
              onClick={() => handleApply(suggestion)}
              disabled={applying === suggestion.comboTemplateId}
              style={{
                background: applying === suggestion.comboTemplateId
                  ? 'rgba(34, 197, 94, 0.15)'
                  : 'rgba(34, 197, 94, 0.25)',
                border: '1px solid rgba(34, 197, 94, 0.5)',
                borderRadius: '6px',
                color: '#22c55e',
                fontSize: '11px',
                fontWeight: 700,
                padding: '6px 12px',
                cursor: applying === suggestion.comboTemplateId ? 'wait' : 'pointer',
                transition: 'all 0.15s ease',
                opacity: applying === suggestion.comboTemplateId ? 0.6 : 1,
              }}
            >
              {applying === suggestion.comboTemplateId ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </div>
      ))}

      {/* Keyframe for fade-in */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

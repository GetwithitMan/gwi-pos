'use client'

import { useState, useRef, useEffect } from 'react'
import { useScale } from '@/hooks/useScale'

interface ScaleStatusBadgeProps {
  scaleId: string | null | undefined
  scaleName?: string
}

/**
 * Small badge showing scale connection status in the POS header.
 * Green dot = connected, red dot = disconnected.
 * Only renders when a scale is bound to the terminal.
 */
export function ScaleStatusBadge({ scaleId, scaleName }: ScaleStatusBadgeProps) {
  const { weight, unit, stable, connected } = useScale(scaleId)
  const [showTooltip, setShowTooltip] = useState(false)
  const badgeRef = useRef<HTMLDivElement>(null)

  // Close tooltip on outside click
  useEffect(() => {
    if (!showTooltip) return
    const handler = (e: MouseEvent) => {
      if (badgeRef.current && !badgeRef.current.contains(e.target as Node)) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTooltip])

  if (!scaleId) return null

  return (
    <div ref={badgeRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        title={connected ? 'Scale connected' : 'Scale disconnected'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          height: '30px',
          padding: '0 8px',
          background: connected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${connected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
          borderRadius: '6px',
          cursor: 'pointer',
          color: connected ? '#4ade80' : '#f87171',
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        {/* Scale icon */}
        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
        </svg>
        {/* Status dot */}
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: connected ? '#22c55e' : '#ef4444',
          display: 'inline-block',
          boxShadow: connected ? '0 0 4px rgba(34, 197, 94, 0.5)' : '0 0 4px rgba(239, 68, 68, 0.5)',
        }} />
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: '160px',
          padding: '10px 12px',
          background: 'rgba(15, 23, 42, 0.98)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '10px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
          zIndex: 1000,
          fontSize: '12px',
        }}>
          <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '6px' }}>
            {scaleName || 'Scale'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
            }} />
            <span style={{ color: connected ? '#4ade80' : '#f87171' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          {connected && weight !== null && (
            <div style={{ color: '#94a3b8', marginTop: '4px' }}>
              Last: <span style={{ color: stable ? '#e2e8f0' : '#eab308', fontFamily: 'monospace' }}>
                {weight.toFixed(2)} {unit}
              </span>
              {stable && <span style={{ color: '#22c55e', marginLeft: '4px' }}>(stable)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

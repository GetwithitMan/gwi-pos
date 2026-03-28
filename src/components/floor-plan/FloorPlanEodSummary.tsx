'use client'

/**
 * FloorPlanEodSummary — End-of-day summary overlay shown after eod:reset-complete socket event.
 * Extracted from FloorPlanHome.tsx to reduce component complexity.
 */

import { memo } from 'react'

interface EodSummaryData {
  cancelledDrafts: number
  rolledOverOrders: number
  tablesReset: number
  businessDay: string
}

interface FloorPlanEodSummaryProps {
  summary: EodSummaryData
  onDismiss: () => void
}

export const FloorPlanEodSummary = memo(function FloorPlanEodSummary({ summary, onDismiss }: FloorPlanEodSummaryProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.97)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '12px',
        padding: '20px 24px',
        minWidth: '280px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      }}
    >
      <p style={{ fontSize: '14px', fontWeight: 700, color: '#f1f5f9', marginBottom: '12px' }}>
        End of Day Reset
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <li style={{ fontSize: '13px', color: '#94a3b8' }}>
          <span style={{ color: '#4ade80', marginRight: '8px' }}>✓</span>
          {summary.cancelledDrafts} draft {summary.cancelledDrafts === 1 ? 'order' : 'orders'} cancelled
        </li>
        <li style={{ fontSize: '13px', color: '#94a3b8' }}>
          <span style={{ color: '#60a5fa', marginRight: '8px' }}>↻</span>
          {summary.rolledOverOrders} {summary.rolledOverOrders === 1 ? 'order' : 'orders'} rolled to next business day
        </li>
        <li style={{ fontSize: '13px', color: '#94a3b8' }}>
          <span style={{ color: '#a78bfa', marginRight: '8px' }}>⊞</span>
          {summary.tablesReset} {summary.tablesReset === 1 ? 'table' : 'tables'} reset to available
        </li>
      </ul>
      <button
        onClick={onDismiss}
        style={{
          width: '100%',
          padding: '8px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'rgba(255, 255, 255, 0.06)',
          color: '#94a3b8',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  )
})

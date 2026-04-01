'use client'

import { memo } from 'react'

interface OrderPanelPagerProps {
  pagerNumber?: string | null
  pagerStatus?: string | null
  orderId?: string | null
  notificationProvidersActive?: boolean
  assigningPager: boolean
  unassigningPager: boolean
  onAssignPager: (replaceExisting?: boolean) => void
  onUnassignPager: () => void
}

export const OrderPanelPager = memo(function OrderPanelPager({
  pagerNumber,
  pagerStatus,
  orderId,
  notificationProvidersActive,
  assigningPager,
  unassigningPager,
  onAssignPager,
  onUnassignPager,
}: OrderPanelPagerProps) {
  if (pagerNumber) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '4px',
        padding: '2px 8px', background: 'rgba(20, 184, 166, 0.15)',
        border: '1px solid rgba(20, 184, 166, 0.3)', borderRadius: '4px',
      }}>
        <svg width="12" height="12" fill="none" stroke="#14b8a6" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#14b8a6' }}>
          Pager #{pagerNumber}
        </span>
        {pagerStatus && (
          <span style={{
            fontSize: '9px', fontWeight: 600,
            color: pagerStatus === 'active' ? '#10b981' : '#94a3b8',
            textTransform: 'uppercase',
          }}>
            {pagerStatus}
          </span>
        )}
        {/* Change Pager button */}
        <button
          onClick={() => onAssignPager(true)}
          disabled={assigningPager}
          title="Change Pager"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '18px', height: '18px', padding: 0,
            background: 'rgba(20, 184, 166, 0.2)', border: '1px solid rgba(20, 184, 166, 0.3)',
            borderRadius: '3px', cursor: assigningPager ? 'wait' : 'pointer',
            opacity: assigningPager ? 0.5 : 1,
          }}
        >
          <svg width="10" height="10" fill="none" stroke="#14b8a6" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        {/* Unassign Pager button */}
        <button
          onClick={onUnassignPager}
          disabled={unassigningPager}
          title="Unassign Pager"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '18px', height: '18px', padding: 0,
            background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '3px', cursor: unassigningPager ? 'wait' : 'pointer',
            opacity: unassigningPager ? 0.5 : 1,
          }}
        >
          <svg width="10" height="10" fill="none" stroke="#ef4444" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  if (!notificationProvidersActive || !orderId || orderId.startsWith('temp-')) {
    return null
  }

  return (
    <button
      onClick={() => onAssignPager(false)}
      disabled={assigningPager}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '4px',
        fontSize: '11px', fontWeight: 500, color: '#14b8a6',
        padding: '2px 8px', background: 'rgba(20, 184, 166, 0.1)',
        border: '1px solid rgba(20, 184, 166, 0.2)', borderRadius: '4px',
        cursor: assigningPager ? 'wait' : 'pointer', opacity: assigningPager ? 0.6 : 1,
      }}
    >
      <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      {assigningPager ? 'Assigning...' : 'Assign Pager'}
    </button>
  )
})

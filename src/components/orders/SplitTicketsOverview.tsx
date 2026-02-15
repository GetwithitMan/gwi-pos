'use client'

import { memo, useState } from 'react'

export interface SplitTicketSummary {
  id: string
  splitIndex: number | null
  displayNumber: string | null
  total: number
  status: string
  isPaid: boolean
}

export interface SplitTicketsOverviewProps {
  parentOrderId: string
  orderNumber: number
  tableName: string
  splitOrders: SplitTicketSummary[]
  onSelectSplit: (splitOrderId: string) => void
  onEditSplits: () => void
  onMergeBack: () => void
  onTransferItems: () => void
  onTransferTable: () => void
  onClose: () => void
}

export const SplitTicketsOverview = memo(function SplitTicketsOverview({
  parentOrderId,
  orderNumber,
  tableName,
  splitOrders,
  onSelectSplit,
  onEditSplits,
  onMergeBack,
  onTransferItems,
  onTransferTable,
  onClose,
}: SplitTicketsOverviewProps) {
  const [showTransferMenu, setShowTransferMenu] = useState(false)

  const hasPaidSplits = splitOrders.some(s => s.isPaid)

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 400,
        zIndex: 40,
        background: 'rgba(15, 15, 25, 0.98)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#f1f5f9',
              lineHeight: 1.3,
            }}>
              Order #{orderNumber} — {tableName}
            </div>
            <div style={{
              fontSize: '13px',
              color: '#64748b',
              marginTop: '4px',
            }}>
              {splitOrders.length} Split Ticket{splitOrders.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#94a3b8',
              cursor: 'pointer',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Cards list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        {splitOrders.map(split => (
          <button
            key={split.id}
            onClick={() => onSelectSplit(split.id)}
            style={{
              background: 'rgba(30, 30, 46, 0.9)',
              border: `1px solid ${split.isPaid ? 'rgba(34, 197, 94, 0.25)' : 'rgba(139, 92, 246, 0.25)'}`,
              borderRadius: '12px',
              padding: '14px 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              width: '100%',
              textAlign: 'left',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(40, 40, 56, 0.95)'
              e.currentTarget.style.boxShadow = `0 0 16px ${split.isPaid ? 'rgba(34, 197, 94, 0.15)' : 'rgba(139, 92, 246, 0.15)'}`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(30, 30, 46, 0.9)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Display number */}
              <span style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#f1f5f9',
              }}>
                {split.displayNumber ?? `Split ${(split.splitIndex ?? 0) + 1}`}
              </span>
              {/* Status badge */}
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px',
                background: split.isPaid ? 'rgba(34, 197, 94, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                color: split.isPaid ? '#4ade80' : '#fbbf24',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {split.isPaid ? 'Paid' : 'Unpaid'}
              </span>
            </div>
            {/* Total */}
            <span style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#f1f5f9',
            }}>
              ${split.total.toFixed(2)}
            </span>
          </button>
        ))}
      </div>

      {/* Action bar */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        gap: '8px',
        position: 'relative',
      }}>
        {/* Edit Splits */}
        <button
          onClick={onEditSplits}
          style={{
            flex: 1,
            padding: '12px 8px',
            borderRadius: '10px',
            border: 'none',
            background: '#8b5cf6',
            color: 'white',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Edit Splits
        </button>

        {/* Transfer */}
        <div style={{ flex: 1, position: 'relative' }}>
          <button
            onClick={() => setShowTransferMenu(prev => !prev)}
            style={{
              width: '100%',
              padding: '12px 8px',
              borderRadius: '10px',
              border: 'none',
              background: '#3b82f6',
              color: 'white',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Transfer
          </button>

          {/* Transfer sub-menu */}
          {showTransferMenu && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: '6px',
              background: 'rgba(25, 25, 40, 0.98)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)',
              overflow: 'hidden',
              zIndex: 50,
            }}>
              <button
                onClick={() => { setShowTransferMenu(false); onTransferItems() }}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Transfer Items
              </button>
              <button
                onClick={() => { setShowTransferMenu(false); onTransferTable() }}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#e2e8f0',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
                </svg>
                Transfer Table
              </button>
              <div
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  color: '#475569',
                  fontSize: '13px',
                  fontWeight: 600,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Transfer to Tab
                </div>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#475569',
                }}>
                  Coming soon
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Merge Back */}
        <div style={{ flex: 1, position: 'relative' }}>
          <button
            onClick={hasPaidSplits ? undefined : onMergeBack}
            disabled={hasPaidSplits}
            style={{
              width: '100%',
              padding: '12px 8px',
              borderRadius: '10px',
              border: hasPaidSplits
                ? '1px solid rgba(255, 255, 255, 0.06)'
                : '1px solid rgba(239, 68, 68, 0.4)',
              background: hasPaidSplits
                ? 'rgba(255, 255, 255, 0.04)'
                : 'transparent',
              color: hasPaidSplits ? '#475569' : '#f87171',
              fontSize: '13px',
              fontWeight: 700,
              cursor: hasPaidSplits ? 'not-allowed' : 'pointer',
              opacity: hasPaidSplits ? 0.6 : 1,
            }}
            title={hasPaidSplits ? 'Cannot merge — some splits are paid' : 'Merge all splits back into one order'}
          >
            Merge Back
          </button>
        </div>
      </div>
    </div>
  )
})

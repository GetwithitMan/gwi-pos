'use client'

import { memo, useState } from 'react'
import { ReaderStatusIndicator } from '@/components/payment/ReaderStatusIndicator'
import { SwapConfirmationModal } from '@/components/payment/SwapConfirmationModal'
import type { DatacapHookReturn } from './order-panel-actions-types'

export interface PaymentProcessorViewProps {
  totalToCharge: number
  tipAmount: number
  setTipAmount: (amount: number) => void
  tipBasis: number
  displaySubtotal: number
  displayTotal: number
  datacap: DatacapHookReturn
  onCancel: () => void
  onCollect: () => void
  onPayCash?: (method: 'cash') => void
  tipExemptAmount?: number
}

export const PaymentProcessorView = memo(function PaymentProcessorView({
  totalToCharge,
  tipAmount,
  setTipAmount,
  tipBasis,
  datacap,
  onCancel,
  onCollect,
  onPayCash,
}: PaymentProcessorViewProps) {
  const [customTip, setCustomTip] = useState('')
  const [showCustomTip, setShowCustomTip] = useState(false)

  const tipPercentages = [15, 18, 20, 25]

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
    setShowCustomTip(false)
  }

  return (
    <div
      style={{
        padding: '16px 20px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(15, 23, 42, 0.98)',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Amount Due */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          Amount Due
        </div>
        <div style={{ fontSize: '32px', fontWeight: 900, color: '#ffffff', fontFamily: 'monospace', marginTop: '4px' }}>
          ${totalToCharge.toFixed(2)}
        </div>
        {tipAmount > 0 && (
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            (includes ${tipAmount.toFixed(2)} tip)
          </div>
        )}
      </div>

      {/* Quick Tip Selection — only when idle */}
      {datacap.processingStatus === 'idle' && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
            Add Tip
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {tipPercentages.map((percent) => {
              const tipValue = tipBasis * (percent / 100)
              const isSelected = Math.abs(tipAmount - tipValue) < 0.01
              return (
                <button
                  key={percent}
                  onClick={() => setTipAmount(tipValue)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '8px',
                    border: isSelected ? '2px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: isSelected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: isSelected ? '#22d3ee' : '#e2e8f0' }}>
                    {percent}%
                  </div>
                  <div style={{ fontSize: '9px', color: isSelected ? '#67e8f9' : '#64748b', marginTop: '1px' }}>
                    ${tipValue.toFixed(2)}
                  </div>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button
              onClick={() => setTipAmount(0)}
              style={{
                flex: 1,
                padding: '6px',
                borderRadius: '6px',
                border: 'none',
                background: tipAmount === 0 ? 'rgba(100, 116, 139, 0.3)' : 'rgba(255, 255, 255, 0.03)',
                color: tipAmount === 0 ? '#ffffff' : '#64748b',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              No Tip
            </button>
            <button
              onClick={() => setShowCustomTip(true)}
              style={{
                flex: 1,
                padding: '6px',
                borderRadius: '6px',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.03)',
                color: '#64748b',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Custom
            </button>
          </div>

          {/* Custom Tip Input */}
          {showCustomTip && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              <input
                type="number"
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
                placeholder="0.00"
                autoFocus
                style={{
                  flex: 1,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(100, 116, 139, 0.3)',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  color: '#ffffff',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleCustomTip}
                style={{
                  padding: '6px 12px',
                  background: '#06b6d4',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reader Status */}
      <div style={{ marginBottom: '10px' }}>
        <ReaderStatusIndicator
          reader={datacap.reader}
          isOnline={datacap.isReaderOnline}
          processingStatus={datacap.processingStatus}
          onSwapClick={() => datacap.setShowSwapModal(true)}
          canSwap={datacap.canSwap}
        />
      </div>

      {/* Error Display */}
      {datacap.error && datacap.processingStatus === 'error' && (
        <div style={{
          padding: '8px 10px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          color: '#f87171',
          fontSize: '11px',
          marginBottom: '10px',
        }}>
          {datacap.error}
        </div>
      )}

      {/* Processing Status Text */}
      {datacap.isProcessing && (
        <div style={{
          textAlign: 'center',
          padding: '8px',
          marginBottom: '8px',
          fontSize: '13px',
          fontWeight: 600,
          color: datacap.processingStatus === 'waiting_card' ? '#fbbf24' : '#60a5fa',
        }}>
          {datacap.processingStatus === 'checking_reader' && '🔍 Verifying reader...'}
          {datacap.processingStatus === 'waiting_card' && '💳 Present card on reader...'}
          {datacap.processingStatus === 'authorizing' && '⏳ Authorizing...'}
        </div>
      )}

      {/* Approved Overlay */}
      {datacap.processingStatus === 'approved' && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          marginBottom: '8px',
          background: 'rgba(34, 197, 94, 0.15)',
          borderRadius: '10px',
          border: '1px solid rgba(34, 197, 94, 0.3)',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '4px' }}>✅</div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#4ade80' }}>APPROVED</div>
          <div style={{ fontSize: '11px', color: '#86efac', marginTop: '4px' }}>Processing receipt...</div>
        </div>
      )}

      {/* Declined Display — BUG-C1: Added "Pay Cash Instead" option */}
      {datacap.processingStatus === 'declined' && (
        <div style={{
          textAlign: 'center',
          padding: '16px',
          marginBottom: '8px',
          background: 'rgba(239, 68, 68, 0.15)',
          borderRadius: '10px',
          border: '1px solid rgba(239, 68, 68, 0.3)',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '4px' }}>❌</div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#f87171' }}>DECLINED</div>
          <div style={{ fontSize: '11px', color: '#fca5a5', marginTop: '4px' }}>{datacap.error || 'Card was declined'}</div>
          {onPayCash && (
            <button
              onClick={() => {
                datacap.cancelTransaction()
                onPayCash('cash')
              }}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(34, 197, 94, 0.25)',
                color: '#4ade80',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Pay Cash Instead
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onCancel}
          disabled={datacap.isProcessing}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '10px',
            border: '1px solid rgba(100, 116, 139, 0.3)',
            background: 'transparent',
            color: datacap.isProcessing ? '#475569' : '#94a3b8',
            fontSize: '13px',
            fontWeight: 600,
            cursor: datacap.isProcessing ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: datacap.isProcessing ? 0.5 : 1,
          }}
        >
          {/* BUG-C1: Clarify label when declined — "Back to Order" instead of "Cancel" */}
          {datacap.processingStatus === 'declined' ? 'Back to Order' : 'Cancel'}
        </button>
        <button
          onClick={onCollect}
          disabled={datacap.isProcessing || !datacap.isReaderOnline || datacap.processingStatus === 'approved'}
          style={{
            flex: 2,
            padding: '12px',
            borderRadius: '10px',
            border: 'none',
            background: datacap.isProcessing
              ? 'rgba(100, 116, 139, 0.2)'
              : !datacap.isReaderOnline
              ? 'rgba(245, 158, 11, 0.2)'
              : datacap.processingStatus === 'approved'
              ? 'rgba(34, 197, 94, 0.3)'
              : '#16a34a',
            color: datacap.isProcessing
              ? '#64748b'
              : !datacap.isReaderOnline
              ? '#f59e0b'
              : datacap.processingStatus === 'approved'
              ? '#4ade80'
              : '#ffffff',
            fontSize: '14px',
            fontWeight: 800,
            cursor: datacap.isProcessing || !datacap.isReaderOnline || datacap.processingStatus === 'approved'
              ? 'not-allowed'
              : 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {datacap.isProcessing ? (
            <>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid #64748b', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              Processing...
            </>
          ) : !datacap.isReaderOnline ? (
            'READER OFFLINE'
          ) : datacap.processingStatus === 'approved' ? (
            '✓ APPROVED'
          ) : datacap.processingStatus === 'declined' ? (
            'TRY AGAIN'
          ) : (
            <>💳 COLLECT PAYMENT</>
          )}
        </button>
      </div>

      {/* Swap Confirmation Modal */}
      {datacap.showSwapModal && datacap.backupReader && (
        <SwapConfirmationModal
          targetReader={datacap.backupReader}
          onCancel={() => datacap.setShowSwapModal(false)}
          onConfirm={() => datacap.swapToBackup()}
          onBeep={async () => datacap.triggerBeep()}
        />
      )}

      {/* Spin animation keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
})

'use client'

import { useState, useEffect } from 'react'
import { useDatacap, type DatacapResult } from '@/hooks/useDatacap'
import { ReaderStatusIndicator } from '@/components/payment/ReaderStatusIndicator'
import { SwapConfirmationModal } from '@/components/payment/SwapConfirmationModal'

export interface OrderPanelActionsItem {
  id: string
  name: string
  quantity: number
  price: number
  modifiers?: { name: string; price: number }[]
}

interface OrderPanelActionsProps {
  hasItems: boolean
  hasPendingItems: boolean
  isSending?: boolean
  items?: OrderPanelActionsItem[]
  subtotal?: number
  tax?: number
  discounts?: number
  total?: number
  cashDiscountRate?: number
  taxRate?: number
  onSend?: () => void
  onPay?: () => void
  onDiscount?: () => void
  onClear?: () => void
  onPaymentModeChange?: (mode: 'cash' | 'card') => void
  // Datacap payment props
  orderId?: string | null
  terminalId?: string
  employeeId?: string
  onPaymentSuccess?: (result: DatacapResult & { tipAmount: number }) => void
  onPaymentCancel?: () => void
  onCloseOrder?: () => void      // Close/cancel order with $0 balance
  onSaveOrderFirst?: () => void  // Called when Pay is clicked but order isn't saved yet
  autoShowPayment?: boolean      // Auto-open payment processor (after order saved)
  onAutoShowPaymentHandled?: () => void  // Callback to clear the flag
}

export function OrderPanelActions({
  hasItems,
  hasPendingItems,
  isSending = false,
  items = [],
  subtotal = 0,
  tax = 0,
  discounts = 0,
  total = 0,
  cashDiscountRate = 0,
  taxRate = 0,
  onSend,
  onPay,
  onDiscount,
  onClear,
  onPaymentModeChange,
  // Datacap payment props
  orderId,
  terminalId,
  employeeId,
  onPaymentSuccess,
  onPaymentCancel,
  onCloseOrder,
  onSaveOrderFirst,
  autoShowPayment,
  onAutoShowPaymentHandled,
}: OrderPanelActionsProps) {
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card'>('card')
  const [showTotalDetails, setShowTotalDetails] = useState(false)
  const [showPaymentProcessor, setShowPaymentProcessor] = useState(false)
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [showCustomTip, setShowCustomTip] = useState(false)

  // Auto-show payment processor when orderId becomes available after save
  useEffect(() => {
    if (autoShowPayment && orderId && terminalId && employeeId) {
      setShowPaymentProcessor(true)
      setTipAmount(0)
      setCustomTip('')
      setShowCustomTip(false)
      onAutoShowPaymentHandled?.()
    }
  }, [autoShowPayment, orderId, terminalId, employeeId, onAutoShowPaymentHandled])

  const cashDiscount = cashDiscountRate > 0 ? subtotal * cashDiscountRate : 0
  const cashSubtotal = subtotal - cashDiscount
  const cashTax = taxRate > 0 ? cashSubtotal * taxRate : tax
  const cashTotal = cashSubtotal + cashTax
  const cardTotal = total

  const displayTotal = paymentMode === 'cash' && cashDiscountRate > 0 ? cashTotal : cardTotal
  const totalToCharge = displayTotal + tipAmount

  // Datacap hook — only active when we have terminalId + employeeId
  const datacap = useDatacap({
    terminalId: terminalId || '',
    employeeId: employeeId || '',
    onSuccess: (result) => {
      onPaymentSuccess?.({ ...result, tipAmount })
      // Reset payment view after short delay to show approved state
      setTimeout(() => {
        setShowPaymentProcessor(false)
        setTipAmount(0)
        setCustomTip('')
        setShowCustomTip(false)
      }, 2000)
    },
    onDeclined: (reason) => {
      console.log('[OrderPanelActions] Declined:', reason)
    },
    onError: (err) => {
      console.error('[OrderPanelActions] Error:', err)
    },
    onReaderOffline: () => {
      if (datacap.canSwap) {
        datacap.setShowSwapModal(true)
      }
    },
  })

  const handlePaymentModeChange = (mode: 'cash' | 'card') => {
    setPaymentMode(mode)
    onPaymentModeChange?.(mode)
  }

  const handleClear = () => {
    if (!hasItems) return
    const confirmed = window.confirm(
      'Are you sure you want to clear this order? This cannot be undone.'
    )
    if (confirmed) {
      onClear?.()
    }
  }

  const handlePayClick = () => {
    // If we have Datacap config, show inline payment processor
    if (terminalId && employeeId && orderId) {
      setShowPaymentProcessor(true)
      setTipAmount(0)
      setCustomTip('')
      setShowCustomTip(false)
    } else if (terminalId && employeeId && !orderId && onSaveOrderFirst) {
      // Need to create the order in DB first, then open payment
      onSaveOrderFirst()
    } else {
      // Fallback to original onPay callback (opens modal, etc.)
      onPay?.()
    }
  }

  const handleCancelPayment = () => {
    datacap.cancelTransaction()
    setShowPaymentProcessor(false)
    setTipAmount(0)
    setCustomTip('')
    setShowCustomTip(false)
    onPaymentCancel?.()
  }

  const handleCollectPayment = async () => {
    if (!orderId) return
    await datacap.processPayment({
      orderId,
      amount: totalToCharge,
      tipAmount,
      tranType: 'Sale',
    })
  }

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
    setShowCustomTip(false)
  }

  // Suggested tip percentages
  const tipPercentages = [15, 18, 20, 25]
  const tipBasis = subtotal || displayTotal

  // ─── PAYMENT PROCESSOR VIEW ───────────────────────────────────────────
  if (showPaymentProcessor) {
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

        {/* Declined Display */}
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
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleCancelPayment}
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
            Cancel
          </button>
          <button
            onClick={handleCollectPayment}
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
            onBeep={datacap.triggerBeep}
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
  }

  // ─── NORMAL VIEW (Send / Pay / Discount / Clear) ─────────────────────
  return (
    <div
      style={{
        padding: '16px 20px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(15, 23, 42, 0.95)',
        flexShrink: 0,
      }}
    >
      {/* Cash/Card Toggle - Compact */}
      {hasItems && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          <button
            onClick={() => handlePaymentModeChange('cash')}
            style={{
              flex: 1,
              padding: '8px',
              background: paymentMode === 'cash' ? '#16a34a' : '#14532d',
              border: `1px solid ${paymentMode === 'cash' ? '#22c55e' : '#166534'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: '10px', color: paymentMode === 'cash' ? '#bbf7d0' : '#86efac', fontWeight: 500, marginBottom: '1px' }}>
              Cash
            </div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: paymentMode === 'cash' ? '#ffffff' : '#86efac' }}>
              ${(cashDiscountRate > 0 ? cashTotal : total).toFixed(2)}
            </div>
          </button>
          <button
            onClick={() => handlePaymentModeChange('card')}
            style={{
              flex: 1,
              padding: '8px',
              background: paymentMode === 'card' ? '#4f46e5' : '#312e81',
              border: `1px solid ${paymentMode === 'card' ? '#6366f1' : '#3730a3'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: '10px', color: paymentMode === 'card' ? '#c7d2fe' : '#a5b4fc', fontWeight: 500, marginBottom: '1px' }}>
              Card
            </div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: paymentMode === 'card' ? '#ffffff' : '#a5b4fc' }}>
              ${cardTotal.toFixed(2)}
            </div>
          </button>
        </div>
      )}

      {/* Expandable Total Section */}
      {hasItems && (
        <>
          <button
            onClick={() => setShowTotalDetails(!showTotalDetails)}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              marginBottom: '10px',
            }}
          >
            <span style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ transform: showTotalDetails ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Total ({items.length} item{items.length !== 1 ? 's' : ''})
            </span>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9' }}>
              ${displayTotal.toFixed(2)}
            </span>
          </button>

          {/* Expanded Total Details */}
          {showTotalDetails && (
            <div
              style={{
                marginBottom: '10px',
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              {/* Line Items */}
              {items.map((item) => (
                <div key={item.id} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#e2e8f0' }}>
                      {item.quantity}x {item.name}
                    </span>
                    <span style={{ color: '#94a3b8' }}>
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div style={{ marginLeft: '12px', marginTop: '2px' }}>
                      {item.modifiers.map((m, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                          <span>+ {m.name}</span>
                          {m.price > 0 && <span>${(m.price * item.quantity).toFixed(2)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Subtotal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span style={{ color: '#94a3b8' }}>Subtotal</span>
                <span style={{ color: '#e2e8f0' }}>${subtotal.toFixed(2)}</span>
              </div>

              {/* Cash Discount */}
              {paymentMode === 'cash' && cashDiscount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                  <span style={{ color: '#4ade80' }}>Cash Discount ({Math.round(cashDiscountRate * 100)}%)</span>
                  <span style={{ color: '#4ade80' }}>-${cashDiscount.toFixed(2)}</span>
                </div>
              )}

              {/* Discounts */}
              {discounts > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                  <span style={{ color: '#f87171' }}>Discounts</span>
                  <span style={{ color: '#f87171' }}>-${discounts.toFixed(2)}</span>
                </div>
              )}

              {/* Tax */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                <span style={{ color: '#94a3b8' }}>Tax{taxRate > 0 ? ` (${Math.round(taxRate * 100)}%)` : ''}</span>
                <span style={{ color: '#e2e8f0' }}>${(paymentMode === 'cash' && cashDiscountRate > 0 ? cashTax : tax).toFixed(2)}</span>
              </div>

              {/* Total */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 600, marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <span style={{ color: '#f1f5f9' }}>Total</span>
                <span style={{ color: '#22c55e' }}>${displayTotal.toFixed(2)}</span>
              </div>

              {/* Cash savings message */}
              {paymentMode === 'cash' && cashDiscount > 0 && (
                <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#4ade80', fontWeight: 500 }}>
                  You save ${cashDiscount.toFixed(2)} with cash!
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Primary action buttons */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: hasItems ? '8px' : '0' }}>
        {onSend && (
          <button
            onClick={onSend}
            disabled={!hasPendingItems || isSending}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '10px',
              border: 'none',
              background: hasPendingItems && !isSending ? '#22c55e' : 'rgba(255, 255, 255, 0.1)',
              color: hasPendingItems && !isSending ? '#ffffff' : '#64748b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: hasPendingItems && !isSending ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              opacity: !hasPendingItems ? 0.5 : 1,
            }}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        )}
        {(onPay || (terminalId && employeeId)) && (
          <button
            onClick={handlePayClick}
            disabled={!hasItems}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '10px',
              background: hasItems ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${hasItems ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
              color: hasItems ? '#a5b4fc' : '#64748b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: hasItems ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
            }}
          >
            💳 Pay
          </button>
        )}
        {onCloseOrder && !hasItems && (
          <button
            onClick={onCloseOrder}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Close Order
          </button>
        )}
      </div>

      {/* Secondary actions */}
      {hasItems && (onDiscount || onClear) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {onDiscount && (
            <button
              onClick={onDiscount}
              disabled={!hasItems}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: hasItems ? '#94a3b8' : '#475569',
                fontSize: '12px',
                fontWeight: 500,
                cursor: hasItems ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                opacity: hasItems ? 1 : 0.5,
              }}
            >
              Discount
            </button>
          )}
          {onClear && (
            <button
              onClick={handleClear}
              disabled={!hasItems}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                background: 'rgba(239, 68, 68, 0.1)',
                color: hasItems ? '#f87171' : '#475569',
                fontSize: '12px',
                fontWeight: 500,
                cursor: hasItems ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                opacity: hasItems ? 1 : 0.5,
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

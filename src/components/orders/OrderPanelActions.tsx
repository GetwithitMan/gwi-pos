'use client'

import { useState, useEffect, useRef } from 'react'
import { roundToCents } from '@/lib/pricing'
import { useDatacap, type DatacapResult } from '@/hooks/useDatacap'
import { ReaderStatusIndicator } from '@/components/payment/ReaderStatusIndicator'
import { toast } from '@/stores/toast-store'
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
  // All pricing comes pre-calculated from usePricing — no local recalculation
  subtotal?: number      // Cash subtotal (stored DB price)
  cashSubtotal?: number  // Cash subtotal (same as subtotal, explicit)
  cardSubtotal?: number  // Card subtotal (with surcharge if dual pricing)
  tax?: number           // Tax amount
  discounts?: number     // Dollar discounts
  total?: number         // Current display total (based on active payment mode)
  cashTotal?: number     // Total if paying cash (always lower or equal to cardTotal)
  cardTotal?: number     // Total if paying card (always higher or equal to cashTotal)
  cashDiscount?: number  // Savings amount (cardTotal - cashTotal)
  cashDiscountPct?: number // Cash discount percentage for display label (e.g. 4)
  taxPct?: number        // Tax percentage for display label (e.g. 8)
  onSend?: () => void
  onPay?: (method?: 'cash' | 'credit') => void
  onPrintCheck?: () => void
  onStartTab?: () => void
  onOtherPayment?: () => void
  onDiscount?: () => void
  onClear?: () => void
  onCancelOrder?: () => void
  onHide?: () => void  // Hide the order panel (dismiss empty tab)
  hasSentItems?: boolean  // Whether any items have been sent to kitchen
  onPaymentModeChange?: (mode: 'cash' | 'card') => void
  hasActiveTab?: boolean  // Current order already has a tab started (card on file)
  requireCardForTab?: boolean  // Setting: must swipe/chip card before tab can be sent
  tabCardLast4?: string  // Last 4 digits of card on the active tab
  // Datacap payment props
  orderId?: string | null
  terminalId?: string
  employeeId?: string
  onPaymentSuccess?: (result: DatacapResult & { tipAmount: number }) => void
  onPaymentCancel?: () => void
  onCloseOrder?: () => void
  onSaveOrderFirst?: () => void
  autoShowPayment?: boolean
  onAutoShowPaymentHandled?: () => void
  hasTaxInclusiveItems?: boolean
  roundingAdjustment?: number  // Rounding applied (positive = rounded up, negative = down)
  onSplit?: () => void
  orderType?: string  // 'bar_tab', 'dine_in', etc. — table orders show Send instead of Start Tab
}

export function OrderPanelActions({
  hasItems,
  hasPendingItems,
  isSending = false,
  items = [],
  subtotal = 0,
  cashSubtotal: cashSubtotalProp,
  cardSubtotal: cardSubtotalProp,
  tax = 0,
  discounts = 0,
  total = 0,
  cashTotal: cashTotalProp,
  cardTotal: cardTotalProp,
  cashDiscount: cashDiscountProp,
  cashDiscountPct = 0,
  taxPct = 0,
  onSend,
  onPay,
  onPrintCheck,
  onStartTab,
  onOtherPayment,
  onDiscount,
  onClear,
  onCancelOrder,
  onHide,
  hasSentItems = false,
  onPaymentModeChange,
  hasActiveTab = false,
  requireCardForTab = false,
  tabCardLast4,
  orderId,
  terminalId,
  employeeId,
  onPaymentSuccess,
  onPaymentCancel,
  onCloseOrder,
  onSaveOrderFirst,
  autoShowPayment,
  onAutoShowPaymentHandled,
  hasTaxInclusiveItems,
  roundingAdjustment,
  onSplit,
  orderType,
}: OrderPanelActionsProps) {
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card'>('card')
  const [showTotalDetails, setShowTotalDetails] = useState(false)
  const [showPaymentProcessor, setShowPaymentProcessor] = useState(false)
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [showCustomTip, setShowCustomTip] = useState(false)
  // Tap-twice confirmation state (replaces window.confirm which Chrome can permanently suppress)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // All totals come from props (usePricing) — no local recalculation
  const cashTotal = cashTotalProp ?? total
  const cardTotal = cardTotalProp ?? total
  const cashDiscount = cashDiscountProp ?? 0
  const hasDualPricing = cashDiscount > 0

  // Pre-computed subtotals from usePricing (no local multiplier math)
  const cashSub = cashSubtotalProp ?? subtotal
  const cardSub = cardSubtotalProp ?? subtotal
  const displaySubtotal = paymentMode === 'cash' ? cashSub : cardSub

  const displayTotal = paymentMode === 'cash' ? cashTotal : cardTotal
  const totalToCharge = displayTotal + tipAmount

  // Datacap hook — only active when we have terminalId + employeeId
  const datacap = useDatacap({
    terminalId: terminalId || '',
    employeeId: employeeId || '',
    onSuccess: (result) => {
      onPaymentSuccess?.({ ...result, tipAmount })
      setTimeout(() => {
        setShowPaymentProcessor(false)
        setTipAmount(0)
        setCustomTip('')
        setShowCustomTip(false)
      }, 2000)
    },
    onDeclined: (reason) => {
      toast.warning(reason || 'Payment declined')
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
    if (!confirmingClear) {
      setConfirmingClear(true)
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = setTimeout(() => setConfirmingClear(false), 3000)
      return
    }
    setConfirmingClear(false)
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    onClear?.()
  }

  const handlePayClick = () => {
    if (terminalId && employeeId && orderId) {
      setShowPaymentProcessor(true)
      setTipAmount(0)
      setCustomTip('')
      setShowCustomTip(false)
    } else if (terminalId && employeeId && !orderId && onSaveOrderFirst) {
      onSaveOrderFirst()
    } else {
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
      {/* ── PRIMARY ACTION: One context-aware button ─────────── */}
      {/* Rule: bar_tab + tab not started → "Start Tab" (purple, calls onStartTab)
               everything else              → "Send"      (orange, calls onSend)    */}
      {(() => {
        const isNewTab = orderType === 'bar_tab' && !hasActiveTab && !hasSentItems
        const handler = isNewTab ? onStartTab : onSend
        if (!handler || !hasPendingItems) return null

        const needsCard = isNewTab && requireCardForTab
        const label = isSending
          ? (isNewTab ? 'Authorizing...' : 'Sending...')
          : isNewTab
          ? (needsCard ? 'Start Tab' : 'Start Tab')
          : 'Send'
        const bg = isNewTab ? '#8b5cf6' : '#ea580c'
        const glow = isNewTab ? 'rgba(139, 92, 246, 0.3)' : 'rgba(234, 88, 12, 0.3)'

        return (
          <>
            <button
              onClick={hasPendingItems ? handler : undefined}
              disabled={!hasPendingItems || isSending}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '10px',
                border: 'none',
                background: hasPendingItems && !isSending ? bg : 'rgba(255, 255, 255, 0.08)',
                color: hasPendingItems && !isSending ? '#ffffff' : '#64748b',
                fontSize: '15px',
                fontWeight: 700,
                cursor: hasPendingItems && !isSending ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                opacity: !hasPendingItems ? 0.4 : 1,
                marginBottom: needsCard && hasPendingItems ? '2px' : '10px',
                boxShadow: hasPendingItems && !isSending ? `0 0 20px ${glow}` : 'none',
              }}
            >
              {needsCard && '💳 '}{label}
            </button>
            {needsCard && hasPendingItems && (
              <div style={{ fontSize: '10px', color: '#a78bfa', textAlign: 'center', marginBottom: '8px' }}>
                Insert chip to pre-authorize — sends to tab after approved
              </div>
            )}
          </>
        )
      })()}

      {/* Cash/Card Toggle - Compact */}
      {hasItems && hasDualPricing && (
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
              ${cashTotal.toFixed(2)}
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
              {/* Line Items — show card price as default when dual pricing enabled */}
              {items.map((item) => {
                // Per-item card price: items stored as cash prices, apply surcharge for display
                const cpm = cashDiscountPct > 0 ? 1 + cashDiscountPct / 100 : 1
                const displayPrice = roundToCents(item.price * cpm)
                return (
                <div key={item.id} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#e2e8f0' }}>
                      {item.quantity}x {item.name}
                    </span>
                    <span style={{ color: '#94a3b8' }}>
                      ${roundToCents(displayPrice * item.quantity).toFixed(2)}
                    </span>
                  </div>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div style={{ marginLeft: '12px', marginTop: '2px' }}>
                      {item.modifiers.map((m, idx) => {
                        const modDisplayPrice = roundToCents(m.price * cpm)
                        return (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                          <span>+ {m.name}</span>
                          {m.price > 0 && <span>${roundToCents(modDisplayPrice * item.quantity).toFixed(2)}</span>}
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                )
              })}

              {/* Subtotal — always shows card subtotal, cash discount shown below when paying cash */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span style={{ color: '#94a3b8' }}>Subtotal</span>
                <span style={{ color: '#e2e8f0' }}>${cardSub.toFixed(2)}</span>
              </div>

              {/* Cash Discount (only when paying cash with dual pricing) */}
              {paymentMode === 'cash' && cashDiscount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                  <span style={{ color: '#4ade80' }}>Cash Discount ({cashDiscountPct}%)</span>
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
                <span style={{ color: '#94a3b8' }}>Tax{taxPct > 0 ? ` (${taxPct}%)` : ''}</span>
                <span style={{ color: '#e2e8f0' }}>${tax.toFixed(2)}</span>
              </div>
              {hasTaxInclusiveItems && (
                <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginTop: '2px', textAlign: 'right' }}>
                  Included in item prices
                </div>
              )}

              {/* Cash Rounding — only visible when paying cash and rounding is active */}
              {paymentMode === 'cash' && roundingAdjustment !== undefined && roundingAdjustment !== 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                  <span style={{ color: '#94a3b8' }}>Rounding</span>
                  <span style={{ color: '#94a3b8' }}>{roundingAdjustment > 0 ? '+' : '-'}${Math.abs(roundingAdjustment).toFixed(2)}</span>
                </div>
              )}

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

      {/* Payment action buttons: Cash / Card / Other */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: hasItems ? '8px' : '0' }}>
        {onPay && (
          <button
            onClick={() => onPay('cash')}
            disabled={!hasItems}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '10px',
              background: hasItems ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${hasItems ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
              color: hasItems ? '#86efac' : '#64748b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: hasItems ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
            }}
          >
            💵 Cash
          </button>
        )}
        {onPrintCheck && hasItems && (
          <button
            onClick={onPrintCheck}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '10px',
              background: 'rgba(234, 179, 8, 0.12)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              color: '#fbbf24',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            🧾 Print
          </button>
        )}
        {onPay && (
          <button
            onClick={() => onPay('credit')}
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
            💳 Card
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
      {hasItems && (onDiscount || onClear || onCancelOrder || onSplit || onOtherPayment) && (
        <div style={{ display: 'grid', gridTemplateColumns: [onOtherPayment, onSplit, onDiscount, (onCancelOrder && !hasSentItems), (onClear && !onCancelOrder)].filter(Boolean).length > 1 ? `repeat(${[onOtherPayment, onSplit, onDiscount, (onCancelOrder && !hasSentItems), (onClear && !onCancelOrder)].filter(Boolean).length}, 1fr)` : '1fr', gap: '8px' }}>
          {onOtherPayment && (
            <button
              onClick={onOtherPayment}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                background: 'rgba(148, 163, 184, 0.1)',
                color: '#94a3b8',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Other
            </button>
          )}
          {onSplit && (
            <button
              onClick={onSplit}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                background: 'rgba(168, 85, 247, 0.1)',
                color: '#c084fc',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Split
            </button>
          )}
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
          {/* Cancel Order — only when NO items have been sent to kitchen */}
          {onCancelOrder && !hasSentItems && (
            <button
              onClick={() => {
                if (!hasItems) {
                  onCancelOrder()
                  return
                }
                if (!confirmingCancel) {
                  setConfirmingCancel(true)
                  if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current)
                  cancelTimerRef.current = setTimeout(() => setConfirmingCancel(false), 3000)
                  return
                }
                setConfirmingCancel(false)
                if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current)
                onCancelOrder()
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: confirmingCancel
                  ? '2px solid rgba(239, 68, 68, 0.8)'
                  : '1px solid rgba(239, 68, 68, 0.3)',
                background: confirmingCancel
                  ? 'rgba(239, 68, 68, 0.25)'
                  : 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                fontSize: '12px',
                fontWeight: confirmingCancel ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {confirmingCancel ? 'Tap again to cancel' : 'Cancel Order'}
            </button>
          )}
          {/* Clear — fallback for when Cancel Order is not wired */}
          {onClear && !onCancelOrder && (
            <button
              onClick={handleClear}
              disabled={!hasItems}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: confirmingClear
                  ? '2px solid rgba(239, 68, 68, 0.8)'
                  : '1px solid rgba(239, 68, 68, 0.3)',
                background: confirmingClear
                  ? 'rgba(239, 68, 68, 0.25)'
                  : 'rgba(239, 68, 68, 0.1)',
                color: hasItems ? '#f87171' : '#475569',
                fontSize: '12px',
                fontWeight: confirmingClear ? 700 : 500,
                cursor: hasItems ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                opacity: hasItems ? 1 : 0.5,
              }}
            >
              {confirmingClear ? 'Tap again to clear' : 'Clear'}
            </button>
          )}
        </div>
      )}

      {/* Hide / Dismiss — always available to go back to the floor plan / tab list */}
      {onHide && (
        <button
          onClick={onHide}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid rgba(148, 163, 184, 0.15)',
            background: 'rgba(148, 163, 184, 0.05)',
            color: '#64748b',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginTop: hasItems ? '0' : '10px',
          }}
        >
          Hide
        </button>
      )}
    </div>
  )
}

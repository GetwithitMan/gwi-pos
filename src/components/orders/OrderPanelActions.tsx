'use client'

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { roundToCents } from '@/lib/pricing'
import { useDatacap, type DatacapResult } from '@/hooks/useDatacap'
import { ReaderStatusIndicator } from '@/components/payment/ReaderStatusIndicator'
import { toast } from '@/stores/toast-store'
import { SwapConfirmationModal } from '@/components/payment/SwapConfirmationModal'
import { useOrderStore } from '@/stores/order-store'

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
  cardSubtotal?: number  // Card subtotal (dual pricing)
  tax?: number           // Tax amount
  cashTax?: number       // Tax on cash subtotal
  cardTax?: number       // Tax on card subtotal
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
  onQuickSplitEvenly?: (numWays: number) => void
  orderType?: string  // 'bar_tab', 'dine_in', etc. — table orders show Send instead of Start Tab
  onTransferItems?: () => void
  onTransferOrder?: () => void
  onMergeOrders?: () => void
  onSchedule?: () => void  // Schedule order for later (pre-order)
  isScheduled?: boolean    // Whether this order is already scheduled
  scheduledForDisplay?: string | null // Display string for scheduled time
  tableId?: string         // Current table ID — enables "Repeat Last" button
  tipExemptAmount?: number  // Sum of tip-exempt item totals — excluded from tip suggestion basis
  isTaxExempt?: boolean    // Whether this order is tax-exempt
  // Donation
  donationAmount?: number   // Current donation amount on order
  onDonation?: (amount: number | null) => void  // Set or clear donation
  // Repeat Round — repeats all items from the last sent batch
  lastSentItemIds?: Set<string>
  onRepeatRound?: () => void
  // Notification pager support
  pagerNumber?: string | null
  notificationProvidersActive?: boolean
  onPageNow?: () => void
  isPagingNow?: boolean
}

export const OrderPanelActions = memo(function OrderPanelActions({
  hasItems,
  hasPendingItems,
  isSending = false,
  items = [],
  subtotal = 0,
  cashSubtotal: cashSubtotalProp,
  cardSubtotal: cardSubtotalProp,
  tax = 0,
  cashTax: cashTaxProp,
  cardTax: cardTaxProp,
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
  onQuickSplitEvenly,
  orderType,
  onTransferItems,
  onTransferOrder,
  onMergeOrders,
  onSchedule,
  isScheduled = false,
  scheduledForDisplay,
  tableId,
  tipExemptAmount,
  isTaxExempt = false,
  donationAmount,
  onDonation,
  lastSentItemIds,
  onRepeatRound,
  pagerNumber,
  notificationProvidersActive,
  onPageNow,
  isPagingNow = false,
}: OrderPanelActionsProps) {
  const [paymentMode, setPaymentMode] = useState<'cash' | 'card'>('card')
  const [showDonationPopover, setShowDonationPopover] = useState(false)
  const [customDonation, setCustomDonation] = useState('')
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
  // "Sent!" flash state — briefly shows confirmation after successful send
  const [justSent, setJustSent] = useState(false)
  const prevIsSendingRef = useRef(false)
  // BUG-C1: Track that payment was just cancelled to prevent "Cancel Order" from appearing
  // immediately after a payment decline + cancel (prevents accidental tab destruction)
  const [justCancelledPayment, setJustCancelledPayment] = useState(false)
  const paymentCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Transfer chooser dropdown state
  const [showTransferChooser, setShowTransferChooser] = useState(false)
  // Repeat Last Order loading state
  const [repeatLoading, setRepeatLoading] = useState(false)

  // Detect isSending transition (true → false) to flash "Sent!" confirmation
  useEffect(() => {
    if (prevIsSendingRef.current && !isSending) {
      setJustSent(true)
      const timer = setTimeout(() => setJustSent(false), 1500)
      return () => clearTimeout(timer)
    }
    prevIsSendingRef.current = isSending
  }, [isSending])

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
  // Card-first: always show card values as primary when dual pricing is active
  const displaySubtotal = hasDualPricing ? (cardSub ?? subtotal) : subtotal

  // Tax matched to card when dual pricing (card tax is primary display)
  const displayTax = hasDualPricing ? (cardTaxProp ?? tax) : tax

  const displayTotal = hasDualPricing ? cardTotal : (cashTotal ?? total)
  const totalToCharge = roundToCents(displayTotal + tipAmount)

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

  // ─── Repeat Last Order handler ───────────────────────────────────────
  const handleRepeatLastOrder = useCallback(async () => {
    if (!tableId || !orderId || repeatLoading) return
    setRepeatLoading(true)
    try {
      const res = await fetch(`/api/orders/last-for-table?tableId=${encodeURIComponent(tableId)}&excludeOrderId=${encodeURIComponent(orderId)}`)
      if (!res.ok) {
        toast.error('Failed to fetch previous order')
        return
      }
      const json = await res.json()
      if (!json.data) {
        toast.info('No previous order found for this table')
        return
      }
      const { items: prevItems, orderNumber, unavailableItems } = json.data as {
        items: Array<{
          menuItemId: string
          name: string
          price: number
          quantity: number
          pourSize: string | null
          pourMultiplier: number | null
          specialNotes: string | null
          categoryType: string | null
          is86d: boolean
          modifiers: Array<{ modifierId: string; name: string; price: number; preModifier: string | null; depth: number }>
        }>
        orderNumber: string
        unavailableItems: string[]
      }

      // Warn about 86'd items
      if (unavailableItems.length > 0) {
        toast.warning(`Unavailable (86'd): ${unavailableItems.join(', ')}`)
      }

      // Filter to available items only
      const availableItems = prevItems.filter(i => !i.is86d)
      if (availableItems.length === 0) {
        toast.info('All items from the previous order are currently unavailable')
        return
      }

      // Add each available item to the order store
      const store = useOrderStore.getState()
      let addedCount = 0
      for (const item of availableItems) {
        store.addItem({
          menuItemId: item.menuItemId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers.map(m => ({
            id: m.modifierId,
            modifierId: m.modifierId,
            name: m.name,
            price: m.price,
            preModifier: m.preModifier ?? null,
            depth: m.depth ?? 0,
            spiritTier: null,
            linkedBottleProductId: null,
            parentModifierId: null,
          })),
          sentToKitchen: false,
          categoryType: item.categoryType ?? undefined,
          pourSize: item.pourSize ?? undefined,
          pourMultiplier: item.pourMultiplier ?? undefined,
          specialNotes: item.specialNotes ?? undefined,
        })
        addedCount += item.quantity
      }

      toast.success(`Added ${addedCount} item${addedCount !== 1 ? 's' : ''} from order #${orderNumber}`)
    } catch (err) {
      console.error('[RepeatLastOrder] Failed:', err)
      toast.error('Failed to repeat last order')
    } finally {
      setRepeatLoading(false)
    }
  }, [tableId, orderId, repeatLoading])

  const handleCancelPayment = () => {
    datacap.cancelTransaction()
    setShowPaymentProcessor(false)
    setTipAmount(0)
    setCustomTip('')
    setShowCustomTip(false)
    // BUG-C1: Set flag to prevent "Cancel Order" from appearing immediately after
    // a payment cancel — clears after 5s so it's only a confusion guard, not permanent
    setJustCancelledPayment(true)
    if (paymentCancelTimerRef.current) clearTimeout(paymentCancelTimerRef.current)
    paymentCancelTimerRef.current = setTimeout(() => setJustCancelledPayment(false), 5000)
    onPaymentCancel?.()
  }

  const handleCollectPayment = async () => {
    if (!orderId) return
    await datacap.processPayment({
      orderId,
      amount: totalToCharge,
      tipAmount: roundToCents(tipAmount),
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
  const rawTipBasis = displaySubtotal || displayTotal
  const tipBasis = tipExemptAmount ? Math.max(0, rawTipBasis - tipExemptAmount) : rawTipBasis

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
            {onPay && (
              <button
                onClick={() => {
                  datacap.cancelTransaction()
                  setShowPaymentProcessor(false)
                  onPay('cash')
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
            {/* BUG-C1: Clarify label when declined — "Back to Order" instead of "Cancel" */}
            {datacap.processingStatus === 'declined' ? 'Back to Order' : 'Cancel'}
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
      {/* Rule: bar_tab → always "Start Tab" (purple, calls onStartTab)
               everything else → "Send" (orange, calls onSend) */}
      {(() => {
        const isBarTab = orderType === 'bar_tab'
        const handler = isBarTab ? onStartTab : onSend
        if (!handler || (!hasPendingItems && !justSent)) return null

        const isNewTab = isBarTab && !hasActiveTab && !hasSentItems
        const needsCard = isNewTab && requireCardForTab
        const label = justSent
          ? '✓ Sent!'
          : isSending
          ? (needsCard ? 'Authorizing...' : 'Sending...')
          : isBarTab
          ? (isNewTab
            ? (needsCard ? '💳 Start Tab' : 'Start Tab')
            : 'Add to Tab')
          : 'Send'
        const bg = isBarTab ? '#8b5cf6' : '#ea580c'
        const glow = isBarTab ? 'rgba(139, 92, 246, 0.3)' : 'rgba(234, 88, 12, 0.3)'

        return (
          <>
            <button
              onClick={hasPendingItems ? handler : undefined}
              disabled={!hasPendingItems || isSending || justSent}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '10px',
                border: 'none',
                background: justSent ? '#16a34a' : (hasPendingItems && !isSending ? bg : 'rgba(255, 255, 255, 0.08)'),
                color: justSent ? '#ffffff' : (hasPendingItems && !isSending ? '#ffffff' : '#64748b'),
                fontSize: '15px',
                fontWeight: 700,
                cursor: justSent ? 'default' : (hasPendingItems && !isSending ? 'pointer' : 'not-allowed'),
                transition: 'all 0.2s ease',
                opacity: !hasPendingItems && !justSent ? 0.4 : 1,
                marginBottom: needsCard && hasPendingItems ? '2px' : (justSent && !hasPendingItems ? '6px' : '10px'),
                boxShadow: justSent ? '0 0 20px rgba(22, 163, 74, 0.3)' : (hasPendingItems && !isSending ? `0 0 20px ${glow}` : 'none'),
              }}
            >
              {label}
            </button>
            {/* Schedule for Later button (pre-orders) */}
            {onSchedule && !isBarTab && hasPendingItems && !isSending && !justSent && (
              <button
                onClick={onSchedule}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '10px',
                  border: '2px solid rgba(139, 92, 246, 0.4)',
                  background: isScheduled ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                  color: '#a78bfa',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  marginBottom: '6px',
                }}
              >
                {isScheduled && scheduledForDisplay
                  ? `Scheduled: ${scheduledForDisplay}`
                  : 'Schedule for Later'}
              </button>
            )}
            {justSent && !hasPendingItems && (
              <button
                onClick={() => setJustSent(false)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '2px solid rgba(59, 130, 246, 0.5)',
                  background: 'rgba(59, 130, 246, 0.1)',
                  color: '#60a5fa',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  marginBottom: '10px',
                }}
              >
                + Add More Items
              </button>
            )}
            {needsCard && hasPendingItems && (
              <div style={{ fontSize: '10px', color: '#a78bfa', textAlign: 'center', marginBottom: '8px' }}>
                Insert chip to pre-authorize — sends to tab after approved
              </div>
            )}
          </>
        )
      })()}

      {/* Page Now — visible when pager is assigned and notification providers are active */}
      {pagerNumber && notificationProvidersActive && onPageNow && hasItems && hasSentItems && (
        <button
          onClick={onPageNow}
          disabled={isPagingNow}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '10px',
            border: '2px solid rgba(20, 184, 166, 0.4)',
            background: 'rgba(20, 184, 166, 0.1)',
            color: '#14b8a6',
            fontSize: '13px',
            fontWeight: 700,
            cursor: isPagingNow ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            opacity: isPagingNow ? 0.5 : 1,
          }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {isPagingNow ? 'Paging...' : `Page Now (#${pagerNumber})`}
        </button>
      )}

      {/* $0 Balance Auto-Close: show "Close Table" when all items are voided/comped */}
      {hasItems && !hasPendingItems && hasSentItems && total === 0 && onPay && (
        <button
          onClick={() => onPay('cash')}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '10px',
            border: 'none',
            background: '#dc2626',
            color: '#ffffff',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: '10px',
            boxShadow: '0 0 20px rgba(220, 38, 38, 0.3)',
          }}
        >
          Close Table ($0.00)
        </button>
      )}

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
          {onPrintCheck && (
            <button
              onClick={onPrintCheck}
              style={{
                padding: '8px 12px',
                background: 'rgba(234, 179, 8, 0.12)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                borderRadius: '8px',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s ease',
                color: '#fbbf24',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              🧾 Print
            </button>
          )}
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
                // Per-item card price: items stored as cash prices, apply dual pricing markup for display
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

              {/* Subtotal row — always card subtotal when dual pricing */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span style={{ color: '#94a3b8' }}>Subtotal</span>
                <span style={{ color: '#e2e8f0' }}>${displaySubtotal.toFixed(2)}</span>
              </div>

              {/* Discounts */}
              {discounts > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                  <span style={{ color: '#f87171' }}>Discounts</span>
                  <span style={{ color: '#f87171' }}>-${discounts.toFixed(2)}</span>
                </div>
              )}

              {/* Tax */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                <span style={{ color: isTaxExempt ? '#fbbf24' : '#94a3b8' }}>
                  Tax{isTaxExempt ? ' (EXEMPT)' : taxPct > 0 ? ` (${taxPct}%)` : ''}
                </span>
                <span style={{ color: isTaxExempt ? '#fbbf24' : '#e2e8f0' }}>
                  {isTaxExempt ? '$0.00' : `$${displayTax.toFixed(2)}`}
                </span>
              </div>
              {isTaxExempt && (
                <div style={{ fontSize: '10px', color: '#fbbf24', fontStyle: 'italic', marginTop: '2px', textAlign: 'right' }}>
                  Tax exemption applied
                </div>
              )}
              {!isTaxExempt && hasTaxInclusiveItems && (
                <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginTop: '2px', textAlign: 'right' }}>
                  Included in item prices
                </div>
              )}

              {/* Donation */}
              {donationAmount != null && donationAmount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px' }}>
                  <span style={{ color: '#f472b6' }}>Donation</span>
                  <span style={{ color: '#f472b6' }}>${donationAmount.toFixed(2)}</span>
                </div>
              )}

              {/* Card Total — PRIMARY, bold, separator above */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 700, marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <span style={{ color: '#f1f5f9' }}>{hasDualPricing ? 'Card Total' : 'Total'}</span>
                <span style={{ color: '#4ade80' }}>${displayTotal.toFixed(2)}</span>
              </div>

              {/* Cash breakdown — secondary, only when dual pricing */}
              {hasDualPricing && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '8px', borderLeft: '2px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#94a3b8' }}>
                    <span>Cash Total</span>
                    <span>${cashTotal.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                    <span style={{ paddingLeft: '8px' }}>Cash Subtotal</span>
                    <span>${(cashSub ?? subtotal).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                    <span style={{ paddingLeft: '8px' }}>Cash Tax</span>
                    <span>${(cashTaxProp ?? tax).toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Savings message */}
              {hasDualPricing && cashDiscount > 0 && (
                <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '12px', color: '#4ade80', fontWeight: 500 }}>
                  Save ${cashDiscount.toFixed(2)} by paying with cash!
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
        {onOtherPayment && hasItems && (
          <button
            onClick={onOtherPayment}
            style={{
              padding: '14px 10px',
              borderRadius: '10px',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              background: 'rgba(148, 163, 184, 0.1)',
              color: '#94a3b8',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Other
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

      {/* Transfer / Merge row */}
      {hasItems && (onTransferItems || onTransferOrder || onMergeOrders) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', position: 'relative' }}>
          {(onTransferItems || onTransferOrder) && (
            <div style={{ flex: 1, position: 'relative' }}>
              <button
                onClick={() => {
                  // If only one transfer type is available, go directly to it
                  if (onTransferItems && !onTransferOrder) {
                    onTransferItems()
                  } else if (onTransferOrder && !onTransferItems) {
                    onTransferOrder()
                  } else {
                    setShowTransferChooser(!showTransferChooser)
                  }
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  background: showTransferChooser ? 'rgba(6, 182, 212, 0.2)' : 'rgba(6, 182, 212, 0.1)',
                  color: '#22d3ee',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                Transfer {onTransferItems && onTransferOrder ? '▾' : ''}
              </button>
              {/* Transfer chooser dropdown */}
              {showTransferChooser && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    right: 0,
                    marginBottom: '4px',
                    background: 'rgba(15, 23, 42, 0.98)',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    zIndex: 50,
                    boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)',
                  }}
                >
                  {onTransferItems && (
                    <button
                      onClick={() => { setShowTransferChooser(false); onTransferItems() }}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: onTransferOrder ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
                        color: '#22d3ee',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      Transfer Item(s)
                    </button>
                  )}
                  {onTransferOrder && (
                    <button
                      onClick={() => { setShowTransferChooser(false); onTransferOrder() }}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        background: 'transparent',
                        border: 'none',
                        color: '#22d3ee',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      Transfer Table/Order
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {onMergeOrders && (
            <button
              onClick={onMergeOrders}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(251, 191, 36, 0.3)',
                background: 'rgba(251, 191, 36, 0.1)',
                color: '#fbbf24',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Merge
            </button>
          )}
        </div>
      )}

      {/* Repeat Round — repeats all items from the last sent batch */}
      {lastSentItemIds && lastSentItemIds.size > 0 && onRepeatRound && (
        <div style={{ marginBottom: '8px' }}>
          <button
            onClick={onRepeatRound}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              background: 'rgba(59, 130, 246, 0.1)',
              color: '#60a5fa',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '14px' }}>{'\u21BB'}</span>
            Repeat Round
            <span style={{
              background: 'rgba(59, 130, 246, 0.2)',
              borderRadius: '10px',
              padding: '1px 7px',
              fontSize: '11px',
              fontWeight: 600,
            }}>
              {lastSentItemIds.size}
            </span>
          </button>
        </div>
      )}

      {/* Repeat Last Order — only when table order has an active order */}
      {tableId && orderId && (
        <div style={{ marginBottom: '8px' }}>
          <button
            onClick={handleRepeatLastOrder}
            disabled={repeatLoading}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              background: 'rgba(34, 197, 94, 0.1)',
              color: repeatLoading ? '#64748b' : '#4ade80',
              fontSize: '12px',
              fontWeight: 500,
              cursor: repeatLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              opacity: repeatLoading ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '14px' }}>{repeatLoading ? '\u23F3' : '\u21BB'}</span>
            {repeatLoading ? 'Loading...' : 'Repeat Last'}
          </button>
        </div>
      )}

      {/* Secondary actions */}
      {hasItems && (onDiscount || onDonation || onClear || onCancelOrder || onSplit || onQuickSplitEvenly) && (
        <div style={{ display: 'grid', gridTemplateColumns: [onSplit, onQuickSplitEvenly, onDiscount, onDonation, (onCancelOrder && !hasSentItems && !justCancelledPayment), (onClear && !onCancelOrder)].filter(Boolean).length > 1 ? `repeat(${[onSplit, onQuickSplitEvenly, onDiscount, onDonation, (onCancelOrder && !hasSentItems && !justCancelledPayment), (onClear && !onCancelOrder)].filter(Boolean).length}, 1fr)` : '1fr', gap: '8px' }}>
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
          {onQuickSplitEvenly && (
            <button
              onClick={() => onQuickSplitEvenly(2)}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                background: 'rgba(139, 92, 246, 0.15)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                color: '#a78bfa',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              title="Split check evenly by 2"
            >
              ÷2
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
          {/* Donation button */}
          {onDonation && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowDonationPopover(!showDonationPopover)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: donationAmount && donationAmount > 0
                    ? '1px solid rgba(244, 114, 182, 0.5)'
                    : '1px solid rgba(255, 255, 255, 0.15)',
                  background: donationAmount && donationAmount > 0
                    ? 'rgba(244, 114, 182, 0.15)'
                    : 'rgba(255, 255, 255, 0.05)',
                  color: donationAmount && donationAmount > 0 ? '#f472b6' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  width: '100%',
                }}
              >
                {donationAmount && donationAmount > 0 ? `Donate $${donationAmount.toFixed(2)}` : 'Donate'}
              </button>
              {showDonationPopover && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: '8px',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '12px',
                  padding: '12px',
                  zIndex: 50,
                  minWidth: '200px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', textAlign: 'center' }}>
                    Add Donation
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '8px' }}>
                    {[1, 2, 5].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => {
                          onDonation(amt)
                          setShowDonationPopover(false)
                          setCustomDonation('')
                        }}
                        style={{
                          padding: '8px',
                          borderRadius: '8px',
                          border: '1px solid rgba(244, 114, 182, 0.3)',
                          background: 'rgba(244, 114, 182, 0.1)',
                          color: '#f472b6',
                          fontSize: '14px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Custom"
                      value={customDonation}
                      onChange={(e) => setCustomDonation(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = parseFloat(customDonation)
                          if (!isNaN(val) && val > 0) {
                            onDonation(val)
                            setShowDonationPopover(false)
                            setCustomDonation('')
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#e2e8f0',
                        fontSize: '13px',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => {
                        const val = parseFloat(customDonation)
                        if (!isNaN(val) && val > 0) {
                          onDonation(val)
                          setShowDonationPopover(false)
                          setCustomDonation('')
                        }
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        background: '#f472b6',
                        color: '#fff',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: 'none',
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {donationAmount != null && donationAmount > 0 && (
                    <button
                      onClick={() => {
                        onDonation(null)
                        setShowDonationPopover(false)
                        setCustomDonation('')
                      }}
                      style={{
                        width: '100%',
                        padding: '6px',
                        borderRadius: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: '#f87171',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Remove Donation
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Cancel Order — only when NO items have been sent to kitchen
              BUG-C1: Also hidden briefly after a payment cancel to prevent accidental tab destruction */}
          {onCancelOrder && !hasSentItems && !justCancelledPayment && (
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

    </div>
  )
})

'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { calculateCardPrice, calculateDebitPrice, calculateCreditPrice, applyPriceRounding } from '@/lib/pricing'
import type { DualPricingSettings, TipSettings, PaymentSettings, PriceRoundingSettings, PricingProgram, CustomerFeedbackSettings } from '@/lib/settings'
import { FeedbackPrompt } from './FeedbackPrompt'
import { ManualCardEntryModal, type ManualCardEntryResult } from './ManualCardEntryModal'
import type { CardDetectionResult } from './DatacapPaymentProcessor'
import { toast } from '@/stores/toast-store'
import { getOrderVersion, handleVersionConflict } from '@/lib/order-version'
import { uuid } from '@/lib/uuid'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { startPaymentTiming, markRequestSent, markGatewayResponse, completePaymentTiming, type PaymentTimingEntry } from '@/lib/payment-timing'
import { useAuthStore } from '@/stores/auth-store'
import { PaymentProvider, type TabCard, type PendingPayment, type PaymentStepType, type PaymentMethod } from './PaymentContext'
import {
  OrderSummary,
  PaymentMethodStep,
  TipEntryStep,
  CashEntryStep,
  SplitPaymentStep,
  CardProcessingStep,
  GiftCardStep,
  HouseAccountStep,
  RoomChargeStep,
} from './steps'
import {
  overlayClasses,
  modalClasses,
  headerClasses,
  contentClasses,
  footerClasses,
} from './payment-styles'

// Re-export TabCard for consumers that import from this file
export type { TabCard } from './PaymentContext'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
  orderTotal: number
  remainingBalance?: number
  subtotal?: number
  existingPayments?: { method: string; totalAmount: number }[]
  tabCards?: TabCard[]
  dualPricing: DualPricingSettings
  tipSettings?: TipSettings
  paymentSettings: PaymentSettings
  priceRounding?: PriceRoundingSettings
  onPaymentComplete: (receiptData?: Record<string, unknown>) => void
  onTabCardsChanged?: () => void
  employeeId?: string
  terminalId?: string
  locationId?: string
  initialMethod?: 'cash' | 'credit'
  waitForOrderReady?: () => Promise<void>
  pricingProgram?: PricingProgram
  feedbackSettings?: CustomerFeedbackSettings
  tipExemptAmount?: number
}

const DEFAULT_TIP_SETTINGS: TipSettings = {
  enabled: true,
  suggestedPercentages: [15, 18, 20, 25],
  calculateOn: 'subtotal',
}

class PaymentStepErrorBoundary extends React.Component<{ children: React.ReactNode; onReset: () => void }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) { console.error('Payment step error:', error) }
  render() {
    if (this.state.hasError) return (
      <div className="p-6 text-center">
        <p className="text-red-600 font-medium mb-2">Something went wrong in this payment step.</p>
        <button onClick={() => { this.setState({ hasError: false }); this.props.onReset() }} className="text-sm underline text-gray-600">Return to Payment Method Selection</button>
      </div>
    )
    return this.props.children
  }
}

export function PaymentModal({
  isOpen,
  onClose,
  orderId,
  orderTotal,
  remainingBalance,
  subtotal,
  existingPayments = [],
  tabCards = [],
  dualPricing,
  tipSettings = DEFAULT_TIP_SETTINGS,
  paymentSettings,
  priceRounding,
  onPaymentComplete,
  onTabCardsChanged,
  employeeId,
  terminalId,
  locationId,
  initialMethod,
  waitForOrderReady,
  pricingProgram,
  feedbackSettings,
  tipExemptAmount,
}: PaymentModalProps) {
  // All hooks before any conditional returns
  const employeePermissions = useAuthStore(s => s.employee?.permissions ?? [])
  const canKeyedEntry = employeePermissions.includes('manager.keyed_entry')

  const [fetchedOrderTotal, setFetchedOrderTotal] = useState<number | null>(null)
  const [fetchedSubtotal, setFetchedSubtotal] = useState<number | null>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)

  const [step, setStep] = useState<PaymentStepType>(
    initialMethod === 'cash' ? 'cash' : initialMethod === 'credit' ? 'datacap_card' : 'method'
  )
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(initialMethod || null)
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([])
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [idempotencyKey] = useState(() => uuid())
  const cardTimingRef = useRef<PaymentTimingEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cardDetectionResult, setCardDetectionResult] = useState<CardDetectionResult | null>(null)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [addCardError, setAddCardError] = useState<string | null>(null)
  const [tabAuthSlow, setTabAuthSlow] = useState(false)
  const [tabAuthSuccess, setTabAuthSuccess] = useState<string | null>(null)
  const [tabIncrementFailed, setTabIncrementFailed] = useState(false)
  const [showFeedbackPrompt, setShowFeedbackPrompt] = useState(false)
  const [pendingReceiptData, setPendingReceiptData] = useState<Record<string, unknown> | undefined>(undefined)
  const [isConnected, setIsConnected] = useState(true)

  useEffect(() => {
    const socket = getSharedSocket()
    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)
    setIsConnected(socket.connected)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); releaseSharedSocket() }
  }, [])

  useEffect(() => {
    if (!isOpen || !orderId) return
    const needsTotal = orderTotal === 0
    if (needsTotal) setLoadingOrder(true)

    fetch(`/api/orders/${orderId}`)
      .then(res => res.json())
      .then(raw => {
        const data = raw.data ?? raw
        if (needsTotal) { setFetchedOrderTotal(data.total || 0); setFetchedSubtotal(data.subtotal || 0) }
        if (data.incrementAuthFailed) setTabIncrementFailed(true)

        // CFD: fire and forget show-order-detail
        if (locationId) {
          const items = (data.items ?? []).map((i: { name: string; quantity: number; price: number | string; modifiers?: Array<{ name: string }> }) => ({
            name: i.name, quantity: i.quantity, price: Number(i.price), modifiers: (i.modifiers ?? []).map((m: { name: string }) => m.name),
          }))
          void fetch('/api/cfd/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            event: 'show-order-detail', locationId, payload: { orderId: data.id ?? orderId, orderNumber: data.orderNumber ?? 0, items, subtotal: Number(data.subtotal ?? 0), tax: Number(data.taxTotal ?? 0), total: Number(data.total ?? orderTotal), discountTotal: Number(data.discountTotal ?? 0), taxFromInclusive: Number(data.taxFromInclusive ?? 0), taxFromExclusive: Number(data.taxFromExclusive ?? 0) },
          })}).catch(() => {})
        }
      })
      .catch(err => console.error('Failed to fetch order:', err))
      .finally(() => { if (needsTotal) setLoadingOrder(false) })
  }, [isOpen, orderId, orderTotal, locationId])

  useEffect(() => {
    if (!orderId) return
    setTabIncrementFailed(false)
    const socket = getSharedSocket()
    const onTabUpdated = (data: { orderId: string; status: string }) => {
      if (data.orderId !== orderId) return
      if (data.status === 'increment_failed') {
        setTabIncrementFailed(true)
        toast.error('Card limit reached — take a new card or cash.', 10000)
      } else if (data.status === 'incremented') {
        setTabIncrementFailed(false)
      }
    }
    socket.on('tab:updated', onTabUpdated)
    return () => { socket.off('tab:updated', onTabUpdated); releaseSharedSocket() }
  }, [orderId])

  const effectiveOrderTotal = orderTotal > 0 ? orderTotal : (fetchedOrderTotal ?? 0)
  const effectiveSubtotal = subtotal ?? fetchedSubtotal ?? effectiveOrderTotal

  const alreadyPaid = useMemo(() => existingPayments.reduce((sum, p) => sum + p.totalAmount, 0), [existingPayments])
  const pendingTotal = useMemo(() => pendingPayments.reduce((sum, p) => sum + p.amount + p.tipAmount, 0), [pendingPayments])

  const remainingBeforeTip = useMemo(() => {
    const raw = effectiveOrderTotal - alreadyPaid - pendingTotal
    if (raw <= 0) return 0
    if (priceRounding?.enabled && priceRounding.applyToCash) {
      const rounded = applyPriceRounding(raw, priceRounding, 'cash')
      if (rounded <= 0) return 0
    }
    return raw
  }, [effectiveOrderTotal, alreadyPaid, pendingTotal, priceRounding])

  const discountPercent = dualPricing.cashDiscountPercent || 4.0
  const cashTotal = useMemo(() => priceRounding ? applyPriceRounding(remainingBeforeTip, priceRounding, 'cash') : remainingBeforeTip, [remainingBeforeTip, priceRounding])

  const debitTotal = useMemo(() => {
    if (pricingProgram?.enabled && (pricingProgram.model === 'dual_price_pan_debit' || pricingProgram.model === 'dual_price')) {
      const debitPct = pricingProgram.debitMarkupPercent ?? 0
      if (debitPct <= 0) return remainingBeforeTip
      return calculateDebitPrice(remainingBeforeTip, debitPct)
    }
    return remainingBeforeTip
  }, [pricingProgram, remainingBeforeTip])

  const creditTotal = useMemo(() => {
    if (pricingProgram?.enabled && (pricingProgram.model === 'dual_price_pan_debit' || pricingProgram.model === 'dual_price')) {
      const creditPct = pricingProgram.creditMarkupPercent ?? pricingProgram.cashDiscountPercent ?? 0
      return calculateCreditPrice(remainingBeforeTip, creditPct)
    }
    return remainingBeforeTip
  }, [pricingProgram, remainingBeforeTip])

  const cardTotal = useMemo(() => {
    if (pricingProgram?.enabled && pricingProgram.model === 'dual_price_pan_debit') {
      if (cardDetectionResult?.detectedCardType === 'debit') return debitTotal
      return creditTotal
    }
    if (dualPricing.enabled) return calculateCardPrice(remainingBeforeTip, discountPercent)
    return remainingBeforeTip
  }, [pricingProgram, dualPricing.enabled, remainingBeforeTip, discountPercent, cardDetectionResult, debitTotal, creditTotal])

  const currentTotal = useMemo(() => selectedMethod === 'cash' ? cashTotal : cardTotal, [selectedMethod, cashTotal, cardTotal])
  const cashRoundingAdjustment = useMemo(() => Math.round((cashTotal - remainingBeforeTip) * 100) / 100, [cashTotal, remainingBeforeTip])
  const totalWithTip = useMemo(() => currentTotal + tipAmount, [currentTotal, tipAmount])

  const surchargeAmount = useMemo(() => {
    if (!pricingProgram?.enabled || pricingProgram.model !== 'surcharge') return 0
    if (!selectedMethod || selectedMethod === 'cash') return 0
    const pct = pricingProgram.surchargePercent ?? 0
    if (pct <= 0) return 0
    const applies =
      (selectedMethod === 'credit' && (pricingProgram.surchargeApplyToCredit ?? true)) ||
      (selectedMethod === 'debit' && (pricingProgram.surchargeApplyToDebit ?? false))
    if (!applies) return 0
    return Math.round(currentTotal * (pct / 100) * 100) / 100
  }, [pricingProgram, selectedMethod, currentTotal])

  if (!isOpen) return null

  if (loadingOrder) {
    return (
      <div className={overlayClasses}>
        <div className="bg-slate-900/95 backdrop-blur-xl rounded-2xl p-8 text-center border border-white/[0.08]">
          <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading order...</p>
        </div>
      </div>
    )
  }

  const maybeShowFeedback = (receiptData?: Record<string, unknown>) => {
    if (feedbackSettings?.enabled && feedbackSettings?.promptAfterPayment) {
      setPendingReceiptData(receiptData)
      setShowFeedbackPrompt(true)
    } else {
      onPaymentComplete(receiptData)
    }
  }


  const handleSelectMethod = (method: PaymentMethod) => {
    setSelectedMethod(method)
    setTipAmount(0)
    setCustomTip('')
    setError(null)

    if (method === 'gift_card') { setStep('gift_card') }
    else if (method === 'house_account') { setStep('house_account') }
    else if (method === 'room_charge') { setStep('room_charge') }
    else if (tipSettings.enabled) { setStep('tip') }
    else if (method === 'cash') { setStep('cash') }
    else { setStep('datacap_card') }
  }

  const handleSplitPayment = () => { setError(null); setStep('split') }

  const handleCashExact = () => {
    setSelectedMethod('cash')
    setTipAmount(0)
    const payment: PendingPayment = { method: 'cash', amount: cashTotal, tipAmount: 0, amountTendered: cashTotal }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  const handleChargeExistingCard = async (card: TabCard) => {
    if (!orderId || !employeeId) return
    setIsProcessing(true); setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/close-tab`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, tipMode: 'receipt', orderCardId: card.id }),
      })
      const data = await res.json()
      if (data.data?.success) { maybeShowFeedback() }
      else { setError(data.data?.error?.message || data.error || 'Capture failed') }
    } catch { setError('Failed to charge card') }
    finally { setIsProcessing(false) }
  }

  const handleAddCardToTab = async () => {
    if (!orderId || !locationId) return
    const timing = startPaymentTiming('start_tab', orderId)
    setAddingCard(true); setAddCardError(null); setTabAuthSlow(false); setTabAuthSuccess(null)
    const slowTimer = setTimeout(() => setTabAuthSlow(true), 15000)
    try {
      if (!terminalId) {
        clearTimeout(slowTimer); completePaymentTiming(timing, 'error')
        setAddCardError('No card reader configured'); setAddingCard(false); return
      }
      markRequestSent(timing)
      const res = await fetch(`/api/orders/${orderId}/cards`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readerId: terminalId, employeeId, makeDefault: (tabCards?.length || 0) === 0 }),
      })
      clearTimeout(slowTimer)
      const data = await res.json()
      markGatewayResponse(timing)
      if (data.data?.approved) {
        completePaymentTiming(timing, 'success')
        const last4 = data.data.cardLast4 || '****'
        const cardType = data.data.cardType || 'Card'
        setTabAuthSuccess(`${cardType} \u2022\u2022\u2022${last4} authorized`)
        if (onTabCardsChanged) onTabCardsChanged()
        setTimeout(() => setTabAuthSuccess(null), 1500)
      } else {
        completePaymentTiming(timing, 'declined')
        setAddCardError(data.data?.error?.message || data.error || 'Card declined')
      }
    } catch { clearTimeout(slowTimer); completePaymentTiming(timing, 'error'); setAddCardError('Failed to add card') }
    finally { setAddingCard(false); setTabAuthSlow(false) }
  }

  const handleManualEntrySuccess = (result: ManualCardEntryResult) => {
    setShowManualEntry(false)
    const timing = startPaymentTiming('pay_close', orderId || undefined)
    timing.method = 'credit'
    markGatewayResponse(timing)
    cardTimingRef.current = timing
    const payment: PendingPayment = {
      method: 'credit', amount: currentTotal, tipAmount,
      cardBrand: result.cardType || 'card', cardLast4: result.cardLast4 || '0000',
      datacapRecordNo: result.recordNo, datacapRefNumber: result.authCode,
      datacapSequenceNo: result.sequenceNo, authCode: result.authCode,
      entryMethod: 'Manual', amountAuthorized: result.amountAuthorized ? parseFloat(result.amountAuthorized) : undefined,
      appliedPricingTier: 'credit',
    }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  const buildPayBody = (payments: PendingPayment[]) => ({
    payments: payments.map(p => ({
      method: p.method, amount: p.amount + (p.method !== 'cash' && surchargeAmount > 0 ? surchargeAmount : 0),
      tipAmount: p.tipAmount, amountTendered: p.amountTendered, cardBrand: p.cardBrand, cardLast4: p.cardLast4,
      giftCardId: p.giftCardId, giftCardNumber: p.giftCardNumber, houseAccountId: p.houseAccountId,
      selectionId: p.selectionId, roomNumber: p.roomNumber, guestName: p.guestName, pmsReservationId: p.pmsReservationId,
      ...(p.datacapRecordNo && p.datacapRefNumber ? { datacapRecordNo: p.datacapRecordNo, datacapRefNumber: p.datacapRefNumber, datacapSequenceNo: p.datacapSequenceNo, authCode: p.authCode, entryMethod: p.entryMethod, signatureData: p.signatureData, amountAuthorized: p.amountAuthorized, storedOffline: p.storedOffline } : {}),
      appliedPricingTier: p.appliedPricingTier || (p.method === 'cash' ? 'cash' : 'credit'),
      ...(p.detectedCardType ? { detectedCardType: p.detectedCardType } : {}),
      ...(p.walletType ? { walletType: p.walletType } : {}),
    })),
    employeeId, terminalId, idempotencyKey, version: getOrderVersion(),
  })

  const processPayments = async (payments: PendingPayment[], currentPendingPayments: PendingPayment[]) => {
    if (!orderId) { setError('Cannot process payment: No order ID. Please close and try again.'); return }
    setIsProcessing(true); setError(null)
    const isCashOnly = payments.every(p => p.method === 'cash') && currentPendingPayments.length === 0
    const timing = isCashOnly ? (() => { const t = startPaymentTiming('pay_close', orderId); t.method = 'cash'; return t })() : cardTimingRef.current
    try {
      if (waitForOrderReady) await waitForOrderReady()
      if (timing) markRequestSent(timing)
      const res = await fetch(`/api/orders/${orderId}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayBody(payments)) })
      if (!res.ok) {
        if (timing) completePaymentTiming(timing, 'error')
        if (await handleVersionConflict(res, orderId)) return
        const d = await res.json().catch(() => ({}))
        if (isCashOnly) { toast.error(`Cash payment failed: ${d.error || 'Server error'}`); return }
        throw new Error(d.error || 'Payment failed')
      }
      const result = (await res.json()).data ?? {}
      if (timing) { completePaymentTiming(timing, 'success'); if (!isCashOnly) cardTimingRef.current = null }
      if (isCashOnly) { maybeShowFeedback(); return }
      setPendingPayments(payments)
      if (result.recognizedCustomer) {
        const rc = result.recognizedCustomer
        toast.info(`Returning customer: ${rc.name}${rc.visitCount > 1 ? ` (${rc.visitCount} visits)` : ''} — ${rc.cardType} ****${rc.cardLast4}`, 8000)
      }
      if (result.orderStatus === 'paid') { maybeShowFeedback(result.receiptData) }
      else { setStep('method'); setSelectedMethod(null); setTipAmount(0) }
    } catch (err) {
      if (timing && !isCashOnly) { completePaymentTiming(timing, 'error'); cardTimingRef.current = null }
      if (isCashOnly) toast.error('Cash payment failed — check network')
      else setError(err instanceof Error ? err.message : 'Payment failed')
    } finally { setIsProcessing(false) }
  }


  const contextValue = {
    orderId, effectiveOrderTotal, effectiveSubtotal, employeeId, terminalId, locationId,
    dualPricing, tipSettings, paymentSettings, priceRounding, pricingProgram, feedbackSettings, tipExemptAmount,
    cashTotal, cardTotal, debitTotal, creditTotal, currentTotal, remainingBeforeTip, totalWithTip,
    surchargeAmount, cashRoundingAdjustment, alreadyPaid, pendingTotal, discountPercent,
    step, setStep, selectedMethod, setSelectedMethod, pendingPayments, setPendingPayments,
    tipAmount, setTipAmount, customTip, setCustomTip, isProcessing, setIsProcessing, error, setError, isConnected,
    tabCards, onTabCardsChanged, tabIncrementFailed,
    cardDetectionResult, setCardDetectionResult, canKeyedEntry,
    handleSelectMethod, handleChargeExistingCard, handleAddCardToTab, handleCashExact, handleSplitPayment,
    processPayments, maybeShowFeedback,
    addingCard, addCardError, tabAuthSlow, tabAuthSuccess,
    showManualEntry, setShowManualEntry,
  }


  return (
    <>
      <div className={overlayClasses}>
        <div className={modalClasses}>
          {/* Header */}
          <div className={headerClasses}>
            <h2 className="text-slate-100 text-xl font-bold m-0">Pay Order</h2>
            <button
              onClick={onClose}
              className="bg-transparent border-none text-slate-500 cursor-pointer p-1 hover:text-slate-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className={contentClasses}>
            <PaymentProvider value={contextValue}>
              <OrderSummary />
              <PaymentStepErrorBoundary onReset={() => setStep('method')}>
                {step === 'method' && <PaymentMethodStep />}
                {step === 'split' && <SplitPaymentStep />}
                {step === 'tip' && <TipEntryStep />}
                {step === 'cash' && <CashEntryStep />}
                {step === 'datacap_card' && <CardProcessingStep />}
                {step === 'gift_card' && <GiftCardStep />}
                {step === 'house_account' && <HouseAccountStep />}
                {step === 'room_charge' && <RoomChargeStep />}
              </PaymentStepErrorBoundary>
            </PaymentProvider>
          </div>

          {/* Footer */}
          <div className={footerClasses}>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className={`w-full py-3 px-4 rounded-[10px] border border-slate-600/30 bg-transparent text-slate-400 text-[15px] font-medium ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.03]'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Manual Card Entry Modal */}
      {orderId && (
        <ManualCardEntryModal
          isOpen={showManualEntry}
          onClose={() => setShowManualEntry(false)}
          amount={currentTotal}
          tipAmount={tipAmount}
          orderId={orderId}
          onSuccess={handleManualEntrySuccess}
          onError={(errMsg) => toast.error(errMsg)}
        />
      )}

      {/* Post-payment feedback prompt */}
      {showFeedbackPrompt && orderId && locationId && (
        <FeedbackPrompt
          orderId={orderId}
          locationId={locationId}
          employeeId={employeeId}
          ratingScale={feedbackSettings?.ratingScale ?? 5}
          requireComment={feedbackSettings?.requireComment ?? false}
          onClose={() => { setShowFeedbackPrompt(false); onPaymentComplete(pendingReceiptData) }}
        />
      )}
    </>
  )
}

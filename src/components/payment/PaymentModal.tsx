'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice, applyPriceRounding } from '@/lib/pricing'
import { calculateTip, getQuickCashAmounts, calculateChange, PAYMENT_METHOD_LABELS } from '@/lib/payment'
import type { DualPricingSettings, TipSettings, PaymentSettings, PriceRoundingSettings } from '@/lib/settings'
import { DatacapPaymentProcessor } from './DatacapPaymentProcessor'
import type { DatacapResult } from '@/hooks/useDatacap'
import { toast } from '@/stores/toast-store'

export interface TabCard {
  id: string
  cardType: string
  cardLast4: string
  cardholderName?: string | null
  authAmount: number
  isDefault: boolean
}

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
  orderTotal: number
  remainingBalance?: number
  subtotal?: number
  existingPayments?: { method: string; totalAmount: number }[]
  tabCards?: TabCard[]  // Pre-authed cards on tab — show "Charge existing card" option
  dualPricing: DualPricingSettings
  tipSettings?: TipSettings
  paymentSettings: PaymentSettings
  priceRounding?: PriceRoundingSettings
  onPaymentComplete: (receiptData?: Record<string, unknown>) => void
  onTabCardsChanged?: () => void  // Called when a card is added so parent can refresh
  employeeId?: string
  terminalId?: string  // Required for Datacap integration
  locationId?: string  // Required for Datacap integration
  initialMethod?: 'cash' | 'credit'  // Skip method selection, go straight to payment
  waitForOrderReady?: () => Promise<void>  // Await background items persist before /pay
}

interface PendingPayment {
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account'
  amount: number
  tipAmount: number
  amountTendered?: number
  cardBrand?: string
  cardLast4?: string
  giftCardId?: string
  giftCardNumber?: string
  houseAccountId?: string
  // Datacap Direct fields
  datacapRecordNo?: string
  datacapRefNumber?: string
  datacapSequenceNo?: string
  authCode?: string
  entryMethod?: string
  signatureData?: string
  amountAuthorized?: number
}

interface GiftCardInfo {
  id: string
  cardNumber: string
  currentBalance: number
  status: string
}

interface HouseAccountInfo {
  id: string
  name: string
  currentBalance: number
  creditLimit: number
  status: string
}

type PaymentStep = 'method' | 'cash' | 'tip' | 'gift_card' | 'house_account' | 'datacap_card'

// Default tip settings
const DEFAULT_TIP_SETTINGS: TipSettings = {
  enabled: true,
  suggestedPercentages: [15, 18, 20, 25],
  calculateOn: 'subtotal',
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
}: PaymentModalProps) {
  // ALL HOOKS MUST BE AT THE TOP - before any conditional returns
  // State for fetched order data (when orderTotal is not provided)
  const [fetchedOrderTotal, setFetchedOrderTotal] = useState<number | null>(null)
  const [fetchedSubtotal, setFetchedSubtotal] = useState<number | null>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)

  // Payment flow state — skip to the right step if initialMethod provided
  const [step, setStep] = useState<PaymentStep>(
    initialMethod === 'cash' ? 'cash' : initialMethod === 'credit' ? 'datacap_card' : 'method'
  )
  const [selectedMethod, setSelectedMethod] = useState<'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | null>(initialMethod || null)
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([])
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)

  // Cash payment state
  const [amountTendered, setAmountTendered] = useState('')
  const [customCashAmount, setCustomCashAmount] = useState('')
  const [cashTendered, setCashTendered] = useState(0)
  const [cashComplete, setCashComplete] = useState(false)

  // Gift card state
  const [giftCardNumber, setGiftCardNumber] = useState('')
  const [giftCardInfo, setGiftCardInfo] = useState<GiftCardInfo | null>(null)
  const [giftCardLoading, setGiftCardLoading] = useState(false)
  const [giftCardError, setGiftCardError] = useState<string | null>(null)

  // House account state
  const [houseAccounts, setHouseAccounts] = useState<HouseAccountInfo[]>([])
  const [selectedHouseAccount, setSelectedHouseAccount] = useState<HouseAccountInfo | null>(null)
  const [houseAccountSearch, setHouseAccountSearch] = useState('')
  const [houseAccountsLoading, setHouseAccountsLoading] = useState(false)

  // Add card to tab state
  const [addingCard, setAddingCard] = useState(false)
  const [addCardError, setAddCardError] = useState<string | null>(null)

  // Fetch order data if orderTotal is 0 or not provided
  useEffect(() => {
    if (isOpen && orderId && orderTotal === 0) {
      setLoadingOrder(true)
      fetch(`/api/orders/${orderId}`)
        .then(res => res.json())
        .then(data => {
          setFetchedOrderTotal(data.total || 0)
          setFetchedSubtotal(data.subtotal || 0)
        })
        .catch(err => {
          console.error('Failed to fetch order:', err)
        })
        .finally(() => {
          setLoadingOrder(false)
        })
    }
  }, [isOpen, orderId, orderTotal])

  // Use fetched total if orderTotal was 0
  const effectiveOrderTotal = orderTotal > 0 ? orderTotal : (fetchedOrderTotal ?? 0)
  // Use subtotal from props or fetched or default to orderTotal
  const effectiveSubtotal = subtotal ?? fetchedSubtotal ?? effectiveOrderTotal

  // Calculate amounts (memoized to prevent unnecessary recalculations)
  // ALL hooks must be before any conditional returns
  const alreadyPaid = useMemo(
    () => existingPayments.reduce((sum, p) => sum + p.totalAmount, 0),
    [existingPayments]
  )

  const pendingTotal = useMemo(
    () => pendingPayments.reduce((sum, p) => sum + p.amount + p.tipAmount, 0),
    [pendingPayments]
  )

  const remainingBeforeTip = useMemo(() => {
    const raw = effectiveOrderTotal - alreadyPaid - pendingTotal
    if (raw <= 0) return 0
    // When price rounding is active, a tiny leftover (e.g., $0.04 from quarter rounding)
    // is a rounding artifact — not a real balance. If it rounds to $0, treat as paid in full.
    if (priceRounding?.enabled && priceRounding.applyToCash) {
      const rounded = applyPriceRounding(raw, priceRounding, 'cash')
      if (rounded <= 0) return 0
    }
    return raw
  }, [effectiveOrderTotal, alreadyPaid, pendingTotal, priceRounding])

  // Apply dual pricing - card price is displayed, cash gets discount (memoized)
  const discountPercent = dualPricing.cashDiscountPercent || 4.0

  const cashTotal = useMemo(
    () => priceRounding
      ? applyPriceRounding(remainingBeforeTip, priceRounding, 'cash')
      : remainingBeforeTip,
    [remainingBeforeTip, priceRounding]
  )

  const cardTotal = useMemo(
    () => dualPricing.enabled
      ? calculateCardPrice(remainingBeforeTip, discountPercent)
      : remainingBeforeTip,
    [dualPricing.enabled, remainingBeforeTip, discountPercent]
  )

  const currentTotal = useMemo(
    () => selectedMethod === 'cash' ? cashTotal : cardTotal,
    [selectedMethod, cashTotal, cardTotal]
  )

  // Rounding adjustment for display (e.g., $3.29 → $3.25 = -$0.04)
  const cashRoundingAdjustment = useMemo(
    () => Math.round((cashTotal - remainingBeforeTip) * 100) / 100,
    [cashTotal, remainingBeforeTip]
  )

  const totalWithTip = useMemo(
    () => currentTotal + tipAmount,
    [currentTotal, tipAmount]
  )

  // Quick cash amounts (memoized)
  const quickAmounts = useMemo(
    () => getQuickCashAmounts(totalWithTip),
    [totalWithTip]
  )

  // Don't render if not open
  if (!isOpen) return null

  // Show loading while fetching order
  if (loadingOrder) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
        <div style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(20px)', borderRadius: 16, padding: 32, textAlign: 'center', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ width: 32, height: 32, border: '4px solid rgba(99, 102, 241, 0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: '#94a3b8' }}>Loading order...</p>
        </div>
      </div>
    )
  }

  const handleSelectMethod = (method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account') => {
    setSelectedMethod(method)
    setTipAmount(0)
    setCustomTip('')
    setError(null)

    if (method === 'gift_card') {
      setGiftCardNumber('')
      setGiftCardInfo(null)
      setGiftCardError(null)
      setStep('gift_card')
    } else if (method === 'house_account') {
      setSelectedHouseAccount(null)
      setHouseAccountSearch('')
      loadHouseAccounts()
      setStep('house_account')
    } else if (tipSettings.enabled) {
      setStep('tip')
    } else if (method === 'cash') {
      setStep('cash')
    } else {
      // All card payments go through Datacap (simulated or real)
      setStep('datacap_card')
    }
  }

  // Close tab by capturing against a pre-authed card
  const handleChargeExistingCard = async (card: TabCard) => {
    if (!orderId || !employeeId) return
    setIsProcessing(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/close-tab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          tipMode: 'receipt', // Bartender enters tip later
          orderCardId: card.id, // Charge this specific card
        }),
      })
      const data = await res.json()
      if (data.data?.success) {
        onPaymentComplete()
      } else {
        setError(data.data?.error?.message || data.error || 'Capture failed')
      }
    } catch (err) {
      setError('Failed to charge card')
    } finally {
      setIsProcessing(false)
    }
  }

  // Add another card to an open tab
  const handleAddCardToTab = async () => {
    if (!orderId || !locationId) return
    setAddingCard(true)
    setAddCardError(null)

    try {
      // Use terminalId (the reader/terminal assigned to this POS station)
      if (!terminalId) {
        setAddCardError('No card reader configured')
        setAddingCard(false)
        return
      }

      const res = await fetch(`/api/orders/${orderId}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readerId: terminalId,
          employeeId,
          makeDefault: (tabCards?.length || 0) === 0, // First card is default
        }),
      })

      const data = await res.json()

      if (data.data?.approved) {
        // Success — refresh the tab cards list
        if (onTabCardsChanged) {
          onTabCardsChanged()
        }
        toast.success(`${data.data.cardType} \u2022\u2022\u2022${data.data.cardLast4} added to tab`)
      } else {
        setAddCardError(data.data?.error?.message || data.error || 'Card declined')
      }
    } catch {
      setAddCardError('Failed to add card')
    } finally {
      setAddingCard(false)
    }
  }

  const loadHouseAccounts = async () => {
    setHouseAccountsLoading(true)
    try {
      const response = await fetch(`/api/house-accounts?locationId=${orderId?.split('-')[0] || ''}&status=active`)
      if (response.ok) {
        const data = await response.json()
        setHouseAccounts(data)
      }
    } catch {
      console.error('Failed to load house accounts')
    } finally {
      setHouseAccountsLoading(false)
    }
  }

  const lookupGiftCard = async () => {
    if (!giftCardNumber.trim()) {
      setGiftCardError('Please enter a gift card number')
      return
    }

    setGiftCardLoading(true)
    setGiftCardError(null)

    try {
      const response = await fetch(`/api/gift-cards/${giftCardNumber.trim().toUpperCase()}`)
      if (!response.ok) {
        const data = await response.json()
        setGiftCardError(data.error || 'Gift card not found')
        setGiftCardInfo(null)
        return
      }

      const data = await response.json()
      if (data.status !== 'active') {
        setGiftCardError(`Gift card is ${data.status}`)
        setGiftCardInfo(null)
        return
      }

      setGiftCardInfo(data)
    } catch {
      setGiftCardError('Failed to lookup gift card')
      setGiftCardInfo(null)
    } finally {
      setGiftCardLoading(false)
    }
  }

  const handleGiftCardPayment = () => {
    if (!giftCardInfo) return

    const maxAmount = Math.min(giftCardInfo.currentBalance, totalWithTip)

    const payment: PendingPayment = {
      method: 'gift_card',
      amount: maxAmount,
      tipAmount: 0, // Tips handled separately
      giftCardId: giftCardInfo.id,
      giftCardNumber: giftCardInfo.cardNumber,
    }
    processPayments([...pendingPayments, payment])
  }

  const handleHouseAccountPayment = () => {
    if (!selectedHouseAccount) return

    const payment: PendingPayment = {
      method: 'house_account',
      amount: currentTotal,
      tipAmount,
      houseAccountId: selectedHouseAccount.id,
    }
    processPayments([...pendingPayments, payment])
  }

  const handleSelectTip = (percent: number | null) => {
    if (percent === null) {
      setTipAmount(0)
    } else {
      const tip = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, effectiveOrderTotal)
      setTipAmount(tip)
    }
    setCustomTip('')
  }

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
  }

  const handleContinueFromTip = () => {
    // Safety: Validate selectedMethod before proceeding
    if (!selectedMethod) {
      setError('No payment method selected. Please go back and select a payment method.')
      return
    }

    if (selectedMethod === 'cash') {
      setStep('cash')
    } else if (selectedMethod === 'credit' || selectedMethod === 'debit') {
      // Validate terminal configuration for card payments
      if (!terminalId) {
        setError('Terminal not configured. Cannot process card payments. Please contact support.')
        setStep('method') // Go back to method selection
        return
      }
      // All card payments go through Datacap (simulated or real)
      setStep('datacap_card')
    } else {
      // Other payment methods (gift card, house account)
      setStep(selectedMethod as PaymentStep)
    }
  }

  const handleCashTender = (amount: number) => {
    const newTotal = cashTendered + amount
    setCashTendered(newTotal)
    if (newTotal >= totalWithTip) {
      setCashComplete(true)
    }
  }

  const handleCashFinalize = () => {
    const payment: PendingPayment = {
      method: 'cash',
      amount: currentTotal,
      tipAmount,
      amountTendered: cashTendered,
    }
    // Don't add to pendingPayments yet — wait for API success
    // (adding before API call corrupts totals if the call fails)
    processPayments([...pendingPayments, payment])
  }

  // Handle Datacap payment success
  const handleDatacapSuccess = (result: DatacapResult & { tipAmount: number }) => {
    // Safety: Validate selectedMethod is a valid card type
    if (selectedMethod !== 'credit' && selectedMethod !== 'debit') {
      setError(`Invalid payment method for card transaction: ${selectedMethod}. Expected 'credit' or 'debit'.`)
      setStep('method') // Go back to method selection
      return
    }

    const payment: PendingPayment = {
      method: selectedMethod, // Now type-safe after validation
      amount: currentTotal,
      tipAmount: result.tipAmount,
      cardBrand: result.cardBrand || 'card',
      cardLast4: result.cardLast4 || '0000',
      // Datacap fields for pay API
      datacapRecordNo: result.recordNo,
      datacapRefNumber: result.refNumber,
      datacapSequenceNo: result.sequenceNo,
      authCode: result.authCode,
      entryMethod: result.entryMethod,
      signatureData: result.signatureData,
      amountAuthorized: result.amountAuthorized,
    }
    processPayments([...pendingPayments, payment])
  }

  // Build the /pay request body (shared between sync and fire-and-forget paths)
  const buildPayBody = (payments: PendingPayment[]) => ({
    payments: payments.map(p => ({
      method: p.method,
      amount: p.amount,
      tipAmount: p.tipAmount,
      amountTendered: p.amountTendered,
      cardBrand: p.cardBrand,
      cardLast4: p.cardLast4,
      giftCardId: p.giftCardId,
      giftCardNumber: p.giftCardNumber,
      houseAccountId: p.houseAccountId,
      // Datacap Direct fields — only include if we have the required fields
      ...(p.datacapRecordNo && p.datacapRefNumber ? {
        datacapRecordNo: p.datacapRecordNo,
        datacapRefNumber: p.datacapRefNumber,
        datacapSequenceNo: p.datacapSequenceNo,
        authCode: p.authCode,
        entryMethod: p.entryMethod,
        signatureData: p.signatureData,
        amountAuthorized: p.amountAuthorized,
      } : {}),
    })),
    employeeId,
    idempotencyKey,
  })

  const processPayments = async (payments: PendingPayment[]) => {
    // Safety: Validate orderId exists before attempting payment
    if (!orderId) {
      setError('Cannot process payment: No order ID provided. Please close this dialog and try again.')
      setIsProcessing(false)
      return
    }

    // Cash-only full payment — await the API before closing so failures are surfaced
    const isCashOnly = payments.every(p => p.method === 'cash') && pendingPayments.length === 0
    if (isCashOnly) {
      setIsProcessing(true)
      setError(null)
      try {
        if (waitForOrderReady) await waitForOrderReady()
        const res = await fetch(`/api/orders/${orderId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayBody(payments)),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(`Cash payment failed: ${data.error || 'Server error'}`)
          setIsProcessing(false)
          return
        }
        onPaymentComplete() // no receiptData → parent skips receipt modal
      } catch {
        toast.error('Cash payment failed — check network connection')
        setIsProcessing(false)
      }
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      // Ensure items are persisted before calling /pay
      // (started in background when modal opened — typically already done by now)
      if (waitForOrderReady) {
        await waitForOrderReady()
      }

      const response = await fetch(`/api/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayBody(payments)),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Payment failed')
      }

      const result = await response.json()

      // Payment succeeded — now update pending payments state
      setPendingPayments(payments)

      if (result.orderStatus === 'paid') {
        onPaymentComplete(result.receiptData)
      } else {
        // Partial payment - reset for more payments
        setStep('method')
        setSelectedMethod(null)
        setTipAmount(0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
      // Reset cash state so user can retry
      setCashComplete(false)
      setCashTendered(0)
    } finally {
      setIsProcessing(false)
    }
  }

  const removePendingPayment = (index: number) => {
    setPendingPayments(pendingPayments.filter((_, i) => i !== index))
  }

  // Shared styles
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  }

  const modalStyle: React.CSSProperties = {
    background: 'rgba(15, 23, 42, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: 16,
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
    width: '100%',
    maxWidth: 448,
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  }

  const headerStyle: React.CSSProperties = {
    padding: 16,
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 16,
  }

  const footerStyle: React.CSSProperties = {
    padding: 16,
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  }

  const sectionLabelStyle: React.CSSProperties = {
    color: '#f1f5f9',
    fontWeight: 600,
    fontSize: 16,
    marginBottom: 8,
  }

  const mutedTextStyle: React.CSSProperties = {
    color: '#94a3b8',
    fontSize: 14,
  }

  const inputStyle: React.CSSProperties = {
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#ffffff',
    padding: '10px 12px',
    width: '100%',
    fontSize: 14,
    outline: 'none',
  }

  const backButtonStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid rgba(100, 116, 139, 0.3)',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
  }

  const primaryButtonStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 10,
    border: 'none',
    background: '#4f46e5',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  }

  const infoPanelStyle = (color: string): React.CSSProperties => ({
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    background: color,
  })

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 700, margin: 0 }}>Pay Order</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}
          >
            <svg style={{ width: 24, height: 24 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {error && (
            <div style={{ marginBottom: 16, padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 10, color: '#f87171', fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Order Summary */}
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(30, 41, 59, 0.6)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#94a3b8', marginBottom: 4 }}>
              <span>Order Total</span>
              <span style={{ color: '#f1f5f9', fontWeight: 500 }}>{formatCurrency(effectiveOrderTotal)}</span>
            </div>
            {alreadyPaid > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#22c55e' }}>
                <span>Already Paid</span>
                <span>-{formatCurrency(alreadyPaid)}</span>
              </div>
            )}
            {pendingPayments.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#818cf8' }}>
                <span>Pending</span>
                <span>-{formatCurrency(pendingTotal)}</span>
              </div>
            )}
            {selectedMethod === 'cash' && cashRoundingAdjustment !== 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#fbbf24', marginTop: 2 }}>
                <span>Rounding</span>
                <span>{cashRoundingAdjustment > 0 ? '+' : ''}{formatCurrency(cashRoundingAdjustment)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255, 255, 255, 0.08)', color: '#ffffff', fontSize: 18, fontFamily: 'ui-monospace, monospace' }}>
              <span>Remaining</span>
              <span>{formatCurrency(selectedMethod === 'cash' ? currentTotal : remainingBeforeTip)}</span>
            </div>
          </div>

          {/* Step: Select Payment Method */}
          {step === 'method' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={sectionLabelStyle}>Select Payment Method</h3>

              {/* Pre-authed tab cards — charge existing card */}
              {tabCards.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Cards on Tab</div>
                  {tabCards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleChargeExistingCard(card)}
                      disabled={isProcessing}
                      style={{
                        width: '100%',
                        height: 72,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '0 20px',
                        borderRadius: 12,
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                        background: 'rgba(168, 85, 247, 0.12)',
                        cursor: isProcessing ? 'wait' : 'pointer',
                        textAlign: 'left' as const,
                      }}
                    >
                      <span style={{ fontSize: 28 }}>💳</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#f1f5f9', fontSize: 17, fontWeight: 600 }}>
                          Charge •••{card.cardLast4}
                          {card.isDefault && <span style={{ marginLeft: 8, fontSize: 11, color: '#a78bfa', background: 'rgba(167, 139, 250, 0.15)', padding: '2px 6px', borderRadius: 4 }}>DEFAULT</span>}
                        </div>
                        <div style={{ color: '#c084fc', fontSize: 13 }}>
                          {card.cardType}{card.cardholderName ? ` — ${card.cardholderName}` : ''}
                          <span style={{ marginLeft: 8, color: '#94a3b8' }}>Pre-authed ${card.authAmount.toFixed(2)}</span>
                        </div>
                      </div>
                      <div style={{ color: '#e9d5ff', fontSize: 17, fontWeight: 700 }}>{formatCurrency(cardTotal)}</div>
                    </button>
                  ))}
                  <div style={{ height: 1, background: 'rgba(148, 163, 184, 0.15)', margin: '4px 0' }} />
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Or pay another way</div>
                </div>
              )}

              {/* Add Card to Tab — shown for any tab order (even with 0 cards) */}
              {onTabCardsChanged && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                  <button
                    onClick={handleAddCardToTab}
                    disabled={addingCard || isProcessing}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-slate-600 hover:border-blue-500 hover:bg-blue-500/10 transition-colors"
                    style={{
                      cursor: (addingCard || isProcessing) ? 'wait' : 'pointer',
                      opacity: (addingCard || isProcessing) ? 0.5 : 1,
                    }}
                  >
                    <span className="text-2xl">{'\uD83D\uDCB3'}</span>
                    <div className="text-left">
                      <div className="font-bold text-white">Add Card to Tab</div>
                      <div className="text-xs text-slate-400">Hold another card on this tab</div>
                    </div>
                  </button>

                  {addingCard && (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#60a5fa' }}>
                      <div style={{ width: 24, height: 24, border: '2px solid #60a5fa', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 8 }} />
                      <p>Waiting for card...</p>
                    </div>
                  )}
                  {addCardError && (
                    <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#f87171', fontSize: 14 }}>
                      {addCardError}
                    </div>
                  )}
                </div>
              )}

              {dualPricing.enabled && (
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8, padding: 10, background: 'rgba(34, 197, 94, 0.1)', borderRadius: 8, border: '1px solid rgba(34, 197, 94, 0.15)' }}>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>Cash: {formatCurrency(cashTotal)}</span>
                  <span style={{ margin: '0 8px', color: '#475569' }}>|</span>
                  <span>Card: {formatCurrency(cardTotal)}</span>
                </div>
              )}

              {paymentSettings.acceptCash && (
                <button
                  onClick={() => handleSelectMethod('cash')}
                  style={{
                    width: '100%',
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 20px',
                    borderRadius: 12,
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    background: 'rgba(34, 197, 94, 0.08)',
                    cursor: 'pointer',
                    textAlign: 'left' as const,
                  }}
                >
                  <span style={{ fontSize: 28 }}>💵</span>
                  <div>
                    <div style={{ color: '#f1f5f9', fontSize: 17, fontWeight: 600 }}>Cash</div>
                    <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 500 }}>
                      {formatCurrency(cashTotal)}
                      {dualPricing.enabled && dualPricing.showSavingsMessage && (
                        <span style={{ marginLeft: 8, color: '#4ade80' }}>Save {formatCurrency(cardTotal - cashTotal)}</span>
                      )}
                    </div>
                  </div>
                </button>
              )}

              {paymentSettings.acceptCredit && (
                <button
                  onClick={() => handleSelectMethod('credit')}
                  style={{
                    width: '100%',
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 20px',
                    borderRadius: 12,
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    background: 'rgba(99, 102, 241, 0.08)',
                    cursor: 'pointer',
                    textAlign: 'left' as const,
                  }}
                >
                  <span style={{ fontSize: 28 }}>💳</span>
                  <div>
                    <div style={{ color: '#f1f5f9', fontSize: 17, fontWeight: 600 }}>Credit Card</div>
                    <div style={{ color: '#818cf8', fontSize: 13 }}>{formatCurrency(cardTotal)}</div>
                  </div>
                </button>
              )}

              {paymentSettings.acceptDebit && (
                <button
                  onClick={() => handleSelectMethod('debit')}
                  style={{
                    width: '100%',
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 20px',
                    borderRadius: 12,
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    background: 'rgba(99, 102, 241, 0.08)',
                    cursor: 'pointer',
                    textAlign: 'left' as const,
                  }}
                >
                  <span style={{ fontSize: 28 }}>💳</span>
                  <div>
                    <div style={{ color: '#f1f5f9', fontSize: 17, fontWeight: 600 }}>Debit Card</div>
                    <div style={{ color: '#818cf8', fontSize: 13 }}>{formatCurrency(cardTotal)}</div>
                  </div>
                </button>
              )}

              {paymentSettings.acceptGiftCards && (
                <button
                  onClick={() => handleSelectMethod('gift_card')}
                  style={{
                    width: '100%',
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 20px',
                    borderRadius: 12,
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    background: 'rgba(168, 85, 247, 0.08)',
                    cursor: 'pointer',
                    textAlign: 'left' as const,
                  }}
                >
                  <span style={{ fontSize: 28 }}>🎁</span>
                  <div>
                    <div style={{ color: '#f1f5f9', fontSize: 17, fontWeight: 600 }}>Gift Card</div>
                    <div style={{ color: '#c084fc', fontSize: 13 }}>Enter gift card number</div>
                  </div>
                </button>
              )}

              {paymentSettings.acceptHouseAccounts && (
                <button
                  onClick={() => handleSelectMethod('house_account')}
                  style={{
                    width: '100%',
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 20px',
                    borderRadius: 12,
                    border: '1px solid rgba(100, 116, 139, 0.3)',
                    background: 'rgba(100, 116, 139, 0.08)',
                    cursor: 'pointer',
                    textAlign: 'left' as const,
                  }}
                >
                  <span style={{ fontSize: 28 }}>🏢</span>
                  <div>
                    <div style={{ color: '#f1f5f9', fontSize: 17, fontWeight: 600 }}>House Account</div>
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>Charge to account</div>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Step: Tip Selection */}
          {step === 'tip' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={sectionLabelStyle}>Add Tip</h3>
              <p style={{ ...mutedTextStyle, marginBottom: 8 }}>
                Paying with {selectedMethod === 'cash' ? 'Cash' : 'Card'}: {formatCurrency(currentTotal)}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {tipSettings.suggestedPercentages.map(percent => {
                  const tipForPercent = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, effectiveOrderTotal)
                  const isSelected = tipAmount === tipForPercent
                  return (
                    <button
                      key={percent}
                      onClick={() => handleSelectTip(percent)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: 64,
                        borderRadius: 10,
                        border: isSelected ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(100, 116, 139, 0.3)',
                        background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(30, 41, 59, 0.5)',
                        color: isSelected ? '#a5b4fc' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{percent}%</span>
                      <span style={{ fontSize: 12, marginTop: 2 }}>{formatCurrency(tipForPercent)}</span>
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => handleSelectTip(null)}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: 10,
                    border: tipAmount === 0 && !customTip ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(100, 116, 139, 0.3)',
                    background: tipAmount === 0 && !customTip ? 'rgba(99, 102, 241, 0.2)' : 'rgba(30, 41, 59, 0.5)',
                    color: tipAmount === 0 && !customTip ? '#a5b4fc' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  No Tip
                </button>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 11, color: '#64748b', fontSize: 14 }}>$</span>
                  <input
                    type="number"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    onBlur={handleCustomTip}
                    style={{ ...inputStyle, paddingLeft: 28 }}
                    placeholder="Custom"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <div style={infoPanelStyle('rgba(99, 102, 241, 0.15)')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#ffffff', fontSize: 18, fontFamily: 'ui-monospace, monospace' }}>
                  <span>Total with Tip</span>
                  <span>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => setStep('method')} style={backButtonStyle}>
                  Back
                </button>
                <button onClick={handleContinueFromTip} style={primaryButtonStyle}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step: Cash Payment */}
          {step === 'cash' && !cashComplete && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={sectionLabelStyle}>Cash Payment</h3>
              {/* Amount due and tendered so far */}
              <div style={infoPanelStyle('rgba(34, 197, 94, 0.12)')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20, fontFamily: 'ui-monospace, monospace' }}>
                  <span style={{ color: '#94a3b8' }}>Total Due</span>
                  <span style={{ color: '#22c55e' }}>{formatCurrency(totalWithTip)}</span>
                </div>
                {cashTendered > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 16, fontFamily: 'ui-monospace, monospace', marginTop: 6 }}>
                      <span style={{ color: '#94a3b8' }}>Tendered</span>
                      <span style={{ color: '#f1f5f9' }}>{formatCurrency(cashTendered)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, fontFamily: 'ui-monospace, monospace', marginTop: 4, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ color: '#fbbf24' }}>Remaining</span>
                      <span style={{ color: '#fbbf24' }}>{formatCurrency(Math.max(0, totalWithTip - cashTendered))}</span>
                    </div>
                  </>
                )}
              </div>

              <p style={{ ...mutedTextStyle, marginBottom: 4 }}>Tap bills received:</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {/* Exact amount button */}
                <button
                  onClick={() => handleCashTender(totalWithTip - cashTendered)}
                  disabled={isProcessing}
                  style={{
                    padding: '14px 8px',
                    borderRadius: 10,
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#22c55e',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    fontSize: 15,
                    fontWeight: 700,
                    opacity: isProcessing ? 0.5 : 1,
                    gridColumn: 'span 3',
                  }}
                >
                  Exact {formatCurrency(totalWithTip - cashTendered)}
                </button>
                {[1, 5, 10, 20, 50, 100].map(amount => (
                  <button
                    key={amount}
                    onClick={() => handleCashTender(amount)}
                    disabled={isProcessing}
                    style={{
                      padding: '16px 8px',
                      borderRadius: 10,
                      border: '1px solid rgba(100, 116, 139, 0.3)',
                      background: 'rgba(30, 41, 59, 0.5)',
                      color: '#f1f5f9',
                      cursor: isProcessing ? 'not-allowed' : 'pointer',
                      fontSize: 16,
                      fontWeight: 700,
                      opacity: isProcessing ? 0.5 : 1,
                    }}
                  >
                    {formatCurrency(amount)}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 6 }}>Custom amount:</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: 11, color: '#64748b', fontSize: 14 }}>$</span>
                    <input
                      type="number"
                      value={customCashAmount}
                      onChange={(e) => setCustomCashAmount(e.target.value)}
                      style={{ ...inputStyle, paddingLeft: 28 }}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const val = parseFloat(customCashAmount) || 0
                      if (val > 0) { handleCashTender(val); setCustomCashAmount('') }
                    }}
                    disabled={isProcessing || !customCashAmount}
                    style={{
                      ...primaryButtonStyle,
                      flex: 'none',
                      padding: '10px 20px',
                      opacity: (isProcessing || !customCashAmount) ? 0.5 : 1,
                      cursor: (isProcessing || !customCashAmount) ? 'not-allowed' : 'pointer',
                      background: '#16a34a',
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => { setCashTendered(0); setStep(tipSettings.enabled ? 'tip' : 'method') }}
                  style={{ ...backButtonStyle, flex: 1 }}
                >
                  Back
                </button>
                {cashTendered > 0 && (
                  <button
                    onClick={() => setCashTendered(0)}
                    style={{ ...backButtonStyle, flex: 1, color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Cash complete - change due screen */}
          {step === 'cash' && cashComplete && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', paddingTop: 16 }}>
              <div style={{ fontSize: 48, lineHeight: 1 }}>💵</div>
              <h3 style={{ ...sectionLabelStyle, fontSize: 22, textAlign: 'center', margin: 0 }}>Payment Complete</h3>

              <div style={{ ...infoPanelStyle('rgba(34, 197, 94, 0.12)'), width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 16, fontFamily: 'ui-monospace, monospace' }}>
                  <span style={{ color: '#94a3b8' }}>Total</span>
                  <span style={{ color: '#f1f5f9' }}>{formatCurrency(totalWithTip)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 16, fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
                  <span style={{ color: '#94a3b8' }}>Tendered</span>
                  <span style={{ color: '#f1f5f9' }}>{formatCurrency(cashTendered)}</span>
                </div>
                {cashTendered > totalWithTip && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 28, fontFamily: 'ui-monospace, monospace', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ color: '#fbbf24' }}>Change Due</span>
                    <span style={{ color: '#fbbf24' }}>{formatCurrency(cashTendered - totalWithTip)}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 8 }}>
                <button
                  onClick={handleCashFinalize}
                  disabled={isProcessing}
                  style={{
                    ...primaryButtonStyle,
                    flex: 1,
                    padding: '16px',
                    fontSize: 16,
                    fontWeight: 700,
                    opacity: isProcessing ? 0.5 : 1,
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    background: '#16a34a',
                  }}
                >
                  {isProcessing ? 'Processing...' : 'Done'}
                </button>
              </div>

              <button
                onClick={() => { setCashComplete(false); setCashTendered(0) }}
                style={{ ...backButtonStyle, width: '100%' }}
              >
                Start Over
              </button>
            </div>
          )}

          {/* Step: Datacap Direct Card Payment - No Terminal */}
          {step === 'datacap_card' && orderId && !terminalId && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ color: '#f87171', fontWeight: 700, marginBottom: 8, fontSize: 16 }}>Terminal Not Configured</p>
              <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>No terminal ID assigned. Card payments require a configured terminal.</p>
              <button onClick={() => setStep('method')} style={{ ...backButtonStyle, flex: 'none' }}>Back</button>
            </div>
          )}

          {/* Step: Datacap Direct Card Payment */}
          {step === 'datacap_card' && orderId && terminalId && employeeId && locationId && (
            <DatacapPaymentProcessor
              orderId={orderId}
              amount={currentTotal}
              subtotal={effectiveSubtotal}
              tipSettings={tipSettings}
              terminalId={terminalId}
              employeeId={employeeId}
              locationId={locationId}
              onSuccess={handleDatacapSuccess}
              onPartialApproval={(result) => {
                const partialPayment: PendingPayment = {
                  method: selectedMethod === 'debit' ? 'debit' : 'credit',
                  amount: result.amountAuthorized,
                  tipAmount: result.tipAmount,
                  cardBrand: result.cardBrand || 'card',
                  cardLast4: result.cardLast4 || '0000',
                  datacapRecordNo: result.recordNo,
                  datacapRefNumber: result.refNumber,
                  datacapSequenceNo: result.sequenceNo,
                  authCode: result.authCode,
                  entryMethod: result.entryMethod,
                  signatureData: result.signatureData,
                  amountAuthorized: result.amountAuthorized,
                }
                setPendingPayments(prev => [...prev, partialPayment])
                toast.info(`Partial approval: ${formatCurrency(result.amountAuthorized)} charged. ${formatCurrency(result.remainingBalance)} remaining.`)
                setStep('method')
              }}
              onCancel={() => setStep('method')}
            />
          )}

          {/* Step: Gift Card Payment */}
          {step === 'gift_card' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={sectionLabelStyle}>Gift Card Payment</h3>

              <div style={infoPanelStyle('rgba(168, 85, 247, 0.12)')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, fontFamily: 'ui-monospace, monospace' }}>
                  <span style={{ color: '#94a3b8' }}>Amount Due</span>
                  <span style={{ color: '#c084fc' }}>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 6 }}>Gift Card Number</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={giftCardNumber}
                    onChange={(e) => setGiftCardNumber(e.target.value.toUpperCase())}
                    style={{ ...inputStyle, flex: 1, textTransform: 'uppercase' as const }}
                    placeholder="GC-XXXX-XXXX-XXXX"
                  />
                  <button
                    onClick={lookupGiftCard}
                    disabled={giftCardLoading || !giftCardNumber.trim()}
                    style={{
                      ...backButtonStyle,
                      flex: 'none',
                      padding: '10px 16px',
                      opacity: (giftCardLoading || !giftCardNumber.trim()) ? 0.5 : 1,
                      cursor: (giftCardLoading || !giftCardNumber.trim()) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {giftCardLoading ? 'Looking...' : 'Lookup'}
                  </button>
                </div>
              </div>

              {giftCardError && (
                <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 10, color: '#f87171', fontSize: 14 }}>
                  {giftCardError}
                </div>
              )}

              {giftCardInfo && (
                <div style={{ padding: 16, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Card: {giftCardInfo.cardNumber}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#cbd5e1', fontWeight: 500 }}>Available Balance:</span>
                    <span style={{ fontSize: 22, fontWeight: 700, color: '#22c55e', fontFamily: 'ui-monospace, monospace' }}>
                      {formatCurrency(giftCardInfo.currentBalance)}
                    </span>
                  </div>
                  {giftCardInfo.currentBalance < totalWithTip && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#fbbf24' }}>
                      Partial payment of {formatCurrency(giftCardInfo.currentBalance)} will be applied.
                      Remaining: {formatCurrency(totalWithTip - giftCardInfo.currentBalance)}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => setStep('method')}
                  disabled={isProcessing}
                  style={{ ...backButtonStyle, opacity: isProcessing ? 0.5 : 1 }}
                >
                  Back
                </button>
                <button
                  onClick={handleGiftCardPayment}
                  disabled={isProcessing || !giftCardInfo || giftCardInfo.currentBalance === 0}
                  style={{
                    ...primaryButtonStyle,
                    background: '#7c3aed',
                    opacity: (isProcessing || !giftCardInfo || giftCardInfo?.currentBalance === 0) ? 0.5 : 1,
                    cursor: (isProcessing || !giftCardInfo || giftCardInfo?.currentBalance === 0) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isProcessing ? 'Processing...' : giftCardInfo && giftCardInfo.currentBalance >= totalWithTip
                    ? 'Pay Full Amount'
                    : giftCardInfo
                      ? `Pay ${formatCurrency(Math.min(giftCardInfo.currentBalance, totalWithTip))}`
                      : 'Apply Gift Card'}
                </button>
              </div>
            </div>
          )}

          {/* Step: House Account Payment */}
          {step === 'house_account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={sectionLabelStyle}>House Account</h3>

              <div style={infoPanelStyle('rgba(99, 102, 241, 0.12)')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, fontFamily: 'ui-monospace, monospace' }}>
                  <span style={{ color: '#94a3b8' }}>Amount to Charge</span>
                  <span style={{ color: '#818cf8' }}>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 6 }}>Search Account</label>
                <input
                  type="text"
                  value={houseAccountSearch}
                  onChange={(e) => setHouseAccountSearch(e.target.value)}
                  style={inputStyle}
                  placeholder="Search by name..."
                />
              </div>

              {houseAccountsLoading ? (
                <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8' }}>Loading accounts...</div>
              ) : (
                <div style={{ maxHeight: 192, overflowY: 'auto', borderRadius: 10, border: '1px solid rgba(100, 116, 139, 0.2)' }}>
                  {houseAccounts
                    .filter(acc =>
                      !houseAccountSearch ||
                      acc.name.toLowerCase().includes(houseAccountSearch.toLowerCase())
                    )
                    .map(account => {
                      const availableCredit = account.creditLimit > 0
                        ? account.creditLimit - account.currentBalance
                        : Infinity
                      const canCharge = availableCredit >= totalWithTip
                      const isSelected = selectedHouseAccount?.id === account.id

                      return (
                        <button
                          key={account.id}
                          style={{
                            width: '100%',
                            padding: 12,
                            textAlign: 'left' as const,
                            background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                            borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
                            border: 'none',
                            borderBlockEnd: '1px solid rgba(100, 116, 139, 0.1)',
                            cursor: canCharge ? 'pointer' : 'not-allowed',
                            opacity: canCharge ? 1 : 0.4,
                          }}
                          onClick={() => canCharge && setSelectedHouseAccount(account)}
                          disabled={!canCharge}
                        >
                          <div style={{ color: '#f1f5f9', fontWeight: 500 }}>{account.name}</div>
                          <div style={{ fontSize: 13, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                            <span>Balance: {formatCurrency(account.currentBalance)}</span>
                            <span>
                              {account.creditLimit > 0
                                ? `Limit: ${formatCurrency(account.creditLimit)}`
                                : 'No limit'}
                            </span>
                          </div>
                          {!canCharge && (
                            <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>
                              Insufficient credit available
                            </div>
                          )}
                        </button>
                      )
                    })}
                  {houseAccounts.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                      No house accounts available
                    </div>
                  )}
                </div>
              )}

              {selectedHouseAccount && (
                <div style={{ padding: 12, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: 10 }}>
                  <div style={{ color: '#f1f5f9', fontWeight: 500 }}>{selectedHouseAccount.name}</div>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>
                    Current balance: {formatCurrency(selectedHouseAccount.currentBalance)}
                    {selectedHouseAccount.creditLimit > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        (Available: {formatCurrency(selectedHouseAccount.creditLimit - selectedHouseAccount.currentBalance)})
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => setStep('method')}
                  disabled={isProcessing}
                  style={{ ...backButtonStyle, opacity: isProcessing ? 0.5 : 1 }}
                >
                  Back
                </button>
                <button
                  onClick={handleHouseAccountPayment}
                  disabled={isProcessing || !selectedHouseAccount}
                  style={{
                    ...primaryButtonStyle,
                    opacity: (isProcessing || !selectedHouseAccount) ? 0.5 : 1,
                    cursor: (isProcessing || !selectedHouseAccount) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isProcessing ? 'Processing...' : 'Charge to Account'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid rgba(100, 116, 139, 0.3)',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: 15,
              fontWeight: 500,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              opacity: isProcessing ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

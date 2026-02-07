'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { calculateTip, getQuickCashAmounts, calculateChange, PAYMENT_METHOD_LABELS } from '@/lib/payment'
import type { DualPricingSettings, TipSettings, PaymentSettings } from '@/lib/settings'
import { DatacapPaymentProcessor } from './DatacapPaymentProcessor'
import type { DatacapResult } from '@/hooks/useDatacap'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
  orderTotal: number
  remainingBalance?: number
  subtotal?: number
  existingPayments?: { method: string; totalAmount: number }[]
  dualPricing: DualPricingSettings
  tipSettings?: TipSettings
  paymentSettings: PaymentSettings
  onPaymentComplete: () => void
  employeeId?: string
  terminalId?: string  // Required for Datacap integration
  locationId?: string  // Required for Datacap integration
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
  dualPricing,
  tipSettings = DEFAULT_TIP_SETTINGS,
  paymentSettings,
  onPaymentComplete,
  employeeId,
  terminalId,
  locationId,
}: PaymentModalProps) {
  // ALL HOOKS MUST BE AT THE TOP - before any conditional returns
  // State for fetched order data (when orderTotal is not provided)
  const [fetchedOrderTotal, setFetchedOrderTotal] = useState<number | null>(null)
  const [fetchedSubtotal, setFetchedSubtotal] = useState<number | null>(null)
  const [loadingOrder, setLoadingOrder] = useState(false)

  // Payment flow state
  const [step, setStep] = useState<PaymentStep>('method')
  const [selectedMethod, setSelectedMethod] = useState<'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | null>(null)
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([])
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cash payment state
  const [amountTendered, setAmountTendered] = useState('')
  const [customCashAmount, setCustomCashAmount] = useState('')

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

  // Don't render if not open
  if (!isOpen) return null

  // Show loading while fetching order
  if (loadingOrder) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading order...</p>
        </div>
      </div>
    )
  }

  // Calculate amounts (memoized to prevent unnecessary recalculations)
  const alreadyPaid = useMemo(
    () => existingPayments.reduce((sum, p) => sum + p.totalAmount, 0),
    [existingPayments]
  )

  const pendingTotal = useMemo(
    () => pendingPayments.reduce((sum, p) => sum + p.amount + p.tipAmount, 0),
    [pendingPayments]
  )

  const remainingBeforeTip = useMemo(
    () => effectiveOrderTotal - alreadyPaid - pendingTotal,
    [effectiveOrderTotal, alreadyPaid, pendingTotal]
  )

  // Apply dual pricing - card price is displayed, cash gets discount (memoized)
  const discountPercent = dualPricing.cashDiscountPercent || 4.0

  const cashTotal = useMemo(
    () => remainingBeforeTip, // Original/stored price
    [remainingBeforeTip]
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

  const totalWithTip = useMemo(
    () => currentTotal + tipAmount,
    [currentTotal, tipAmount]
  )

  // Quick cash amounts (memoized)
  const quickAmounts = useMemo(
    () => getQuickCashAmounts(totalWithTip),
    [totalWithTip]
  )

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
    setPendingPayments([...pendingPayments, payment])
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
    setPendingPayments([...pendingPayments, payment])
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

  const handleCashPayment = (tendered: number) => {
    const payment: PendingPayment = {
      method: 'cash',
      amount: currentTotal,
      tipAmount,
      amountTendered: tendered,
    }
    setPendingPayments([...pendingPayments, payment])
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
      cardLast4: result.cardLast4 || '****',
      // Datacap fields for pay API
      datacapRecordNo: result.recordNo,
      datacapRefNumber: result.refNumber,
      datacapSequenceNo: result.sequenceNo,
      authCode: result.authCode,
      entryMethod: result.entryMethod,
      signatureData: result.signatureData,
      amountAuthorized: result.amountAuthorized,
    }
    setPendingPayments([...pendingPayments, payment])
    processPayments([...pendingPayments, payment])
  }

  const processPayments = async (payments: PendingPayment[]) => {
    // Safety: Validate orderId exists before attempting payment
    if (!orderId) {
      setError('Cannot process payment: No order ID provided. Please close this dialog and try again.')
      setIsProcessing(false)
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
            // Datacap Direct fields
            datacapRecordNo: p.datacapRecordNo,
            datacapRefNumber: p.datacapRefNumber,
            datacapSequenceNo: p.datacapSequenceNo,
            authCode: p.authCode,
            entryMethod: p.entryMethod,
            signatureData: p.signatureData,
            amountAuthorized: p.amountAuthorized,
          })),
          employeeId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Payment failed')
      }

      const result = await response.json()

      if (result.orderStatus === 'paid') {
        onPaymentComplete()
      } else {
        // Partial payment - reset for more payments
        setStep('method')
        setSelectedMethod(null)
        setTipAmount(0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const removePendingPayment = (index: number) => {
    setPendingPayments(pendingPayments.filter((_, i) => i !== index))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-xl font-bold">Pay Order</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Order Summary */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex justify-between text-sm">
              <span>Order Total</span>
              <span className="font-medium">{formatCurrency(effectiveOrderTotal)}</span>
            </div>
            {alreadyPaid > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Already Paid</span>
                <span>-{formatCurrency(alreadyPaid)}</span>
              </div>
            )}
            {pendingPayments.length > 0 && (
              <div className="flex justify-between text-sm text-blue-600">
                <span>Pending</span>
                <span>-{formatCurrency(pendingTotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold mt-2 pt-2 border-t">
              <span>Remaining</span>
              <span>{formatCurrency(remainingBeforeTip)}</span>
            </div>
          </div>

          {/* Step: Select Payment Method */}
          {step === 'method' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">Select Payment Method</h3>

              {dualPricing.enabled && (
                <div className="text-sm text-gray-600 mb-3 p-2 bg-green-50 rounded">
                  <span className="text-green-700 font-medium">Cash: {formatCurrency(cashTotal)}</span>
                  <span className="mx-2">|</span>
                  <span>Card: {formatCurrency(cardTotal)}</span>
                </div>
              )}

              {paymentSettings.acceptCash && (
                <Button
                  variant="outline"
                  className="w-full h-16 text-lg justify-start gap-4"
                  onClick={() => handleSelectMethod('cash')}
                >
                  <span className="text-2xl">💵</span>
                  <div className="text-left">
                    <div>Cash</div>
                    <div className="text-sm text-green-600 font-normal">
                      {formatCurrency(cashTotal)}
                      {dualPricing.enabled && dualPricing.showSavingsMessage && (
                        <span className="ml-2">Save {formatCurrency(cardTotal - cashTotal)}</span>
                      )}
                    </div>
                  </div>
                </Button>
              )}

              {paymentSettings.acceptCredit && (
                <Button
                  variant="outline"
                  className="w-full h-16 text-lg justify-start gap-4"
                  onClick={() => handleSelectMethod('credit')}
                >
                  <span className="text-2xl">💳</span>
                  <div className="text-left">
                    <div>Credit Card</div>
                    <div className="text-sm text-gray-500 font-normal">
                      {formatCurrency(cardTotal)}
                    </div>
                  </div>
                </Button>
              )}

              {paymentSettings.acceptDebit && (
                <Button
                  variant="outline"
                  className="w-full h-16 text-lg justify-start gap-4"
                  onClick={() => handleSelectMethod('debit')}
                >
                  <span className="text-2xl">💳</span>
                  <div className="text-left">
                    <div>Debit Card</div>
                    <div className="text-sm text-gray-500 font-normal">
                      {formatCurrency(cardTotal)}
                    </div>
                  </div>
                </Button>
              )}

              {paymentSettings.acceptGiftCards && (
                <Button
                  variant="outline"
                  className="w-full h-16 text-lg justify-start gap-4"
                  onClick={() => handleSelectMethod('gift_card')}
                >
                  <span className="text-2xl">🎁</span>
                  <div className="text-left">
                    <div>Gift Card</div>
                    <div className="text-sm text-gray-500 font-normal">
                      Enter gift card number
                    </div>
                  </div>
                </Button>
              )}

              {paymentSettings.acceptHouseAccounts && (
                <Button
                  variant="outline"
                  className="w-full h-16 text-lg justify-start gap-4"
                  onClick={() => handleSelectMethod('house_account')}
                >
                  <span className="text-2xl">🏢</span>
                  <div className="text-left">
                    <div>House Account</div>
                    <div className="text-sm text-gray-500 font-normal">
                      Charge to account
                    </div>
                  </div>
                </Button>
              )}
            </div>
          )}

          {/* Step: Tip Selection */}
          {step === 'tip' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">Add Tip</h3>
              <p className="text-sm text-gray-500 mb-3">
                Paying with {selectedMethod === 'cash' ? 'Cash' : 'Card'}: {formatCurrency(currentTotal)}
              </p>

              <div className="grid grid-cols-4 gap-2">
                {tipSettings.suggestedPercentages.map(percent => {
                  const tipForPercent = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, effectiveOrderTotal)
                  return (
                    <Button
                      key={percent}
                      variant={tipAmount === tipForPercent ? 'primary' : 'outline'}
                      className="flex-col h-16"
                      onClick={() => handleSelectTip(percent)}
                    >
                      <span className="font-bold">{percent}%</span>
                      <span className="text-xs">{formatCurrency(tipForPercent)}</span>
                    </Button>
                  )
                })}
              </div>

              <div className="flex gap-2 mt-3">
                <Button
                  variant={tipAmount === 0 && !customTip ? 'primary' : 'outline'}
                  className="flex-1"
                  onClick={() => handleSelectTip(null)}
                >
                  No Tip
                </Button>
                <div className="flex-1 flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                    <input
                      type="number"
                      value={customTip}
                      onChange={(e) => setCustomTip(e.target.value)}
                      onBlur={handleCustomTip}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                      placeholder="Custom"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <div className="flex justify-between font-bold">
                  <span>Total with Tip</span>
                  <span>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="flex-1" onClick={() => setStep('method')}>
                  Back
                </Button>
                <Button variant="primary" className="flex-1" onClick={handleContinueFromTip}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step: Cash Payment */}
          {step === 'cash' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">Cash Payment</h3>
              <div className="p-3 bg-green-50 rounded-lg mb-3">
                <div className="flex justify-between font-bold text-lg">
                  <span>Amount Due</span>
                  <span className="text-green-700">{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-2">Quick amounts:</p>
              <div className="grid grid-cols-4 gap-2">
                {quickAmounts.map(amount => (
                  <Button
                    key={amount}
                    variant="outline"
                    onClick={() => handleCashPayment(amount)}
                    disabled={isProcessing}
                  >
                    {formatCurrency(amount)}
                  </Button>
                ))}
              </div>

              <div className="mt-4">
                <label className="text-sm text-gray-600">Custom amount:</label>
                <div className="flex gap-2 mt-1">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                    <input
                      type="number"
                      value={customCashAmount}
                      onChange={(e) => setCustomCashAmount(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                      placeholder="0.00"
                      step="0.01"
                      min={totalWithTip}
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => handleCashPayment(parseFloat(customCashAmount) || totalWithTip)}
                    disabled={isProcessing || !customCashAmount}
                  >
                    Accept
                  </Button>
                </div>
              </div>

              {customCashAmount && parseFloat(customCashAmount) > totalWithTip && (
                <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
                  <div className="flex justify-between font-bold">
                    <span>Change Due</span>
                    <span>{formatCurrency(calculateChange(totalWithTip, parseFloat(customCashAmount)))}</span>
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => setStep(tipSettings.enabled ? 'tip' : 'method')}
              >
                Back
              </Button>
            </div>
          )}

          {/* Step: Datacap Direct Card Payment */}
          {step === 'datacap_card' && orderId && !terminalId && (
            <div className="text-center py-8">
              <p className="text-red-500 font-bold mb-2">Terminal Not Configured</p>
              <p className="text-gray-500 text-sm mb-4">No terminal ID assigned. Card payments require a configured terminal.</p>
              <Button onClick={() => setStep('method')} variant="outline">Back</Button>
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
              onCancel={() => setStep('method')}
            />
          )}

          {/* Step: Gift Card Payment */}
          {step === 'gift_card' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">Gift Card Payment</h3>

              <div className="p-3 bg-purple-50 rounded-lg mb-3">
                <div className="flex justify-between font-bold text-lg">
                  <span>Amount Due</span>
                  <span>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600 block mb-1">Gift Card Number</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={giftCardNumber}
                    onChange={(e) => setGiftCardNumber(e.target.value.toUpperCase())}
                    className="flex-1 px-3 py-2 border rounded-lg uppercase"
                    placeholder="GC-XXXX-XXXX-XXXX"
                  />
                  <Button
                    variant="outline"
                    onClick={lookupGiftCard}
                    disabled={giftCardLoading || !giftCardNumber.trim()}
                  >
                    {giftCardLoading ? 'Looking...' : 'Lookup'}
                  </Button>
                </div>
              </div>

              {giftCardError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {giftCardError}
                </div>
              )}

              {giftCardInfo && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">Card: {giftCardInfo.cardNumber}</div>
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Available Balance:</span>
                    <span className="text-xl font-bold text-green-600">
                      {formatCurrency(giftCardInfo.currentBalance)}
                    </span>
                  </div>
                  {giftCardInfo.currentBalance < totalWithTip && (
                    <div className="mt-2 text-sm text-amber-600">
                      Partial payment of {formatCurrency(giftCardInfo.currentBalance)} will be applied.
                      Remaining: {formatCurrency(totalWithTip - giftCardInfo.currentBalance)}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep('method')}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleGiftCardPayment}
                  disabled={isProcessing || !giftCardInfo || giftCardInfo.currentBalance === 0}
                >
                  {isProcessing ? 'Processing...' : giftCardInfo && giftCardInfo.currentBalance >= totalWithTip
                    ? 'Pay Full Amount'
                    : giftCardInfo
                      ? `Pay ${formatCurrency(Math.min(giftCardInfo.currentBalance, totalWithTip))}`
                      : 'Apply Gift Card'}
                </Button>
              </div>
            </div>
          )}

          {/* Step: House Account Payment */}
          {step === 'house_account' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">House Account</h3>

              <div className="p-3 bg-blue-50 rounded-lg mb-3">
                <div className="flex justify-between font-bold text-lg">
                  <span>Amount to Charge</span>
                  <span>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600 block mb-1">Search Account</label>
                <input
                  type="text"
                  value={houseAccountSearch}
                  onChange={(e) => setHouseAccountSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Search by name..."
                />
              </div>

              {houseAccountsLoading ? (
                <div className="text-center py-4 text-gray-500">Loading accounts...</div>
              ) : (
                <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
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

                      return (
                        <button
                          key={account.id}
                          className={`w-full p-3 text-left hover:bg-gray-50 ${
                            selectedHouseAccount?.id === account.id ? 'bg-blue-50' : ''
                          } ${!canCharge ? 'opacity-50' : ''}`}
                          onClick={() => canCharge && setSelectedHouseAccount(account)}
                          disabled={!canCharge}
                        >
                          <div className="font-medium">{account.name}</div>
                          <div className="text-sm text-gray-500 flex justify-between">
                            <span>Balance: {formatCurrency(account.currentBalance)}</span>
                            <span>
                              {account.creditLimit > 0
                                ? `Limit: ${formatCurrency(account.creditLimit)}`
                                : 'No limit'}
                            </span>
                          </div>
                          {!canCharge && (
                            <div className="text-xs text-red-500 mt-1">
                              Insufficient credit available
                            </div>
                          )}
                        </button>
                      )
                    })}
                  {houseAccounts.length === 0 && (
                    <div className="p-4 text-center text-gray-500">
                      No house accounts available
                    </div>
                  )}
                </div>
              )}

              {selectedHouseAccount && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="font-medium">{selectedHouseAccount.name}</div>
                  <div className="text-sm text-gray-600">
                    Current balance: {formatCurrency(selectedHouseAccount.currentBalance)}
                    {selectedHouseAccount.creditLimit > 0 && (
                      <span className="ml-2">
                        (Available: {formatCurrency(selectedHouseAccount.creditLimit - selectedHouseAccount.currentBalance)})
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep('method')}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleHouseAccountPayment}
                  disabled={isProcessing || !selectedHouseAccount}
                >
                  {isProcessing ? 'Processing...' : 'Charge to Account'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <Button variant="outline" className="w-full" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

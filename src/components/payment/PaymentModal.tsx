'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice } from '@/lib/pricing'
import { calculateTip, getQuickCashAmounts, calculateChange, PAYMENT_METHOD_LABELS } from '@/lib/payment'
import type { DualPricingSettings, TipSettings, PaymentSettings } from '@/lib/settings'

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
}

interface PendingPayment {
  method: 'cash' | 'credit' | 'debit'
  amount: number
  tipAmount: number
  amountTendered?: number
  cardBrand?: string
  cardLast4?: string
}

type PaymentStep = 'method' | 'cash' | 'card' | 'tip' | 'confirm'

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
}: PaymentModalProps) {
  // Don't render if not open
  if (!isOpen) return null

  // Use subtotal from props or default to orderTotal
  const effectiveSubtotal = subtotal ?? orderTotal
  const [step, setStep] = useState<PaymentStep>('method')
  const [selectedMethod, setSelectedMethod] = useState<'cash' | 'credit' | 'debit' | null>(null)
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([])
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cash payment state
  const [amountTendered, setAmountTendered] = useState('')
  const [customCashAmount, setCustomCashAmount] = useState('')

  // Card payment state
  const [cardLast4, setCardLast4] = useState('')
  const [cardBrand, setCardBrand] = useState('visa')

  // Calculate amounts
  const alreadyPaid = existingPayments.reduce((sum, p) => sum + p.totalAmount, 0)
  const pendingTotal = pendingPayments.reduce((sum, p) => sum + p.amount + p.tipAmount, 0)
  const remainingBeforeTip = orderTotal - alreadyPaid - pendingTotal

  // Apply dual pricing
  const cashTotal = remainingBeforeTip
  const cardTotal = dualPricing.enabled
    ? calculateCardPrice(remainingBeforeTip, dualPricing.cardSurchargePercent)
    : remainingBeforeTip

  const currentTotal = selectedMethod === 'cash' ? cashTotal : cardTotal
  const totalWithTip = currentTotal + tipAmount

  // Quick cash amounts
  const quickAmounts = getQuickCashAmounts(totalWithTip)

  const handleSelectMethod = (method: 'cash' | 'credit' | 'debit') => {
    setSelectedMethod(method)
    setTipAmount(0)
    setCustomTip('')

    if (tipSettings.enabled) {
      setStep('tip')
    } else if (method === 'cash') {
      setStep('cash')
    } else {
      setStep('card')
    }
  }

  const handleSelectTip = (percent: number | null) => {
    if (percent === null) {
      setTipAmount(0)
    } else {
      const tip = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, orderTotal)
      setTipAmount(tip)
    }
    setCustomTip('')
  }

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
  }

  const handleContinueFromTip = () => {
    if (selectedMethod === 'cash') {
      setStep('cash')
    } else {
      setStep('card')
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

  const handleCardPayment = () => {
    if (cardLast4.length !== 4) {
      setError('Please enter the last 4 digits of the card')
      return
    }

    const payment: PendingPayment = {
      method: selectedMethod as 'credit' | 'debit',
      amount: currentTotal,
      tipAmount,
      cardBrand,
      cardLast4,
    }
    setPendingPayments([...pendingPayments, payment])
    processPayments([...pendingPayments, payment])
  }

  const processPayments = async (payments: PendingPayment[]) => {
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
          })),
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
              <span className="font-medium">{formatCurrency(orderTotal)}</span>
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

              {dualPricing.enabled && dualPricing.showBothPrices && (
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
                      {dualPricing.enabled && (
                        <span className="ml-2">(+{dualPricing.cardSurchargePercent}%)</span>
                      )}
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
                  const tipForPercent = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, orderTotal)
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

          {/* Step: Card Payment (Simulated) */}
          {step === 'card' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">Card Payment</h3>

              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg mb-3">
                <p className="text-sm text-yellow-800">
                  <strong>Development Mode:</strong> Enter any 4 digits to simulate a card payment.
                </p>
              </div>

              <div className="p-3 bg-blue-50 rounded-lg mb-3">
                <div className="flex justify-between font-bold text-lg">
                  <span>Amount</span>
                  <span>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600 block mb-1">Card Last 4 Digits</label>
                <input
                  type="text"
                  value={cardLast4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full px-3 py-2 border rounded-lg text-center text-2xl tracking-widest"
                  placeholder="0000"
                  maxLength={4}
                />
              </div>

              <div>
                <label className="text-sm text-gray-600 block mb-1">Card Type</label>
                <select
                  value={cardBrand}
                  onChange={(e) => setCardBrand(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="visa">Visa</option>
                  <option value="mastercard">Mastercard</option>
                  <option value="amex">American Express</option>
                  <option value="discover">Discover</option>
                </select>
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(tipSettings.enabled ? 'tip' : 'method')}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleCardPayment}
                  disabled={isProcessing || cardLast4.length !== 4}
                >
                  {isProcessing ? 'Processing...' : 'Process Payment'}
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

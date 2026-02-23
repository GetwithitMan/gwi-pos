'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { getOrderVersion } from '@/lib/order-version'
import { TipPromptSelector } from './TipPromptSelector'
import type { PaymentSettings } from '@/lib/settings'

interface QuickPayButtonProps {
  orderId: string
  orderTotal: number
  subtotal: number
  readerId: string
  employeeId: string
  locationId: string
  paymentSettings: PaymentSettings
  onPaymentComplete: (result: QuickPayResult) => void
  disabled?: boolean
  className?: string
}

interface QuickPayResult {
  success: boolean
  authCode?: string
  cardType?: string
  cardLast4?: string
  tipAmount: number
  totalAmount: number
  recordNo?: string
}

type QuickPayStep = 'idle' | 'tip' | 'processing' | 'done' | 'error'

/**
 * Quick Pay — fastest single-transaction flow.
 *
 * 1. Bartender taps Quick Pay button
 * 2. Tip prompt shows ($ or % based on threshold)
 * 3. Customer taps/dips card
 * 4. EMVSale processes with tip included
 * 5. Done — no tab created
 */
export function QuickPayButton({
  orderId,
  orderTotal,
  subtotal,
  readerId,
  employeeId,
  locationId,
  paymentSettings,
  onPaymentComplete,
  disabled = false,
  className = '',
}: QuickPayButtonProps) {
  const [step, setStep] = useState<QuickPayStep>('idle')
  const [tipAmount, setTipAmount] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  const handleTipSelected = useCallback(async (selectedTip: number) => {
    setTipAmount(selectedTip)
    setStep('processing')

    try {
      const response = await fetch('/api/datacap/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          readerId,
          orderId,
          employeeId,
          invoiceNo: orderId,
          amount: subtotal,
          tipAmount: selectedTip,
          tipMode: 'included',
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Payment failed')
      }

      const data = result.data

      if (data.approved) {
        setStep('done')
        toast.success(`Payment approved — ${formatCurrency(subtotal + selectedTip)}`)

        // Now complete the order payment via the pay API
        await fetch(`/api/orders/${orderId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            employeeId,
            payments: [{
              method: 'credit',
              amount: subtotal,
              tipAmount: selectedTip,
              totalAmount: subtotal + selectedTip,
              cardBrand: data.cardType,
              cardLast4: data.cardLast4,
              authCode: data.authCode,
              datacapRefNumber: data.refNo,
              datacapRecordNo: data.recordNo,
              datacapSequenceNo: data.sequenceNo,
              entryMethod: data.entryMethod,
              // Datacap returns amounts as strings in XML responses
              amountAuthorized: parseFloat(data.amountAuthorized) || (subtotal + selectedTip),
            }],
            version: getOrderVersion(),
          }),
        })

        onPaymentComplete({
          success: true,
          authCode: data.authCode,
          cardType: data.cardType,
          cardLast4: data.cardLast4,
          tipAmount: selectedTip,
          totalAmount: subtotal + selectedTip,
          recordNo: data.recordNo,
        })
      } else {
        const errMsg = data.error?.message || 'Card declined'
        setStep('error')
        setErrorMessage(errMsg)
        toast.error(errMsg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setStep('error')
      setErrorMessage(msg)
      toast.error(msg)
    }
  }, [locationId, readerId, orderId, employeeId, subtotal, onPaymentComplete])

  const handleReset = () => {
    setStep('idle')
    setTipAmount(0)
    setErrorMessage('')
  }

  // Idle state — just the button
  if (step === 'idle') {
    return (
      <Button
        variant="primary"
        className={`font-semibold ${className}`}
        onClick={() => setStep('tip')}
        disabled={disabled || !paymentSettings.quickPayEnabled}
      >
        Quick Pay {formatCurrency(orderTotal)}
      </Button>
    )
  }

  // Tip selection step
  if (step === 'tip') {
    return (
      <div className="bg-white rounded-lg shadow-lg border p-2">
        <TipPromptSelector
          orderAmount={subtotal}
          tipDollarAmountThreshold={paymentSettings.tipDollarAmountThreshold}
          tipDollarSuggestions={paymentSettings.tipDollarSuggestions}
          tipPercentSuggestions={paymentSettings.tipPercentSuggestions}
          requireCustomForZeroTip={paymentSettings.requireCustomForZeroTip}
          onSelectTip={handleTipSelected}
          onCancel={handleReset}
        />
      </div>
    )
  }

  // Processing
  if (step === 'processing') {
    return (
      <div className="bg-white rounded-lg shadow-lg border p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="font-semibold">Processing Payment...</p>
        <p className="text-sm text-gray-500 mt-1">
          {formatCurrency(subtotal + tipAmount)}
          {tipAmount > 0 && (
            <span className="text-gray-400"> (includes {formatCurrency(tipAmount)} tip)</span>
          )}
        </p>
      </div>
    )
  }

  // Done
  if (step === 'done') {
    return (
      <div className="bg-white rounded-lg shadow-lg border p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-semibold text-green-700">Payment Complete</p>
        <p className="text-lg font-bold mt-1">{formatCurrency(subtotal + tipAmount)}</p>
      </div>
    )
  }

  // Error
  return (
    <div className="bg-white rounded-lg shadow-lg border p-6 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
        <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <p className="font-semibold text-red-700">Payment Failed</p>
      <p className="text-sm text-gray-500 mt-1">{errorMessage}</p>
      <div className="flex gap-2 justify-center mt-4">
        <Button variant="ghost" onClick={handleReset}>Cancel</Button>
        <Button variant="primary" onClick={() => setStep('tip')}>Try Again</Button>
      </div>
    </div>
  )
}

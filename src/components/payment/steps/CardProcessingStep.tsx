'use client'

import React, { useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import { DatacapPaymentProcessor, type CardDetectionResult } from '../DatacapPaymentProcessor'
import type { DatacapResult } from '@/hooks/useDatacap'
import { toast } from '@/stores/toast-store'
import { startPaymentTiming, markGatewayResponse, type PaymentTimingEntry } from '@/lib/payment-timing'
import { usePaymentContext } from '../PaymentContext'
import type { PendingPayment } from '../PaymentContext'
import {
  backButtonClasses,
  spinnerSmallClasses,
} from '../payment-styles'

/**
 * CardProcessingStep — Datacap EMV card payment processor wrapper.
 *
 * Handles: no terminal configured, existing tab cards on the card step,
 * add card to tab, and the DatacapPaymentProcessor component.
 */
export function CardProcessingStep() {
  const {
    orderId,
    terminalId,
    employeeId,
    locationId,
    selectedMethod,
    currentTotal,
    effectiveSubtotal,
    tipExemptAmount,
    tipSettings,
    pricingProgram,
    isProcessing,
    tabCards,
    onTabCardsChanged,
    addingCard,
    addCardError,
    tabAuthSlow,
    tabAuthSuccess,
    cardDetectionResult,
    setCardDetectionResult,
    pendingPayments,
    setPendingPayments,
    setSelectedMethod,
    setTipAmount,
    setStep,
    setError,
    processPayments,
    handleChargeExistingCard,
    handleAddCardToTab,
  } = usePaymentContext()

  const cardTimingRef = useRef<PaymentTimingEntry | null>(null)

  // ─── No Terminal Configured ─────────────────────────────────────────────
  if (!terminalId) {
    return (
      <div className="text-center py-8">
        <p className="text-red-400 font-bold mb-2 text-base">Terminal Not Configured</p>
        <p className="text-slate-400 text-sm mb-4">No terminal ID assigned. Card payments require a configured terminal.</p>
        <button onClick={() => setStep('method')} className={`${backButtonClasses} !flex-none`}>Back</button>
      </div>
    )
  }

  if (!orderId || !employeeId || !locationId) return null

  // ─── Handle Datacap payment success ─────────────────────────────────────
  const handleDatacapSuccess = (result: DatacapResult & { tipAmount: number; cardDetection?: CardDetectionResult }) => {
    const timing = startPaymentTiming('pay_close', orderId)
    timing.method = selectedMethod || 'credit'
    markGatewayResponse(timing)
    cardTimingRef.current = timing

    if (selectedMethod !== 'credit' && selectedMethod !== 'debit') {
      setError(`Invalid payment method for card transaction: ${selectedMethod}. Expected 'credit' or 'debit'.`)
      setStep('method')
      return
    }

    const detection = result.cardDetection || cardDetectionResult
    const appliedTier = detection?.appliedPricingTier || (selectedMethod === 'debit' ? 'debit' : 'credit')

    const payment: PendingPayment = {
      method: selectedMethod,
      amount: currentTotal,
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
      storedOffline: result.storedOffline,
      detectedCardType: detection?.detectedCardType,
      appliedPricingTier: appliedTier,
      walletType: detection?.walletType,
    }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  return (
    <>
      {/* Existing tab cards — charge one of these instead of swiping new */}
      {tabCards.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          <div className="text-[11px] text-slate-400 uppercase tracking-widest font-semibold">Cards on Tab</div>
          {tabCards.map((card) => (
            <button
              key={card.id}
              onClick={() => handleChargeExistingCard(card)}
              disabled={isProcessing}
              className={`w-full py-2.5 px-4 flex items-center gap-3 rounded-[10px] border-2 border-purple-500/60 bg-purple-500/[0.18] text-left shadow-[0_2px_8px_rgba(168,85,247,0.25)] ${isProcessing ? 'cursor-wait' : 'cursor-pointer hover:bg-purple-500/25'}`}
            >
              <span className="text-xl">{'\uD83D\uDCB3'}</span>
              <div className="flex-1">
                <div className="text-slate-100 text-sm font-semibold">
                  Charge {'\u2022\u2022\u2022'}{card.cardLast4}
                  {card.isDefault && <span className="ml-1.5 text-[10px] text-purple-400 bg-purple-400/15 px-1.5 py-px rounded">DEFAULT</span>}
                </div>
                <div className="text-purple-400 text-xs">
                  {card.cardType}{card.cardholderName ? ` — ${card.cardholderName}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Add Card to Tab option */}
      {onTabCardsChanged && !addingCard && (
        <button
          onClick={handleAddCardToTab}
          disabled={isProcessing}
          className="w-full py-3 px-4 rounded-[10px] border-none bg-gradient-to-br from-orange-500 to-orange-600 text-white text-sm font-bold cursor-pointer mb-2 flex items-center justify-center gap-2 shadow-[0_2px_8px_rgba(249,115,22,0.35)] hover:from-orange-400 hover:to-orange-500"
        >
          {'\uD83D\uDCB3'} Add Card to Tab Instead
        </button>
      )}
      {addingCard && (
        <div className="py-2 px-3 flex items-center gap-2 mb-2">
          <div className={spinnerSmallClasses} />
          <span className={`text-[13px] ${tabAuthSlow ? 'text-amber-500' : 'text-blue-400'}`}>
            {tabAuthSlow
              ? 'Reader is slow. The card has not been charged yet. Try again or use another method.'
              : 'Authorizing card...'}
          </span>
        </div>
      )}
      {tabAuthSuccess && (
        <div className="py-2 px-3 text-green-500 text-[13px] font-semibold mb-2">
          {'\u2713'} {tabAuthSuccess}
        </div>
      )}
      {addCardError && (
        <div className="p-2.5 bg-red-500/15 border border-red-500/40 rounded-lg text-red-400 text-[13px] font-semibold mb-2">
          {addCardError}
        </div>
      )}

      <DatacapPaymentProcessor
        orderId={orderId}
        amount={currentTotal}
        subtotal={effectiveSubtotal}
        tipExemptAmount={tipExemptAmount}
        tipSettings={tipSettings}
        terminalId={terminalId}
        employeeId={employeeId}
        locationId={locationId}
        pricingModel={pricingProgram?.enabled ? pricingProgram.model : undefined}
        onCardDetected={(detection, _adjustedAmount) => {
          setCardDetectionResult(detection)
        }}
        onSuccess={handleDatacapSuccess}
        onPayCashInstead={() => { setSelectedMethod('cash'); setTipAmount(0); setStep('cash') }}
        onPartialApproval={(result) => {
          const partialPayment: PendingPayment = {
            method: selectedMethod === 'debit' ? 'debit' : 'credit',
            amount: result.amountAuthorized,
            tipAmount: 0,
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
    </>
  )
}

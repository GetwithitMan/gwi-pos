'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CreditCardIcon, ArrowPathIcon, CheckBadgeIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { useDatacap, DatacapResult } from '@/hooks/useDatacap'
import { SwapConfirmationModal } from './SwapConfirmationModal'
import { ReaderStatusIndicator } from './ReaderStatusIndicator'
import { formatCurrency } from '@/lib/utils'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

interface DatacapPaymentProcessorProps {
  orderId: string
  amount: number
  subtotal?: number
  tipSettings?: {
    enabled: boolean
    suggestedPercentages: number[]
    calculateOn: 'subtotal' | 'total'
  }
  terminalId: string
  employeeId: string
  locationId: string
  tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
  readerId?: string
  onSuccess: (result: DatacapResult & { tipAmount: number }) => void
  onPartialApproval?: (result: DatacapResult & { tipAmount: number; remainingBalance: number }) => void
  onCancel: () => void
  onPayCashInstead?: () => void
  /** W1-P3: Called when server confirms card was charged but DB recording failed.
   *  Parent should show a critical error and instruct staff to check Datacap portal. */
  onRecordingFailed?: (error: string, datacapRecordNos?: string[]) => void
}

export function DatacapPaymentProcessor({
  orderId,
  amount,
  subtotal,
  tipSettings,
  terminalId,
  employeeId,
  locationId,
  tipMode: externalTipMode,
  readerId,
  onSuccess,
  onPartialApproval,
  onCancel,
  onPayCashInstead,
  onRecordingFailed,
}: DatacapPaymentProcessorProps) {
  const [tipAmount, setTipAmount] = useState(0)
  const [customTip, setCustomTip] = useState('')
  const [showCustomTip, setShowCustomTip] = useState(false)
  const [partialResult, setPartialResult] = useState<(DatacapResult & { tipAmount: number }) | null>(null)
  const [isVoiding, setIsVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  // W1-P3: Track last approved recordNo for void-on-failure safety
  const lastApprovedRecordNoRef = useRef<string | null>(null)

  const {
    reader,
    backupReader,
    isReaderOnline,
    isProcessing,
    processingStatus,
    error,
    processPayment,
    cancelTransaction,
    swapToBackup,
    triggerBeep,
    canSwap,
    showSwapModal,
    setShowSwapModal,
    refreshReaderConfig,
  } = useDatacap({
    terminalId,
    employeeId,
    locationId,
    onSuccess: (result) => {
      // Check for partial approval
      if (result.isPartialApproval) {
        setPartialResult({ ...result, tipAmount })
        // onPartialApproval fires only when user clicks "Accept Partial" below
      } else {
        onSuccess({ ...result, tipAmount })
      }
    },
    onDeclined: (_reason) => {
      // Decline handled by parent via onDeclined callback
    },
    onError: (err) => {
      console.error('[DatacapPaymentProcessor] Error:', err)
    },
    onReaderOffline: () => {
      if (canSwap) {
        setShowSwapModal(true)
      }
    },
  })

  const totalToCharge = amount + tipAmount
  const tipBasis = subtotal || amount

  // Suggested tip percentages
  const suggestedPercentages = tipSettings?.suggestedPercentages || [15, 18, 20, 25]

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
    setShowCustomTip(false)
  }

  const handleStartPayment = async () => {
    // Notify CFD that card payment is starting (fire and forget)
    const socket = getSharedSocket()
    socket.emit('cfd:payment-started', {
      orderId,
      amount: totalToCharge,
      paymentMethod: 'credit',
    })
    releaseSharedSocket()

    const result = await processPayment({
      orderId,
      amount: totalToCharge,
      purchaseAmount: amount, // Pre-tip amount for accurate partial approval detection
      tipAmount,
      tipMode: externalTipMode || 'none',
    })

    // W1-P3: Track recordNo from approved transactions for void-on-failure safety
    if (result?.approved && result.recordNo) {
      lastApprovedRecordNoRef.current = result.recordNo
    }

    // Success is handled via onSuccess callback
  }

  // W1-P3: Client-side void for when the pay API records a "recording failed" error.
  // The server also attempts auto-void, but this is a defense-in-depth layer.
  const voidLastApproval = useCallback(async () => {
    const recordNo = lastApprovedRecordNoRef.current
    if (!recordNo) return

    try {
      const res = await fetch('/api/datacap/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          readerId: readerId || reader?.id,
          recordNo,
          employeeId,
        }),
      })
      const data = await res.json()
      if (data.data?.approved) {
        lastApprovedRecordNoRef.current = null
      } else {
        console.error('[DatacapPaymentProcessor] Client-side void failed:', data.data?.error)
      }
    } catch (err) {
      console.error('[DatacapPaymentProcessor] Client-side void request failed:', err)
    }
  }, [locationId, readerId, reader?.id, employeeId])

  // Void a partial authorization and restart the payment flow
  const handleVoidPartial = async () => {
    if (!partialResult?.recordNo) {
      // No recordNo to void — just reset
      setPartialResult(null)
      cancelTransaction()
      return
    }

    setIsVoiding(true)
    setVoidError(null)
    try {
      const res = await fetch('/api/datacap/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          readerId: readerId || reader?.id,
          recordNo: partialResult.recordNo,
          employeeId,
        }),
      })
      const data = await res.json()
      if (!data.data?.approved) {
        console.error('[DatacapPaymentProcessor] Void failed:', data.data?.error)
        setVoidError('Card void failed — verify in Datacap portal to confirm the authorization was released before retrying')
        setIsVoiding(false)
        return
      }
    } catch (err) {
      console.error('[DatacapPaymentProcessor] Void request failed:', err)
      setVoidError('Card void failed — verify in Datacap portal to confirm the authorization was released before retrying')
      setIsVoiding(false)
      return
    }
    setIsVoiding(false)
    setPartialResult(null)
    cancelTransaction()
    // Return to payment method selection so staff can retry with another method
    onCancel()
  }

  const handleConfirmSwap = () => {
    swapToBackup()
  }

  // Status text for UI
  const getStatusText = () => {
    switch (processingStatus) {
      case 'checking_reader':
        return 'Verifying reader...'
      case 'waiting_card':
        return 'Present card on reader...'
      case 'authorizing':
        return 'Authorizing...'
      case 'approved':
        return 'APPROVED'
      case 'declined':
        return 'DECLINED'
      case 'error':
        return error || 'Error'
      default:
        return ''
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 rounded-3xl border border-slate-800 shadow-2xl relative">
      {/* Financial Header */}
      <div className="text-center mb-6">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
          Amount Due
        </span>
        <h2 className="text-5xl font-black text-white font-mono mt-2">
          {formatCurrency(totalToCharge)}
        </h2>
        {tipAmount > 0 && (
          <p className="text-sm text-slate-400 mt-1">
            (includes {formatCurrency(tipAmount)} tip)
          </p>
        )}
      </div>

      {/* Quick Tip Selection */}
      {tipSettings?.enabled !== false && processingStatus === 'idle' && (
        <div className="mb-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Add Tip</p>
          <div className="grid grid-cols-4 gap-2">
            {suggestedPercentages.map((percent) => {
              const tipValue = tipBasis * (percent / 100)
              const isSelected = Math.abs(tipAmount - tipValue) < 0.01
              return (
                <button
                  key={percent}
                  onClick={() => setTipAmount(tipValue)}
                  className={`py-3 rounded-xl text-sm font-bold transition-all ${
                    isSelected
                      ? 'bg-cyan-600 text-white border-2 border-cyan-400'
                      : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-cyan-500'
                  }`}
                >
                  {percent}%
                  <span className="block text-[10px] opacity-70">
                    {formatCurrency(tipValue)}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setTipAmount(0)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                tipAmount === 0
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              No Tip
            </button>
            <button
              onClick={() => setShowCustomTip(true)}
              className="flex-1 py-2 rounded-lg text-xs font-bold bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-all"
            >
              Custom
            </button>
          </div>

          {/* Custom Tip Input */}
          {showCustomTip && (
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                autoFocus
              />
              <button
                onClick={handleCustomTip}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg font-bold"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hardware Status & Swap Trigger */}
      <div className="mt-auto space-y-4">
        <ReaderStatusIndicator
          reader={reader}
          isOnline={isReaderOnline}
          processingStatus={processingStatus}
          onSwapClick={() => setShowSwapModal(true)}
          canSwap={canSwap}
        />

        {/* Error Display */}
        {error && processingStatus === 'error' && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="flex-1 py-4 rounded-2xl font-bold text-sm border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            disabled={isProcessing || !isReaderOnline}
            onClick={handleStartPayment}
            className={`flex-[2] py-4 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3 ${
              isProcessing
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : !isReaderOnline
                ? 'bg-amber-900/50 text-amber-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
            }`}
          >
            {isProcessing ? (
              <>
                <ArrowPathIcon className="w-6 h-6 animate-spin" />
                <span className="text-sm">{getStatusText()}</span>
              </>
            ) : !isReaderOnline ? (
              <>
                <XCircleIcon className="w-6 h-6" />
                READER OFFLINE
              </>
            ) : (
              <>
                <CreditCardIcon className="w-6 h-6" />
                COLLECT PAYMENT
              </>
            )}
          </button>
        </div>
      </div>

      {/* Success Overlay */}
      <AnimatePresence>
        {processingStatus === 'approved' && !partialResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-emerald-600 flex flex-col items-center justify-center z-50 rounded-3xl"
          >
            <CheckBadgeIcon className="w-24 h-24 text-white mb-4" />
            <h2 className="text-3xl font-black text-white">APPROVED</h2>
            <p className="text-emerald-100 font-bold mt-2">Processing receipt...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Partial Approval Overlay */}
      <AnimatePresence>
        {processingStatus === 'approved' && partialResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-amber-600 flex flex-col items-center justify-center z-50 rounded-3xl p-6"
          >
            <div className="text-center">
              <h2 className="text-2xl font-black text-white mb-2">PARTIAL APPROVAL</h2>
              <p className="text-amber-100 text-sm mb-6">Card has insufficient funds</p>

              <div className="bg-amber-700/50 rounded-2xl p-4 mb-6 space-y-2">
                <div className="flex justify-between text-amber-100">
                  <span>Requested:</span>
                  <span className="font-mono">{formatCurrency(partialResult.amountRequested)}</span>
                </div>
                <div className="flex justify-between text-white font-bold">
                  <span>Approved:</span>
                  <span className="font-mono">{formatCurrency(partialResult.amountAuthorized)}</span>
                </div>
                <div className="border-t border-amber-500 pt-2 flex justify-between text-amber-200">
                  <span>Remaining:</span>
                  <span className="font-mono font-bold">
                    {formatCurrency(partialResult.amountRequested - partialResult.amountAuthorized)}
                  </span>
                </div>
              </div>

              <p className="text-amber-100 text-xs mb-4">
                Accept partial or collect remaining with another payment method
              </p>

              {voidError && (
                <div className="p-3 mb-4 bg-red-900/30 border border-red-700 rounded-xl text-red-300 text-xs">
                  {voidError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleVoidPartial}
                  disabled={isVoiding}
                  className="flex-1 py-3 bg-amber-700 text-white rounded-xl font-bold disabled:opacity-50"
                >
                  {isVoiding ? 'Voiding...' : 'Void & Retry'}
                </button>
                <button
                  onClick={() => {
                    const remaining = partialResult.amountRequested - partialResult.amountAuthorized
                    onPartialApproval?.({ ...partialResult, remainingBalance: remaining })
                    setPartialResult(null)
                  }}
                  disabled={isVoiding}
                  className="flex-1 py-3 bg-white text-amber-700 rounded-xl font-bold disabled:opacity-50"
                >
                  Accept Partial
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Declined Overlay */}
      <AnimatePresence>
        {processingStatus === 'declined' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-red-600 flex flex-col items-center justify-center z-50 rounded-3xl"
          >
            <XCircleIcon className="w-24 h-24 text-white mb-4" />
            <h2 className="text-3xl font-black text-white">DECLINED</h2>
            <p className="text-red-100 font-bold mt-2">{error || 'Card was declined'}</p>
            <button
              onClick={() => cancelTransaction()}
              className="mt-6 px-8 py-3 bg-white/20 text-white rounded-xl font-bold"
            >
              Try Again
            </button>
            {onPayCashInstead && (
              <button
                onClick={() => { cancelTransaction(); onPayCashInstead() }}
                className="mt-3 px-8 py-3 bg-emerald-700 text-white rounded-xl font-bold"
              >
                Pay Cash Instead
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swap Confirmation Modal */}
      {showSwapModal && backupReader && (
        <SwapConfirmationModal
          targetReader={backupReader}
          onCancel={() => setShowSwapModal(false)}
          onConfirm={handleConfirmSwap}
          onBeep={triggerBeep}
        />
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CreditCardIcon, ArrowPathIcon, CheckBadgeIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { useDatacap, DatacapResult } from '@/hooks/useDatacap'
import type { DeclineDetail } from '@/lib/datacap/types'
import { SwapConfirmationModal } from './SwapConfirmationModal'
import { ReaderStatusIndicator } from './ReaderStatusIndicator'
import { formatCurrency } from '@/lib/utils'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { clientLog } from '@/lib/client-logger'

/** Card detection result from CardLookup (Model 3: dual_price_pan_debit) */
export interface CardDetectionResult {
  detectedCardType: 'credit' | 'debit'
  appliedPricingTier: 'credit' | 'debit'
  walletType?: string | null
}

interface DatacapPaymentProcessorProps {
  orderId: string
  amount: number
  subtotal?: number
  tipExemptAmount?: number
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
  /** Pricing program model — when 'dual_price_pan_debit', CardLookup runs before sale */
  pricingModel?: string
  /** Callback with adjusted charge amount after card detection (Model 3 only) */
  onCardDetected?: (result: CardDetectionResult, adjustedAmount: number) => void
  onSuccess: (result: DatacapResult & { tipAmount: number; cardDetection?: CardDetectionResult }) => void
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
  tipExemptAmount,
  tipSettings,
  terminalId,
  employeeId,
  locationId,
  tipMode: externalTipMode,
  readerId,
  pricingModel,
  onCardDetected,
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

  // Track the last decline detail for the decline overlay
  const [lastDeclineDetail, setLastDeclineDetail] = useState<DeclineDetail | null>(null)

  // Model 3: Card detection state
  const [isDetectingCard, setIsDetectingCard] = useState(false)
  const [cardDetection, setCardDetection] = useState<CardDetectionResult | null>(null)

  // W1-P3: Track last approved recordNo for void-on-failure safety
  const lastApprovedRecordNoRef = useRef<string | null>(null)

  // Orphaned card auth: localStorage key for crash recovery
  const orphanStorageKey = `gwi_orphaned_auth_${locationId}`

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
      // Clear orphaned auth tracking — payment completed successfully
      try { localStorage.removeItem(orphanStorageKey) } catch { /* non-fatal */ }
      lastApprovedRecordNoRef.current = null

      // Check for partial approval
      if (result.isPartialApproval) {
        setPartialResult({ ...result, tipAmount })
        // onPartialApproval fires only when user clicks "Accept Partial" below
      } else {
        onSuccess({ ...result, tipAmount, cardDetection: cardDetection || undefined })
      }
    },
    onDeclined: (_reason) => {
      // Decline detail is captured after processPayment returns the result
      // The result with declineDetail is handled in handleStartPayment below
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

  // SAF auto-forward: when a SAF transaction was stored offline, register a one-time
  // socket reconnect listener to trigger SAF forward for this reader when WAN returns
  const safForwardFiredRef = useRef(false)
  useEffect(() => {
    if (processingStatus !== 'approved_saf') return
    if (safForwardFiredRef.current) return
    if (!reader?.id || !locationId) return

    const readerIdForForward = readerId || reader.id

    const socket = getSharedSocket()
    const onReconnect = () => {
      safForwardFiredRef.current = true
      // Fire-and-forget SAF forward — reader will upload all queued transactions
      void fetch('/api/datacap/saf/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, readerId: readerIdForForward }),
      }).catch((err) => {
        console.error('[DatacapPaymentProcessor] SAF forward failed:', err)
      })
    }

    // If socket is already connected, fire immediately (WAN may be back)
    if (socket.connected) {
      onReconnect()
    } else {
      socket.once('connect', onReconnect)
    }

    return () => {
      socket.off('connect', onReconnect)
      releaseSharedSocket()
    }
  }, [processingStatus, reader?.id, readerId, locationId])

  const totalToCharge = amount + tipAmount
  const rawTipBasis = subtotal || amount
  const tipBasis = tipExemptAmount ? Math.max(0, rawTipBasis - tipExemptAmount) : rawTipBasis

  // Dispatch CFD events based on processing status changes (fire-and-forget)
  const prevStatusRef = useRef<string>('idle')
  useEffect(() => {
    if (processingStatus === prevStatusRef.current) return
    prevStatusRef.current = processingStatus

    const notifyCFD = (event: string, payload: Record<string, unknown> = {}) => {
      void fetch('/api/cfd/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, locationId, payload: { orderId, ...payload } }),
      }).catch(err => clientLog.warn('fire-and-forget failed in payment.DatacapPaymentProcessor:', err))
    }

    switch (processingStatus) {
      case 'waiting_card':
      case 'authorizing':
        notifyCFD('processing')
        break
      case 'approved':
      case 'approved_saf':
        notifyCFD('approved', { total: totalToCharge })
        break
      case 'declined':
        notifyCFD('declined', {
          reason: error || 'Card was declined',
          customerMessage: lastDeclineDetail?.customerMessage || 'Card declined. Please try another payment method.',
        })
        break
      case 'idle':
        notifyCFD('idle')
        break
    }
  }, [processingStatus, locationId, orderId, error, totalToCharge, lastDeclineDetail])

  // Suggested tip percentages
  const suggestedPercentages = tipSettings?.suggestedPercentages || [15, 18, 20, 25]

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
    setShowCustomTip(false)
  }

  const handleStartPayment = async () => {
    let chargeAmount = totalToCharge
    let detection: CardDetectionResult | null = null

    // Model 3 (dual_price_pan_debit): Detect card type before sending the sale
    if (pricingModel === 'dual_price_pan_debit') {
      setIsDetectingCard(true)
      try {
        const lookupRes = await fetch('/api/datacap/card-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            readerId: readerId || terminalId,
          }),
        })
        const lookupData = await lookupRes.json()
        const lookupResult = lookupData.data

        if (lookupResult?.success) {
          const detectedType = lookupResult.isDebit ? 'debit' : 'credit'
          detection = {
            detectedCardType: detectedType,
            appliedPricingTier: detectedType,
            walletType: null,
          }
          setCardDetection(detection)
          // Parent recalculates charge amount based on detection
          if (onCardDetected) {
            onCardDetected(detection, chargeAmount)
          }
        } else {
          // CardLookup failed — fall back to credit (higher price = safe default)
          clientLog.warn('[DatacapPaymentProcessor] CardLookup failed, defaulting to credit:', lookupResult?.error)
          detection = {
            detectedCardType: 'credit',
            appliedPricingTier: 'credit',
            walletType: null,
          }
          setCardDetection(detection)
        }
      } catch (err) {
        // Network error — fall back to credit
        clientLog.warn('[DatacapPaymentProcessor] CardLookup error, defaulting to credit:', err)
        detection = {
          detectedCardType: 'credit',
          appliedPricingTier: 'credit',
          walletType: null,
        }
        setCardDetection(detection)
      } finally {
        setIsDetectingCard(false)
      }
    }

    // Use the amount prop directly — parent has already set the correct amount
    // (for Model 3, parent updates amount via onCardDetected callback before re-render)
    chargeAmount = amount + tipAmount

    // Notify CFD that card payment is starting (fire and forget via server dispatch)
    void fetch('/api/cfd/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'payment-started',
        locationId,
        payload: {
          orderId,
          amount: chargeAmount,
          paymentMethod: 'credit',
        },
      }),
    }).catch(err => clientLog.warn('fire-and-forget failed in payment.DatacapPaymentProcessor:', err))

    const result = await processPayment({
      orderId,
      amount: chargeAmount,
      purchaseAmount: amount, // Pre-tip amount for accurate partial approval detection
      tipAmount,
      tipMode: externalTipMode || 'none',
    })

    // Capture decline detail from the result for the decline overlay
    if (result?.declineDetail) {
      setLastDeclineDetail(result.declineDetail)
    } else if (result && !result.approved) {
      // No structured decline detail — clear any stale one
      setLastDeclineDetail(null)
    }

    // Ambiguous abort/timeout: if processPayment returned null (timeout/network error),
    // the card MAY have been charged but we lost the response. Log for awareness.
    // The orphaned auth localStorage entry (if any from a prior approval) will persist
    // and be voided on next mount.
    if (!result && lastApprovedRecordNoRef.current) {
      clientLog.warn(
        '[DatacapPaymentProcessor] Payment returned null (timeout/abort) with a prior recordNo still tracked:',
        lastApprovedRecordNoRef.current,
        '- Will attempt void on next mount if not cleared.'
      )
    }

    // W1-P3: Track recordNo from approved transactions for void-on-failure safety
    if (result?.approved && result.recordNo) {
      lastApprovedRecordNoRef.current = result.recordNo
      // Persist to localStorage for crash recovery — if the browser crashes between
      // card approval and DB recording, we can void the orphan on next mount
      try {
        localStorage.setItem(orphanStorageKey, JSON.stringify({
          recordNo: result.recordNo,
          readerId: readerId || reader?.id,
          storedAt: new Date().toISOString(),
        }))
      } catch { /* localStorage full or unavailable — non-fatal */ }
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

  // Orphaned auth recovery: void any auth that was stored before a crash/timeout
  const voidOrphanedSales = useCallback(async () => {
    try {
      const stored = localStorage.getItem(orphanStorageKey)
      if (!stored) return

      const orphan = JSON.parse(stored) as { recordNo: string; readerId?: string; storedAt: string }
      if (!orphan.recordNo) {
        localStorage.removeItem(orphanStorageKey)
        return
      }

      // Only attempt void for orphans less than 24 hours old
      const storedAt = new Date(orphan.storedAt).getTime()
      if (Date.now() - storedAt > 24 * 60 * 60 * 1000) {
        clientLog.warn('[DatacapPaymentProcessor] Orphaned auth too old (>24h), clearing:', orphan.recordNo)
        localStorage.removeItem(orphanStorageKey)
        return
      }

      clientLog.warn('[DatacapPaymentProcessor] Found orphaned auth, attempting void:', orphan.recordNo)
      const res = await fetch('/api/datacap/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          readerId: orphan.readerId || readerId || reader?.id,
          recordNo: orphan.recordNo,
          employeeId,
          reason: 'orphaned_auth_recovery',
        }),
      })
      const data = await res.json()
      if (data.data?.approved) {
        clientLog.info('[DatacapPaymentProcessor] Orphaned auth voided successfully:', orphan.recordNo)
        localStorage.removeItem(orphanStorageKey)
      } else {
        console.error('[DatacapPaymentProcessor] Orphaned auth void failed:', data.data?.error,
          '- Record may need manual void in Datacap portal:', orphan.recordNo)
        // Keep in localStorage so we retry next mount
      }
    } catch (err) {
      console.error('[DatacapPaymentProcessor] Orphaned auth recovery error:', err)
    }
  }, [orphanStorageKey, locationId, readerId, reader?.id, employeeId])

  // On mount: check for and void any orphaned authorizations from previous sessions
  useEffect(() => {
    void voidOrphanedSales()
  }, [voidOrphanedSales])

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
    if (isDetectingCard) return 'Detecting card type...'
    switch (processingStatus) {
      case 'checking_reader':
        return 'Verifying reader...'
      case 'waiting_card':
        return 'Present card on reader...'
      case 'authorizing':
        return 'Authorizing...'
      case 'approved':
        return 'APPROVED'
      case 'approved_saf':
        return 'APPROVED (OFFLINE)'
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

        {/* Error Display — shows structured decline/error detail when available */}
        {error && processingStatus === 'error' && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-xl space-y-1">
            <p className="text-red-400 text-sm font-semibold">{error}</p>
            {lastDeclineDetail?.returnCode && lastDeclineDetail.returnCode !== 'UNKNOWN' && (
              <p className="text-red-500/60 text-[11px] font-mono">Code: {lastDeclineDetail.returnCode}</p>
            )}
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
            disabled={isProcessing || isDetectingCard || !isReaderOnline}
            onClick={handleStartPayment}
            className={`flex-[2] py-4 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3 ${
              isProcessing || isDetectingCard
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : !isReaderOnline
                ? 'bg-amber-900/50 text-amber-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
            }`}
          >
            {isProcessing || isDetectingCard ? (
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

      {/* Success Overlay — Online Approval */}
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

      {/* SAF Approval Overlay — Stored Offline (Amber) */}
      <AnimatePresence>
        {processingStatus === 'approved_saf' && !partialResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-amber-600 flex flex-col items-center justify-center z-50 rounded-3xl"
          >
            <CheckBadgeIcon className="w-24 h-24 text-white mb-4" />
            <h2 className="text-3xl font-black text-white">APPROVED</h2>
            <p className="text-amber-100 font-bold mt-2">Stored offline — will upload when connected</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Partial Approval Overlay */}
      <AnimatePresence>
        {(processingStatus === 'approved' || processingStatus === 'approved_saf') && partialResult && (
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

      {/* Declined Overlay — detailed staff + customer messaging */}
      <AnimatePresence>
        {processingStatus === 'declined' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-red-600 flex flex-col items-center justify-center z-50 rounded-3xl p-6"
          >
            <XCircleIcon className="w-20 h-20 text-white mb-3" />
            <h2 className="text-3xl font-black text-white">DECLINED</h2>

            {/* Staff message — specific reason, always visible */}
            <p className="text-red-100 font-bold mt-3 text-lg text-center leading-snug px-4">
              {lastDeclineDetail?.staffMessage || error || 'Card was declined'}
            </p>

            {/* Return code reference for staff */}
            {lastDeclineDetail?.returnCode && lastDeclineDetail.returnCode !== 'UNKNOWN' && (
              <p className="text-red-200/50 text-xs font-mono mt-1">
                Code: {lastDeclineDetail.returnCode}
                {lastDeclineDetail.responseOrigin ? ` (${lastDeclineDetail.responseOrigin})` : ''}
              </p>
            )}

            {/* Customer-safe message — can be read aloud to customer */}
            {lastDeclineDetail?.customerMessage && (
              <div className="mt-4 px-4 py-2.5 bg-white/10 rounded-xl max-w-xs">
                <p className="text-[10px] text-red-200/60 uppercase tracking-wider font-semibold mb-1">Tell Customer</p>
                <p className="text-red-50 text-sm font-medium text-center">
                  {lastDeclineDetail.customerMessage}
                </p>
              </div>
            )}

            {/* Action buttons — vary based on retryability */}
            <div className="mt-5 flex flex-col items-center gap-2.5 w-full max-w-xs">
              {lastDeclineDetail?.isRetryable !== false ? (
                <button
                  onClick={() => { setLastDeclineDetail(null); cancelTransaction() }}
                  className="w-full px-8 py-3 bg-white/20 text-white rounded-xl font-bold hover:bg-white/30 transition-colors"
                >
                  Try Again
                </button>
              ) : (
                <button
                  onClick={() => { setLastDeclineDetail(null); cancelTransaction() }}
                  className="w-full px-8 py-3 bg-white/20 text-white rounded-xl font-bold hover:bg-white/30 transition-colors"
                >
                  Use Different Card
                </button>
              )}
              {onPayCashInstead && (
                <button
                  onClick={() => { setLastDeclineDetail(null); cancelTransaction(); onPayCashInstead() }}
                  className="w-full px-8 py-3 bg-emerald-700 text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors"
                >
                  Pay Cash Instead
                </button>
              )}
              <button
                onClick={() => { setLastDeclineDetail(null); cancelTransaction(); onCancel() }}
                className="w-full px-8 py-3 bg-white/10 text-red-100 rounded-xl font-bold text-sm hover:bg-white/15 transition-colors"
              >
                Back to Order
              </button>
            </div>
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

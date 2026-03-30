'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { DeclineDetail } from '@/lib/datacap/types'

// Processing status for UI feedback
export type DatacapProcessingStatus =
  | 'idle'              // Ready to accept payment
  | 'checking_reader'   // Verifying reader identity
  | 'waiting_card'      // Waiting for customer to tap/insert/swipe
  | 'authorizing'       // Transaction sent to processor
  | 'approved'          // Payment approved (online)
  | 'approved_saf'      // Payment approved but stored offline (SAF — pending upload)
  | 'declined'          // Payment declined
  | 'error'             // Reader error or timeout

// Payment reader info
export interface PaymentReader {
  id: string
  name: string
  ipAddress: string
  port: number
  serialNumber: string
  communicationMode?: string | null
  isOnline: boolean
  lastSeenAt?: string | null
}

// Terminal config with reader binding
export interface TerminalConfig {
  id: string
  paymentReaderId?: string | null
  paymentReader?: PaymentReader | null
  paymentProvider: string
  backupPaymentReaderId?: string | null
  backupPaymentReader?: PaymentReader | null
  readerFailoverTimeout: number
}

// Datacap transaction result
export interface DatacapResult {
  approved: boolean
  authCode?: string
  refNumber?: string
  recordNo?: string
  sequenceNo?: string
  cardBrand?: string
  cardLast4?: string
  entryMethod?: 'Chip' | 'Tap' | 'Swipe' | 'Manual'
  responseCode?: string
  responseMessage?: string
  error?: string

  // Partial Approvals (card may have insufficient funds)
  amountRequested: number
  amountAuthorized: number
  isPartialApproval: boolean

  // Signature (chargeback defense)
  signatureData?: string // Base64 signature from reader

  // SAF (Store-and-Forward) — transaction stored offline on reader, pending upload
  storedOffline?: boolean

  // Structured decline/error detail for staff and customer display
  declineDetail?: DeclineDetail
}

// Datacap device info response
interface DatacapDeviceInfo {
  serialNumber?: string
  serial?: string
  sn?: string
  firmwareVersion?: string
  version?: string
  model?: string
}

interface UseDatacapOptions {
  terminalId: string
  employeeId: string
  locationId?: string
  onSuccess?: (result: DatacapResult) => void
  onDeclined?: (reason: string) => void
  onError?: (error: string) => void
  onReaderOffline?: (readerId: string) => void
}

interface UseDatacapReturn {
  // State
  reader: PaymentReader | null
  backupReader: PaymentReader | null
  isReaderOnline: boolean
  isProcessing: boolean
  processingStatus: DatacapProcessingStatus
  error: string | null

  // Actions
  processPayment: (params: {
    orderId: string
    amount: number
    purchaseAmount?: number
    tipAmount?: number
    tipMode?: string
    tranType?: 'Sale' | 'Auth'
  }) => Promise<DatacapResult | null>

  cancelTransaction: () => Promise<void>
  checkReaderStatus: () => Promise<boolean>
  swapToBackup: () => void
  triggerBeep: () => Promise<void>
  refreshReaderConfig: () => Promise<void>

  // Reader management
  boundReaderId: string | null
  canSwap: boolean
  isSwapping: boolean
  showSwapModal: boolean
  setShowSwapModal: (show: boolean) => void
}

// ─── Client-Side Decline Detail Builder ─────────────────────────────────────
// Lightweight mapping for direct reader responses (no server round-trip).
// For cloud mode, the server returns pre-built declineDetail.

const CLIENT_DECLINE_CODES: Record<string, { message: string; customerMessage: string; isRetryable: boolean }> = {
  '100001': { message: 'Declined by Issuer', customerMessage: 'Card declined. Please try another payment method.', isRetryable: false },
  '100002': { message: 'Insufficient Funds', customerMessage: 'Card declined. Please try another payment method.', isRetryable: false },
  '100003': { message: 'Over Limit', customerMessage: 'Card declined. Please try another payment method.', isRetryable: false },
  '100004': { message: 'Expired Card', customerMessage: 'Card is expired. Please use a different card.', isRetryable: false },
  '100005': { message: 'Invalid Card', customerMessage: 'Card could not be read. Please try again or use a different card.', isRetryable: false },
  '100006': { message: 'Restricted Card', customerMessage: 'This card type is not accepted. Please try another card.', isRetryable: false },
  '100007': { message: 'Do Not Honor', customerMessage: 'Card declined. Please try another payment method.', isRetryable: false },
  '100008': { message: 'Card Removed', customerMessage: 'Card was removed too soon. Please try again.', isRetryable: true },
  '100009': { message: 'Duplicate Transaction', customerMessage: 'This transaction was already processed.', isRetryable: false },
  '200001': { message: 'Device Not Ready', customerMessage: 'Reader is not ready. Please wait a moment.', isRetryable: true },
  '200002': { message: 'Device Busy', customerMessage: 'Reader is busy. Please wait a moment.', isRetryable: true },
  '200003': { message: 'Device Error', customerMessage: 'Reader error. Please try again.', isRetryable: true },
  '200004': { message: 'No Device', customerMessage: 'Reader not found. Please alert staff.', isRetryable: true },
  '200005': { message: 'Card Read Error', customerMessage: 'Card could not be read. Please try again.', isRetryable: true },
  '200006': { message: 'Timeout', customerMessage: 'Transaction timed out. Please try again.', isRetryable: true },
  '200007': { message: 'Cancelled', customerMessage: 'Transaction was cancelled.', isRetryable: false },
  '300001': { message: 'Communication Error', customerMessage: 'Unable to process payment. Please try again.', isRetryable: true },
  '300002': { message: 'Host Unavailable', customerMessage: 'Unable to process payment. Please try again in a moment.', isRetryable: true },
  '300003': { message: 'Connection Timeout', customerMessage: 'Connection timed out. Please try again.', isRetryable: true },
}

function buildClientDeclineDetail(
  returnCode: string,
  textResponse: string,
  isPartialApproval: boolean,
  amountAuthorized: number,
  requestedAmount: number,
  responseOrigin?: string
): DeclineDetail {
  const known = CLIENT_DECLINE_CODES[returnCode]

  let staffMessage: string
  if (isPartialApproval && amountAuthorized > 0) {
    staffMessage = `Partial Approval: $${amountAuthorized.toFixed(2)} of $${requestedAmount.toFixed(2)} approved`
  } else if (known) {
    staffMessage = `Declined: ${known.message} (${returnCode})`
  } else if (textResponse) {
    staffMessage = `Declined: ${textResponse} (${returnCode || 'UNKNOWN'})`
  } else {
    staffMessage = `Declined (${returnCode || 'UNKNOWN'})`
  }

  const customerMessage = isPartialApproval
    ? 'Card has insufficient funds for the full amount.'
    : (known?.customerMessage || 'Card declined. Please try another payment method.')

  return {
    returnCode: returnCode || 'UNKNOWN',
    staffMessage,
    customerMessage,
    isRetryable: known?.isRetryable ?? false,
    isPartialApproval,
    approvedAmount: isPartialApproval ? amountAuthorized : undefined,
    requestedAmount: isPartialApproval ? requestedAmount : undefined,
    responseOrigin: responseOrigin as DeclineDetail['responseOrigin'],
  }
}

/**
 * useDatacap - Handles Datacap Direct payment reader communication
 *
 * Flow:
 * 1. Pre-flight: Verify reader identity via serial number handshake
 * 2. Transaction: Send Amount/TranType/Invoice to reader
 * 3. Failover: If reader offline, prompt to swap to backup
 */
export function useDatacap(options: UseDatacapOptions): UseDatacapReturn {
  const { terminalId, employeeId, onSuccess, onDeclined, onError, onReaderOffline } = options

  // Reader state
  const [reader, setReader] = useState<PaymentReader | null>(null)
  const [backupReader, setBackupReader] = useState<PaymentReader | null>(null)
  const [isReaderOnline, setIsReaderOnline] = useState(false)
  const [readerFailoverTimeout, setReaderFailoverTimeout] = useState(10000)
  // Processing state
  const [processingStatus, setProcessingStatus] = useState<DatacapProcessingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const [showSwapModal, setShowSwapModal] = useState(false)

  // Refs for abort, timeout, and unmount cleanup
  const abortControllerRef = useRef<AbortController | null>(null)
  const statusPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const readerRef = useRef<PaymentReader | null>(null)

  // Computed values
  const isProcessing = processingStatus !== 'idle' && processingStatus !== 'approved' && processingStatus !== 'approved_saf' && processingStatus !== 'declined' && processingStatus !== 'error'
  const boundReaderId = reader?.id || null
  const canSwap = !!backupReader && backupReader.id !== reader?.id

  /**
   * Fetch terminal config to get bound reader info
   */
  const refreshReaderConfig = useCallback(async () => {
    try {
      const response = await fetch(`/api/hardware/terminals/${terminalId}`)
      if (!response.ok) return

      const raw = await response.json()
      const data = raw.data ?? raw
      const terminal = data.terminal

      if (!terminal) {
        // Terminal not found or API returned empty — skip configuration
        return
      }

      if (terminal.paymentReader) {
        setReader(terminal.paymentReader)
        readerRef.current = terminal.paymentReader
        setIsReaderOnline(terminal.paymentReader.isOnline || false)
      } else {
        setReader(null)
        readerRef.current = null
        setIsReaderOnline(false)
      }

      if (terminal.backupPaymentReader) {
        setBackupReader(terminal.backupPaymentReader)
      } else {
        setBackupReader(null)
      }

      setReaderFailoverTimeout(terminal.readerFailoverTimeout || 10000)
    } catch {
      // Network error — reader config will load on next attempt
    }
  }, [terminalId])

  // Load reader config on mount
  useEffect(() => {
    refreshReaderConfig()
  }, [refreshReaderConfig])

  // Cleanup on unmount: abort in-flight requests AND cancel on reader
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (statusPollIntervalRef.current) {
        clearInterval(statusPollIntervalRef.current)
      }
      // Fire-and-forget cancel to the reader so it doesn't hang waiting for a card
      // that nobody will present (e.g., user navigated away mid-transaction)
      let cancelUrl: string | null = null
      if (readerRef.current) {
        if (readerRef.current.communicationMode === 'cloud') {
          cancelUrl = `/api/hardware/payment-readers/${readerRef.current.id}/cloud/cancel`
        } else {
          cancelUrl = `http://${readerRef.current.ipAddress}:${readerRef.current.port}/cancel`
        }
      }
      if (cancelUrl) {
        fetch(cancelUrl, { method: 'POST' }).catch(err => console.warn('fetch request failed:', err))
      }
    }
  }, [])

  /**
   * Check if reader is online by pinging it
   */
  const checkReaderStatus = useCallback(async (): Promise<boolean> => {
    if (!reader) {
      setIsReaderOnline(false)
      return false
    }

    try {
      const response = await fetch(`/api/hardware/payment-readers/${reader.id}/ping`, {
        method: 'POST',
      })

      const rawResult = await response.json()
      const result = rawResult.data ?? rawResult
      setIsReaderOnline(result.isOnline || false)

      if (result.isOnline) {
        setError(null)
      }

      return result.isOnline || false
    } catch (err) {
      console.error('[useDatacap] Reader ping failed:', err)
      setIsReaderOnline(false)
      return false
    }
  }, [reader])

  /**
   * Trigger a beep on the reader for physical identification
   */
  const triggerBeep = useCallback(async () => {
    if (!reader) return

    try {
      await fetch(`/api/hardware/payment-readers/${reader.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerBeep: true }),
      })
    } catch (err) {
      console.error('[useDatacap] Failed to trigger beep:', err)
    }
  }, [reader])

  /**
   * Swap to backup reader
   */
  const swapToBackup = useCallback(() => {
    if (!backupReader) {
      console.warn('[useDatacap] No backup reader available')
      return
    }

    setIsSwapping(true)

    // Swap readers
    const previousReader = reader
    setReader(backupReader)
    readerRef.current = backupReader
    setBackupReader(previousReader)

    // Update terminal binding via API
    fetch(`/api/hardware/terminals/${terminalId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentReaderId: backupReader.id,
        backupPaymentReaderId: previousReader?.id || null,
      }),
    }).catch((err) => {
      console.error('[useDatacap] Failed to update terminal binding:', err)
    }).finally(() => {
      setIsSwapping(false)
      setShowSwapModal(false)
    })
  }, [reader, backupReader, terminalId])

  /**
   * Build URL for reader communication.
   * - Cloud (USB VP3350 etc.): routes to server-side proxy /api/hardware/payment-readers/[id]/cloud/*
   * - Local IP: routes direct to reader's HTTP server
   */
  const getReaderUrl = useCallback((path: string) => {
    if (!reader) return ''
    if (reader.communicationMode === 'cloud') {
      return `/api/hardware/payment-readers/${reader.id}/cloud${path}`
    }
    return `http://${reader.ipAddress}:${reader.port}${path}`
  }, [reader])

  /**
   * Cancel an in-progress transaction
   */
  const cancelTransaction = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Try to cancel on the reader
    const cancelUrl = getReaderUrl('/cancel')
    if (cancelUrl) {
      try {
        await fetch(cancelUrl, { method: 'POST' })
      } catch {
        // Reader might not support cancel, or already finished
      }
    }

    setProcessingStatus('idle')
    setError(null)
  }, [getReaderUrl])

  /**
   * Process a payment through Datacap Direct
   */
  const processPayment = useCallback(async (params: {
    orderId: string
    amount: number
    purchaseAmount?: number
    tipAmount?: number
    tipMode?: string
    tranType?: 'Sale' | 'Auth'
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      const msg = 'No payment reader configured'
      setError(msg)
      onError?.(msg)
      return null
    }

    // Check if reader is online first
    setProcessingStatus('checking_reader')
    setError(null)

    try {
      // Pre-flight: Check reader connectivity and verify identity
      const controller = new AbortController()
      abortControllerRef.current = controller
      const timeoutId = setTimeout(() => controller.abort(), readerFailoverTimeout)

      let deviceInfo: DatacapDeviceInfo
      try {
        const identityResponse = await fetch(getReaderUrl('/device/info'), {
          method: 'GET',
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!identityResponse.ok) {
          throw new Error('Reader not responding')
        }

        deviceInfo = await identityResponse.json()
      } catch (fetchError) {
        clearTimeout(timeoutId)
        setProcessingStatus('error')

        const msg = fetchError instanceof Error && fetchError.name === 'AbortError'
          ? 'Reader timeout - please check connection'
          : 'Reader offline'

        setError(msg)
        setIsReaderOnline(false)
        onReaderOffline?.(reader.id)

        // Show swap modal if backup available
        if (canSwap) {
          setShowSwapModal(true)
        }

        return null
      }

      // Verify serial number matches
      const deviceSerial = deviceInfo.serialNumber || deviceInfo.serial || deviceInfo.sn
      if (deviceSerial && deviceSerial !== reader.serialNumber) {
        const msg = 'Reader serial mismatch - wrong device?'
        setProcessingStatus('error')
        setError(msg)
        onError?.(msg)
        return null
      }

      setIsReaderOnline(true)

      // Send transaction to reader
      setProcessingStatus('waiting_card')

      const transactionController = new AbortController()
      abortControllerRef.current = transactionController
      // 60 second timeout for customer to complete transaction
      const txTimeoutId = setTimeout(() => transactionController.abort(), 60000)

      try {
        const txResponse = await fetch(getReaderUrl('/process'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: transactionController.signal,
          body: JSON.stringify({
            Amount: params.amount.toFixed(2),
            TranType: params.tranType || 'Sale',
            Invoice: params.orderId,
            // EMV-Level Tip & Signature prompting
            TipRequest: 'True',
            SignatureRequest: 'True',
            PartialAuth: 'True', // Allow partial approvals
            ...(params.tipAmount && { TipAmount: params.tipAmount.toFixed(2) }),
          }),
        })

        clearTimeout(txTimeoutId)

        if (!txResponse.ok) {
          throw new Error(`Transaction failed with status ${txResponse.status}`)
        }

        const txResult = await txResponse.json()

        // Parse amounts for partial approval detection
        // Use purchaseAmount (pre-tip) when available to avoid false-positive partials
        // where the reader returns purchase-only authorization (excluding tip)
        const amountForPartialCheck = params.purchaseAmount ?? params.amount
        const amountAuthorized = parseFloat(
          txResult.amountAuthorized || txResult.AmountAuthorized ||
          txResult.AuthorizedAmount || txResult.Amount || params.amount.toString()
        )
        // Use cent-level tolerance to avoid false-positive partials from floating-point rounding
        // e.g., $65.82 requested vs $65.82 authorized should NOT be flagged as partial
        const isPartialApproval = amountAuthorized > 0 &&
          (amountForPartialCheck - amountAuthorized) > 0.01

        // Detect SAF (Store-and-Forward) — transaction stored offline on reader
        const storedOffline = txResult.storedOffline === true ||
          txResult.StoredOffline === 'Yes' ||
          (typeof txResult.textResponse === 'string' && txResult.textResponse.toUpperCase().includes('STORED OFFLINE')) ||
          (typeof txResult.TextResponse === 'string' && txResult.TextResponse.toUpperCase().includes('STORED OFFLINE'))

        // Parse Datacap response
        const responseCode = txResult.responseCode || txResult.ResponseCode || txResult.dsixReturnCode || ''
        const responseMessage = txResult.textResponse || txResult.TextResponse || txResult.responseMessage || txResult.ResponseMessage || txResult.Message || ''

        const result: DatacapResult = {
          approved: txResult.approved || txResult.status === 'APPROVED' || responseCode === '00',
          authCode: txResult.authCode || txResult.AuthCode,
          refNumber: txResult.refNumber || txResult.RefNumber || txResult.ReferenceNumber,
          cardBrand: txResult.cardBrand || txResult.CardBrand || txResult.CardType,
          cardLast4: txResult.cardLast4 || txResult.CardLast4 || txResult.MaskedPan?.slice(-4),
          entryMethod: txResult.entryMethod || txResult.EntryMethod,
          responseCode,
          responseMessage,

          // Partial Approval tracking
          amountRequested: params.amount,
          amountAuthorized,
          isPartialApproval,

          // Signature capture (Base64 from reader for chargeback defense)
          signatureData: txResult.signatureData || txResult.SignatureData ||
                         txResult.Signature || txResult.signature,

          // Record tracking for void/orphan recovery
          recordNo: txResult.recordNo || txResult.RecordNo || txResult.recordNumber || txResult.RecordNumber,
          sequenceNo: txResult.sequenceNo || txResult.SequenceNo || txResult.SequenceNumber,

          // SAF status
          storedOffline,
        }

        // Attach structured decline detail — prefer server-provided, build client-side as fallback
        if (!result.approved || isPartialApproval) {
          if (txResult.declineDetail) {
            // Server (cloud proxy or sale route) already built the structured detail
            result.declineDetail = txResult.declineDetail as DeclineDetail
          } else {
            // Direct reader response — build client-side from responseCode/responseMessage
            result.declineDetail = buildClientDeclineDetail(
              responseCode,
              responseMessage,
              isPartialApproval,
              amountAuthorized,
              params.amount,
              txResult.responseOrigin || txResult.ResponseOrigin
            )
          }
        }

        if (result.approved) {
          setProcessingStatus(storedOffline ? 'approved_saf' : 'approved')
          onSuccess?.(result)
        } else {
          setProcessingStatus('declined')
          const staffMsg = result.declineDetail?.staffMessage
          const declineReason = staffMsg || responseMessage || 'Card was declined'
          result.error = declineReason
          setError(declineReason)
          onDeclined?.(declineReason)
        }

        return result
      } catch (txError) {
        clearTimeout(txTimeoutId)

        if (txError instanceof Error && txError.name === 'AbortError') {
          setProcessingStatus('error')
          setError('Transaction timed out - customer did not complete')
          onError?.('Transaction timed out')
          return null
        }

        const msg = txError instanceof Error ? txError.message : 'Transaction failed'
        setProcessingStatus('error')
        setError(msg)
        onError?.(msg)
        return null
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setProcessingStatus('error')
      setError(msg)
      onError?.(msg)
      return null
    } finally {
      abortControllerRef.current = null
    }
  }, [reader, readerFailoverTimeout, canSwap, getReaderUrl, onSuccess, onDeclined, onError, onReaderOffline])

  return {
    // State
    reader,
    backupReader,
    isReaderOnline,
    isProcessing,
    processingStatus,
    error,

    // Actions
    processPayment,
    cancelTransaction,
    checkReaderStatus,
    swapToBackup,
    triggerBeep,
    refreshReaderConfig,

    // Reader management
    boundReaderId,
    canSwap,
    isSwapping,
    showSwapModal,
    setShowSwapModal,
  }
}

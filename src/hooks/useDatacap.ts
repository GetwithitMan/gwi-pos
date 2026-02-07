'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

// Processing status for UI feedback
export type DatacapProcessingStatus =
  | 'idle'              // Ready to accept payment
  | 'checking_reader'   // Verifying reader identity
  | 'waiting_card'      // Waiting for customer to tap/insert/swipe
  | 'authorizing'       // Transaction sent to processor
  | 'approved'          // Payment approved
  | 'declined'          // Payment declined
  | 'error'             // Reader error or timeout

// Payment reader info
export interface PaymentReader {
  id: string
  name: string
  ipAddress: string
  port: number
  serialNumber: string
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

// Datacap transaction result (extended with RecordNo for bar tabs)
export interface DatacapResult {
  approved: boolean
  authCode?: string
  refNumber?: string
  recordNo?: string          // Token for future operations (voids, captures, adjustments)
  cardBrand?: string
  cardLast4?: string
  cardholderName?: string    // From chip data (for card-first tab flow)
  entryMethod?: 'Chip' | 'Tap' | 'Swipe' | 'Manual'
  responseCode?: string
  responseMessage?: string
  error?: string
  cvm?: string               // PIN_VERIFIED, SIGN, NONE
  printData?: Record<string, string>
  sequenceNo?: string

  // Partial Approvals (card may have insufficient funds)
  amountRequested: number
  amountAuthorized: number
  isPartialApproval: boolean

  // Signature (chargeback defense)
  signatureData?: string     // Base64 signature from reader
}

interface UseDatacapOptions {
  terminalId: string
  employeeId: string
  locationId: string
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

  // Sale / payment
  processPayment: (params: {
    orderId: string
    amount: number
    tipAmount?: number
    tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
    tipSuggestions?: number[]
  }) => Promise<DatacapResult | null>

  // Bar tab operations
  preAuth: (params: {
    orderId: string
    amount: number
  }) => Promise<DatacapResult | null>

  capturePreAuth: (params: {
    recordNo: string
    purchaseAmount: number
    gratuityAmount?: number
  }) => Promise<DatacapResult | null>

  incrementAuth: (params: {
    recordNo: string
    additionalAmount: number
  }) => Promise<DatacapResult | null>

  adjustTip: (params: {
    recordNo: string
    purchaseAmount: number
    gratuityAmount: number
  }) => Promise<DatacapResult | null>

  // Void / return
  voidSale: (params: { recordNo: string }) => Promise<DatacapResult | null>
  processReturn: (params: {
    amount: number
    recordNo?: string
    cardPresent?: boolean
    invoiceNo?: string
  }) => Promise<DatacapResult | null>

  // Card data collection (no charge)
  collectCardData: () => Promise<DatacapResult | null>

  // Reader management
  cancelTransaction: () => Promise<void>
  checkReaderStatus: () => Promise<boolean>
  swapToBackup: () => void
  triggerBeep: () => Promise<void>
  refreshReaderConfig: () => Promise<void>

  boundReaderId: string | null
  canSwap: boolean
  isSwapping: boolean
  showSwapModal: boolean
  setShowSwapModal: (show: boolean) => void
}

/**
 * useDatacap - Handles Datacap Direct payment processing
 *
 * All communication goes through server-side API routes (/api/datacap/*).
 * The browser never talks directly to the reader — this is required because:
 * 1. Browser CORS blocks direct HTTP to reader IP
 * 2. Server-side manages SequenceNo state
 * 3. Cloud mode requires Basic Auth credentials (must not expose to browser)
 */
export function useDatacap(options: UseDatacapOptions): UseDatacapReturn {
  const { terminalId, employeeId, locationId, onSuccess, onDeclined, onError, onReaderOffline } = options

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

  // Refs for abort handling
  const abortControllerRef = useRef<AbortController | null>(null)

  // Computed values
  const isProcessing = processingStatus !== 'idle' && processingStatus !== 'approved' && processingStatus !== 'declined' && processingStatus !== 'error'
  const boundReaderId = reader?.id || null
  const canSwap = !!backupReader && backupReader.id !== reader?.id

  // ─── Terminal Config ───────────────────────────────────────────────────

  const refreshReaderConfig = useCallback(async () => {
    try {
      const response = await fetch(`/api/hardware/terminals/${terminalId}`)
      if (!response.ok) throw new Error('Failed to fetch terminal config')

      const data = await response.json()
      const terminal = data.terminal

      if (terminal.paymentReader) {
        setReader(terminal.paymentReader)
        setIsReaderOnline(terminal.paymentReader.isOnline || false)
      } else {
        setReader(null)
        setIsReaderOnline(false)
      }

      if (terminal.backupPaymentReader) {
        setBackupReader(terminal.backupPaymentReader)
      } else {
        setBackupReader(null)
      }

      setReaderFailoverTimeout(terminal.readerFailoverTimeout || 10000)
    } catch (err) {
      console.error('[useDatacap] Failed to refresh reader config:', err)
    }
  }, [terminalId])

  useEffect(() => {
    refreshReaderConfig()
  }, [refreshReaderConfig])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  // ─── API Call Helper ───────────────────────────────────────────────────

  async function callDatacapApi<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(`/api/datacap/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        readerId: reader?.id,
        employeeId,
        ...body,
      }),
    })

    const json = await res.json()
    if (!res.ok) throw new Error(json.error || `Datacap API error (${res.status})`)
    return json.data as T
  }

  // ─── Parse API Response to DatacapResult ───────────────────────────────

  function toResult(data: Record<string, unknown>, amountRequested: number): DatacapResult {
    const amountAuthorized = data.amountAuthorized
      ? parseFloat(String(data.amountAuthorized))
      : (data.approved ? amountRequested : 0)
    const isPartialApproval = data.isPartialApproval as boolean || false

    return {
      approved: data.approved as boolean,
      authCode: data.authCode as string | undefined,
      refNumber: data.refNumber as string | undefined,
      recordNo: data.recordNo as string | undefined,
      cardBrand: data.cardType as string | undefined,
      cardLast4: data.cardLast4 as string | undefined,
      cardholderName: data.cardholderName as string | undefined,
      entryMethod: data.entryMethod as DatacapResult['entryMethod'],
      cvm: data.cvm as string | undefined,
      printData: data.printData as Record<string, string> | undefined,
      sequenceNo: data.sequenceNo as string | undefined,
      amountRequested,
      amountAuthorized,
      isPartialApproval,
      signatureData: data.signatureData as string | undefined,
      error: data.error ? (data.error as { message: string }).message : undefined,
      responseCode: data.error ? (data.error as { code: string }).code : undefined,
      responseMessage: data.error ? (data.error as { message: string }).message : undefined,
    }
  }

  // ─── Reader Status ─────────────────────────────────────────────────────

  const checkReaderStatus = useCallback(async (): Promise<boolean> => {
    if (!reader) {
      setIsReaderOnline(false)
      return false
    }

    try {
      const response = await fetch(`/api/hardware/payment-readers/${reader.id}/ping`, {
        method: 'POST',
      })
      const result = await response.json()
      setIsReaderOnline(result.isOnline || false)
      if (result.isOnline) setError(null)
      return result.isOnline || false
    } catch (err) {
      console.error('[useDatacap] Reader ping failed:', err)
      setIsReaderOnline(false)
      return false
    }
  }, [reader])

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

  const swapToBackup = useCallback(() => {
    if (!backupReader) return
    setIsSwapping(true)
    const previousReader = reader
    setReader(backupReader)
    setBackupReader(previousReader)

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

  const cancelTransaction = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort()

    // Send pad reset to clear the reader
    if (reader) {
      try {
        await fetch('/api/datacap/pad-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId, readerId: reader.id }),
        })
      } catch {
        // Best effort — reader might already be reset
      }
    }

    setProcessingStatus('idle')
    setError(null)
  }, [reader, locationId])

  // ─── Process Payment (EMVSale) ─────────────────────────────────────────

  const processPayment = useCallback(async (params: {
    orderId: string
    amount: number
    tipAmount?: number
    tipMode?: 'suggestive' | 'prompt' | 'included' | 'none'
    tipSuggestions?: number[]
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      const msg = 'No payment reader configured'
      setError(msg)
      onError?.(msg)
      return null
    }

    setProcessingStatus('checking_reader')
    setError(null)

    try {
      // Check reader is online first
      const online = await checkReaderStatus()
      if (!online) {
        setProcessingStatus('error')
        setError('Reader offline')
        onReaderOffline?.(reader.id)
        if (canSwap) setShowSwapModal(true)
        return null
      }

      setProcessingStatus('waiting_card')

      const data = await callDatacapApi<Record<string, unknown>>('sale', {
        invoiceNo: params.orderId,
        amount: params.amount,
        tipAmount: params.tipAmount,
        tipMode: params.tipMode || 'none',
        tipSuggestions: params.tipSuggestions,
      })

      const result = toResult(data, params.amount)

      if (result.approved) {
        setProcessingStatus('approved')
        onSuccess?.(result)
      } else {
        setProcessingStatus('declined')
        result.error = result.responseMessage || 'Transaction declined'
        onDeclined?.(result.error)
      }

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      setProcessingStatus('error')
      setError(msg)
      onError?.(msg)
      return null
    }
  }, [reader, canSwap, locationId, employeeId, checkReaderStatus, onSuccess, onDeclined, onError, onReaderOffline])

  // ─── Pre-Auth (Open Tab) ───────────────────────────────────────────────

  const preAuth = useCallback(async (params: {
    orderId: string
    amount: number
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    setProcessingStatus('waiting_card')
    setError(null)

    try {
      const data = await callDatacapApi<Record<string, unknown>>('preauth', {
        orderId: params.orderId,
        amount: params.amount,
      })

      const result = toResult(data, params.amount)

      if (result.approved) {
        setProcessingStatus('approved')
      } else {
        setProcessingStatus('declined')
      }

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pre-auth failed'
      setProcessingStatus('error')
      setError(msg)
      onError?.(msg)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Capture Pre-Auth (Close Tab) ──────────────────────────────────────

  const capturePreAuth = useCallback(async (params: {
    recordNo: string
    purchaseAmount: number
    gratuityAmount?: number
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    setProcessingStatus('authorizing')
    setError(null)

    try {
      const data = await callDatacapApi<Record<string, unknown>>('capture', {
        recordNo: params.recordNo,
        purchaseAmount: params.purchaseAmount,
        gratuityAmount: params.gratuityAmount,
      })

      const result = toResult(data, params.purchaseAmount + (params.gratuityAmount || 0))
      setProcessingStatus(result.approved ? 'approved' : 'declined')
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Capture failed'
      setProcessingStatus('error')
      setError(msg)
      onError?.(msg)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Incremental Auth (Add to Tab) ─────────────────────────────────────

  const incrementAuth = useCallback(async (params: {
    recordNo: string
    additionalAmount: number
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    // Silent — no UI status change for background increments
    try {
      const data = await callDatacapApi<Record<string, unknown>>('increment', {
        recordNo: params.recordNo,
        additionalAmount: params.additionalAmount,
      })

      return toResult(data, params.additionalAmount)
    } catch (err) {
      console.warn('[useDatacap] Increment failed:', err)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Adjust Tip (Post-Sale) ────────────────────────────────────────────

  const adjustTip = useCallback(async (params: {
    recordNo: string
    purchaseAmount: number
    gratuityAmount: number
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    try {
      const data = await callDatacapApi<Record<string, unknown>>('adjust', {
        recordNo: params.recordNo,
        purchaseAmount: params.purchaseAmount,
        gratuityAmount: params.gratuityAmount,
      })

      return toResult(data, params.purchaseAmount + params.gratuityAmount)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tip adjust failed'
      onError?.(msg)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Void Sale ─────────────────────────────────────────────────────────

  const voidSale = useCallback(async (params: {
    recordNo: string
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    try {
      const data = await callDatacapApi<Record<string, unknown>>('void', {
        recordNo: params.recordNo,
      })

      return toResult(data, 0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Void failed'
      onError?.(msg)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Return / Refund ───────────────────────────────────────────────────

  const processReturn = useCallback(async (params: {
    amount: number
    recordNo?: string
    cardPresent?: boolean
    invoiceNo?: string
  }): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    setProcessingStatus(params.cardPresent !== false ? 'waiting_card' : 'authorizing')
    setError(null)

    try {
      const data = await callDatacapApi<Record<string, unknown>>('return', {
        recordNo: params.recordNo,
        amount: params.amount,
        cardPresent: params.cardPresent !== false,
        invoiceNo: params.invoiceNo,
      })

      const result = toResult(data, params.amount)
      setProcessingStatus(result.approved ? 'approved' : 'declined')
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Return failed'
      setProcessingStatus('error')
      setError(msg)
      onError?.(msg)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Collect Card Data (No Charge) ─────────────────────────────────────

  const collectCardData = useCallback(async (): Promise<DatacapResult | null> => {
    if (!reader) {
      onError?.('No payment reader configured')
      return null
    }

    setProcessingStatus('waiting_card')
    setError(null)

    try {
      const data = await callDatacapApi<Record<string, unknown>>('collect-card', {})

      const result: DatacapResult = {
        approved: data.success as boolean,
        cardBrand: data.cardType as string | undefined,
        cardLast4: data.cardLast4 as string | undefined,
        cardholderName: data.cardholderName as string | undefined,
        entryMethod: data.entryMethod as DatacapResult['entryMethod'],
        amountRequested: 0,
        amountAuthorized: 0,
        isPartialApproval: false,
      }

      setProcessingStatus(result.approved ? 'approved' : 'error')
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Card read failed'
      setProcessingStatus('error')
      setError(msg)
      onError?.(msg)
      return null
    }
  }, [reader, locationId, employeeId, onError])

  // ─── Return ────────────────────────────────────────────────────────────

  return {
    // State
    reader,
    backupReader,
    isReaderOnline,
    isProcessing,
    processingStatus,
    error,

    // Sale / payment
    processPayment,

    // Bar tab operations
    preAuth,
    capturePreAuth,
    incrementAuth,
    adjustTip,

    // Void / return
    voidSale,
    processReturn,

    // Card data collection
    collectCardData,

    // Reader management
    cancelTransaction,
    checkReaderStatus,
    swapToBackup,
    triggerBeep,
    refreshReaderConfig,

    boundReaderId,
    canSwap,
    isSwapping,
    showSwapModal,
    setShowSwapModal,
  }
}

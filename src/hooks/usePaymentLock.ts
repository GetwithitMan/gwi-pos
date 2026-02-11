'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { PaymentIntentManager } from '@/lib/payment-intent-manager'
import { offlineDb, PaymentIntent } from '@/lib/offline-db'

export type PaymentLockState =
  | 'idle'              // Ready to accept payment
  | 'locked'            // Payment in progress, UI disabled
  | 'intent_created'    // Intent logged to IndexedDB
  | 'processing'        // Sending to gateway
  | 'success'           // Payment completed
  | 'queued'            // Queued for offline sync
  | 'failed'            // Payment failed
  | 'declined'          // Card declined

interface PaymentLockResult {
  state: PaymentLockState
  intentId: string | null
  error: string | null
  isLocked: boolean
}

interface UsePaymentLockOptions {
  terminalId: string
  employeeId: string
  onSuccess?: (intent: PaymentIntent) => void
  onQueued?: (intent: PaymentIntent) => void
  onFailed?: (error: string) => void
}

/**
 * usePaymentLock - Prevents double-tap payments with UI-state locking
 *
 * The Transaction Handshake:
 * Phase A: Lock the order locally (state: 'locked')
 * Phase B: Write "Intent to Pay" to IndexedDB (state: 'intent_created')
 * Phase C: Attempt the payment/sync (state: 'processing')
 * Phase D: Unlock only after Phase B is confirmed (state: 'idle' or 'queued')
 */
export function usePaymentLock(options: UsePaymentLockOptions) {
  const { terminalId, employeeId, onSuccess, onQueued, onFailed } = options

  const [result, setResult] = useState<PaymentLockResult>({
    state: 'idle',
    intentId: null,
    error: null,
    isLocked: false,
  })

  const lockTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentIntentRef = useRef<PaymentIntent | null>(null)

  // Clear any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current)
      }
    }
  }, [])

  /**
   * Check for unfinished intents on mount
   * Handles the "User Abort" edge case
   */
  useEffect(() => {
    const checkUnfinishedIntents = async () => {
      try {
        const unfinished = await offlineDb.paymentIntents
          .where('terminalId')
          .equals(terminalId)
          .filter(
            (i) =>
              i.status === 'intent_created' ||
              i.status === 'tokenizing' ||
              i.status === 'authorizing'
          )
          .toArray()

        if (unfinished.length > 0) {
          // The caller can handle this - expose it via a getter
        }
      } catch {
        // IndexedDB not available
      }
    }

    checkUnfinishedIntents()
  }, [terminalId])

  /**
   * Get unfinished intents for this terminal
   */
  const getUnfinishedIntents = useCallback(async (): Promise<PaymentIntent[]> => {
    try {
      return await offlineDb.paymentIntents
        .where('terminalId')
        .equals(terminalId)
        .filter(
          (i) =>
            i.status === 'intent_created' ||
            i.status === 'tokenizing' ||
            i.status === 'authorizing'
        )
        .toArray()
    } catch {
      return []
    }
  }, [terminalId])

  /**
   * Start a payment - locks the UI and creates the intent
   */
  const startPayment = useCallback(
    async (params: {
      orderId: string
      localOrderId?: string
      amount: number
      tipAmount?: number
      paymentMethod: 'card' | 'cash' | 'gift_card' | 'house_account'
    }): Promise<PaymentIntent | null> => {
      // Check if already locked
      if (result.isLocked) {
        console.warn('[usePaymentLock] Payment already in progress')
        return null
      }

      try {
        // Phase A: Lock the UI
        setResult({
          state: 'locked',
          intentId: null,
          error: null,
          isLocked: true,
        })

        // Phase B: Create the intent (write to IndexedDB)
        const intent = await PaymentIntentManager.createIntent({
          orderId: params.orderId,
          localOrderId: params.localOrderId,
          terminalId,
          employeeId,
          amount: params.amount,
          tipAmount: params.tipAmount,
          paymentMethod: params.paymentMethod,
        })

        currentIntentRef.current = intent

        setResult({
          state: 'intent_created',
          intentId: intent.id,
          error: null,
          isLocked: true,
        })

        // Set a safety timeout (60 seconds) to auto-unlock if something goes wrong
        lockTimeoutRef.current = setTimeout(() => {
          console.warn('[usePaymentLock] Safety timeout - unlocking')
          setResult((prev) => ({
            ...prev,
            state: 'failed',
            error: 'Payment timed out',
            isLocked: false,
          }))
        }, 60000)

        return intent
      } catch (error) {
        setResult({
          state: 'failed',
          intentId: null,
          error: error instanceof Error ? error.message : 'Failed to create payment intent',
          isLocked: false,
        })
        onFailed?.(error instanceof Error ? error.message : 'Unknown error')
        return null
      }
    },
    [result.isLocked, terminalId, employeeId, onFailed]
  )

  /**
   * Record successful authorization
   */
  const recordAuthorization = useCallback(
    async (transactionId: string, authCode: string) => {
      if (!currentIntentRef.current) return

      setResult((prev) => ({
        ...prev,
        state: 'processing',
      }))

      await PaymentIntentManager.recordAuthorization(currentIntentRef.current.id, {
        success: true,
        transactionId,
        authCode,
      })

      currentIntentRef.current = await PaymentIntentManager.getIntent(
        currentIntentRef.current.id
      ) as PaymentIntent
    },
    []
  )

  /**
   * Record successful capture and unlock
   */
  const completePayment = useCallback(
    async (serverPaymentId?: string) => {
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current)
      }

      if (!currentIntentRef.current) {
        setResult({
          state: 'idle',
          intentId: null,
          error: null,
          isLocked: false,
        })
        return
      }

      await PaymentIntentManager.recordCapture(
        currentIntentRef.current.id,
        serverPaymentId
      )

      const finalIntent = await PaymentIntentManager.getIntent(
        currentIntentRef.current.id
      )

      setResult({
        state: 'success',
        intentId: currentIntentRef.current.id,
        error: null,
        isLocked: false,
      })

      onSuccess?.(finalIntent as PaymentIntent)
      currentIntentRef.current = null

      // Reset to idle after a brief delay
      setTimeout(() => {
        setResult({
          state: 'idle',
          intentId: null,
          error: null,
          isLocked: false,
        })
      }, 2000)
    },
    [onSuccess]
  )

  /**
   * Queue payment for offline sync and unlock
   */
  const queueForSync = useCallback(async () => {
    if (lockTimeoutRef.current) {
      clearTimeout(lockTimeoutRef.current)
    }

    if (!currentIntentRef.current) {
      setResult({
        state: 'idle',
        intentId: null,
        error: null,
        isLocked: false,
      })
      return
    }

    await PaymentIntentManager.markForOfflineCapture(currentIntentRef.current.id)

    const finalIntent = await PaymentIntentManager.getIntent(
      currentIntentRef.current.id
    )

    setResult({
      state: 'queued',
      intentId: currentIntentRef.current.id,
      error: null,
      isLocked: false,
    })

    onQueued?.(finalIntent as PaymentIntent)
    currentIntentRef.current = null

    // Reset to idle after a brief delay
    setTimeout(() => {
      setResult({
        state: 'idle',
        intentId: null,
        error: null,
        isLocked: false,
      })
    }, 3000)
  }, [onQueued])

  /**
   * Record a declined payment and unlock
   */
  const recordDecline = useCallback(
    async (reason: string) => {
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current)
      }

      if (currentIntentRef.current) {
        await PaymentIntentManager.recordAuthorization(currentIntentRef.current.id, {
          success: false,
          declineReason: reason,
        })
      }

      setResult({
        state: 'declined',
        intentId: currentIntentRef.current?.id || null,
        error: reason,
        isLocked: false,
      })

      onFailed?.(reason)
      currentIntentRef.current = null
    },
    [onFailed]
  )

  /**
   * Record a failure and unlock
   */
  const recordFailure = useCallback(
    async (error: string) => {
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current)
      }

      if (currentIntentRef.current) {
        await PaymentIntentManager.recordFailure(currentIntentRef.current.id, error)
      }

      setResult({
        state: 'failed',
        intentId: currentIntentRef.current?.id || null,
        error,
        isLocked: false,
      })

      onFailed?.(error)
      currentIntentRef.current = null
    },
    [onFailed]
  )

  /**
   * Cancel/reset the payment lock
   */
  const cancel = useCallback(() => {
    if (lockTimeoutRef.current) {
      clearTimeout(lockTimeoutRef.current)
    }

    currentIntentRef.current = null

    setResult({
      state: 'idle',
      intentId: null,
      error: null,
      isLocked: false,
    })
  }, [])

  /**
   * Void an unfinished intent
   */
  const voidUnfinishedIntent = useCallback(async (intentId: string) => {
    try {
      const intent = await PaymentIntentManager.getIntent(intentId)
      if (intent) {
        intent.status = 'voided'
        intent.statusHistory.push({
          status: 'voided',
          timestamp: new Date().toISOString(),
          details: 'Voided by user',
        })
        await offlineDb.paymentIntents.put(intent)
      }
    } catch (error) {
      console.error('[usePaymentLock] Failed to void intent:', error)
    }
  }, [])

  return {
    ...result,
    startPayment,
    recordAuthorization,
    completePayment,
    queueForSync,
    recordDecline,
    recordFailure,
    cancel,
    getUnfinishedIntents,
    voidUnfinishedIntent,
  }
}

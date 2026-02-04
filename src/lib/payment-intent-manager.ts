'use client'

import { offlineDb, PaymentIntent, PaymentIntentStatus } from './offline-db'

/**
 * PaymentIntentManager - Handles the payment handshake persistence
 *
 * This is the "final boss" of POS reliability. It ensures that if a server swipes
 * a card and the Wi-Fi blips during the authorization handshake, the terminal
 * "remembers" exactly what happened and doesn't leave anyone in limbo.
 *
 * Flow:
 * 1. Intent Created - Log intent BEFORE any network request
 * 2. Tokenizing - Getting card token from SDK
 * 3. Token Received - Token saved, ready to authorize
 * 4. Authorizing - Sent to gateway, awaiting response
 * 5. Authorized - Gateway approved
 * 6. Capture Pending - Waiting to capture (store-and-forward if offline)
 * 7. Captured - Payment captured successfully
 */

type PaymentMethodType = 'card' | 'cash' | 'gift_card' | 'house_account'

interface CreateIntentParams {
  orderId: string
  localOrderId?: string
  terminalId: string
  employeeId: string
  amount: number
  tipAmount?: number
  paymentMethod: PaymentMethodType
}

interface TokenizeResult {
  token: string
  cardBrand?: string
  cardLast4?: string
}

interface AuthorizationResult {
  success: boolean
  transactionId?: string
  authCode?: string
  declineReason?: string
}

class PaymentIntentManagerClass {
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private isProcessing = false

  /**
   * Initialize the manager - starts the sync worker
   */
  initialize(): void {
    if (typeof window === 'undefined') return

    // Start sync worker (runs every 15 seconds)
    this.syncInterval = setInterval(() => {
      this.processPendingIntents()
    }, 15000)

    // Listen for online events to trigger immediate sync
    window.addEventListener('online', () => {
      console.log('[PaymentIntentManager] Connection restored, syncing...')
      this.processPendingIntents()
    })

    console.log('[PaymentIntentManager] Initialized')
  }

  /**
   * Generate an idempotency key (fingerprint) for deduplication
   * Format: {terminalId}-{orderId}-{timestamp}-{uuid}
   *
   * The UUID suffix ensures 100% collision resistance even if:
   * - Terminal clocks are out of sync with server
   * - App restarts and retries the same order
   * - Multiple terminals have identical timestamps
   */
  private generateIdempotencyKey(terminalId: string, orderId: string): string {
    const timestamp = Date.now()
    const uuid = crypto.randomUUID().slice(0, 8) // Short UUID suffix for collision resistance
    return `${terminalId}-${orderId}-${timestamp}-${uuid}`
  }

  /**
   * Step 1: Create Payment Intent
   * This MUST be called before any network request
   */
  async createIntent(params: CreateIntentParams): Promise<PaymentIntent> {
    const now = new Date().toISOString()
    const idempotencyKey = this.generateIdempotencyKey(params.terminalId, params.orderId)

    const intent: PaymentIntent = {
      id: crypto.randomUUID(),
      idempotencyKey,
      orderId: params.orderId,
      localOrderId: params.localOrderId,
      terminalId: params.terminalId,
      employeeId: params.employeeId,
      amount: params.amount,
      tipAmount: params.tipAmount || 0,
      subtotal: params.amount - (params.tipAmount || 0),
      paymentMethod: params.paymentMethod,
      status: 'intent_created',
      statusHistory: [
        {
          status: 'intent_created',
          timestamp: now,
          details: `Intent to charge $${params.amount.toFixed(2)} for order ${params.orderId}`,
        },
      ],
      createdAt: now,
      isOfflineCapture: false,
      needsReconciliation: false,
      attempts: 0,
    }

    await offlineDb.paymentIntents.add(intent)
    await this.logSync('payment_intent_created', intent.id, params.amount)

    console.log(`[PaymentIntentManager] Intent created: ${intent.id}`)
    return intent
  }

  /**
   * Step 2: Update intent with tokenized card data
   */
  async recordTokenization(
    intentId: string,
    tokenResult: TokenizeResult
  ): Promise<PaymentIntent> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()
    intent.cardToken = tokenResult.token
    intent.cardBrand = tokenResult.cardBrand
    intent.cardLast4 = tokenResult.cardLast4
    intent.status = 'token_received'
    intent.statusHistory.push({
      status: 'token_received',
      timestamp: now,
      details: `Card tokenized: ${tokenResult.cardBrand || 'Card'} ****${tokenResult.cardLast4 || '????'}`,
    })

    await offlineDb.paymentIntents.put(intent)
    await this.logSync('payment_tokenized', intentId, intent.amount)

    console.log(`[PaymentIntentManager] Token received for ${intentId}`)
    return intent
  }

  /**
   * Step 3: Mark intent as authorizing (about to send to gateway)
   */
  async markAuthorizing(intentId: string): Promise<PaymentIntent> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()
    intent.status = 'authorizing'
    intent.attempts += 1
    intent.lastAttempt = now
    intent.statusHistory.push({
      status: 'authorizing',
      timestamp: now,
      details: `Authorization attempt ${intent.attempts}`,
    })

    await offlineDb.paymentIntents.put(intent)
    return intent
  }

  /**
   * Step 4: Record authorization result from gateway
   */
  async recordAuthorization(
    intentId: string,
    result: AuthorizationResult
  ): Promise<PaymentIntent> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()

    if (result.success) {
      intent.status = 'authorized'
      intent.gatewayTransactionId = result.transactionId
      intent.authorizationCode = result.authCode
      intent.authorizedAt = now
      intent.statusHistory.push({
        status: 'authorized',
        timestamp: now,
        details: `Authorized: ${result.authCode}`,
      })
      await this.logSync('payment_authorized', intentId, intent.amount)
    } else {
      intent.status = 'declined'
      intent.lastError = result.declineReason || 'Card declined'
      intent.statusHistory.push({
        status: 'declined',
        timestamp: now,
        details: result.declineReason || 'Card declined by gateway',
      })
      await this.logSync('payment_declined', intentId, intent.amount)
    }

    await offlineDb.paymentIntents.put(intent)
    console.log(`[PaymentIntentManager] Authorization result for ${intentId}: ${intent.status}`)
    return intent
  }

  /**
   * Step 5: Mark for offline capture (when network is down after authorization)
   */
  async markForOfflineCapture(intentId: string): Promise<PaymentIntent> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()
    intent.status = 'capture_pending'
    intent.isOfflineCapture = true
    intent.offlineCapturedAt = now
    intent.needsReconciliation = true // Flag for EOD report
    intent.statusHistory.push({
      status: 'capture_pending',
      timestamp: now,
      details: 'Queued for offline capture - will sync when connection restored',
    })

    await offlineDb.paymentIntents.put(intent)
    await this.logSync('payment_offline_queued', intentId, intent.amount)

    console.log(`[PaymentIntentManager] Queued for offline capture: ${intentId}`)
    return intent
  }

  /**
   * Step 6: Record successful capture
   */
  async recordCapture(
    intentId: string,
    serverPaymentId?: string
  ): Promise<PaymentIntent> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()
    intent.status = 'captured'
    intent.capturedAt = now
    intent.syncedAt = now
    intent.statusHistory.push({
      status: 'captured',
      timestamp: now,
      details: serverPaymentId
        ? `Captured and synced: ${serverPaymentId}`
        : 'Payment captured successfully',
    })

    await offlineDb.paymentIntents.put(intent)
    await this.logSync('payment_captured', intentId, intent.amount)

    console.log(`[PaymentIntentManager] Captured: ${intentId}`)
    return intent
  }

  /**
   * Record a failed attempt (network error, etc.)
   */
  async recordFailure(intentId: string, error: string): Promise<PaymentIntent> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()
    intent.status = 'failed'
    intent.lastError = error
    intent.statusHistory.push({
      status: 'failed',
      timestamp: now,
      details: error,
    })

    await offlineDb.paymentIntents.put(intent)
    await this.logSync('payment_failed', intentId, intent.amount)

    console.log(`[PaymentIntentManager] Failed: ${intentId} - ${error}`)
    return intent
  }

  /**
   * Process pending intents when connection is restored
   * Uses batch sync-resolution endpoint for efficiency and idempotency
   */
  async processPendingIntents(): Promise<void> {
    if (this.isProcessing) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    this.isProcessing = true
    console.log('[PaymentIntentManager] Processing pending intents...')

    try {
      // Get all intents that need capture
      const pendingCaptures = await offlineDb.paymentIntents
        .where('status')
        .equals('capture_pending')
        .toArray()

      // Also check for authorized but not captured (edge case)
      const authorizedNotCaptured = await offlineDb.paymentIntents
        .where('status')
        .equals('authorized')
        .filter((i: PaymentIntent) => !i.capturedAt && Boolean(i.authorizedAt))
        .toArray()

      const allPending = [...pendingCaptures, ...authorizedNotCaptured]

      if (allPending.length === 0) {
        console.log('[PaymentIntentManager] No pending intents to sync')
        return
      }

      // Use batch sync-resolution endpoint
      await this.batchSyncIntents(allPending)

      console.log(`[PaymentIntentManager] Processed ${allPending.length} intents`)
    } catch (error) {
      console.error('[PaymentIntentManager] Error processing intents:', error)
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Batch sync multiple intents using the sync-resolution endpoint
   * This is more efficient and uses idempotency keys for deduplication
   */
  private async batchSyncIntents(intents: PaymentIntent[]): Promise<void> {
    // Convert intents to transaction format for the API
    const transactions = intents.map((intent) => ({
      localId: intent.id,
      orderId: intent.orderId,
      localOrderId: intent.localOrderId,
      idempotencyKey: intent.idempotencyKey,
      amount: intent.amount,
      tipAmount: intent.tipAmount,
      method: intent.paymentMethod,
      gatewayToken: intent.cardToken,
      cardBrand: intent.cardBrand,
      cardLast4: intent.cardLast4,
      authCode: intent.authorizationCode,
      gatewayTransactionId: intent.gatewayTransactionId,
      terminalId: intent.terminalId,
      employeeId: intent.employeeId,
      timestamp: intent.offlineCapturedAt || intent.createdAt,
    }))

    try {
      const response = await fetch('/api/orders/sync-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log('[PaymentIntentManager] Batch sync result:', data.summary)

        // Update local intents based on results
        for (const result of data.results) {
          const intent = intents.find((i) => i.id === result.id)
          if (!intent) continue

          if (result.status === 'synced' || result.status === 'duplicate_ignored') {
            await this.recordCapture(intent.id, result.serverId)
            await this.logSync('payment_synced', intent.id, intent.amount)
          } else if (result.status === 'failed') {
            console.error(`[PaymentIntentManager] Sync failed for ${intent.id}: ${result.error}`)
            // Increment attempt counter but don't mark as failed - will retry
            intent.attempts += 1
            intent.lastAttempt = new Date().toISOString()
            intent.lastError = result.error
            await offlineDb.paymentIntents.put(intent)
          }
        }
      } else {
        const error = await response.json()
        console.error('[PaymentIntentManager] Batch sync failed:', error)
      }
    } catch (error) {
      console.error('[PaymentIntentManager] Network error during batch sync:', error)
    }
  }

  /**
   * Sync a single intent to the server
   */
  private async syncIntent(intent: PaymentIntent): Promise<void> {
    try {
      // Mark as syncing in status history
      intent.statusHistory.push({
        status: intent.status,
        timestamp: new Date().toISOString(),
        details: 'Syncing to server...',
      })
      await offlineDb.paymentIntents.put(intent)

      // Send to server
      const response = await fetch('/api/payments/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intentId: intent.id,
          orderId: intent.orderId,
          localOrderId: intent.localOrderId,
          amount: intent.amount,
          tipAmount: intent.tipAmount,
          paymentMethod: intent.paymentMethod,
          cardToken: intent.cardToken,
          cardBrand: intent.cardBrand,
          cardLast4: intent.cardLast4,
          gatewayTransactionId: intent.gatewayTransactionId,
          authorizationCode: intent.authorizationCode,
          isOfflineCapture: intent.isOfflineCapture,
          offlineCapturedAt: intent.offlineCapturedAt,
          terminalId: intent.terminalId,
          employeeId: intent.employeeId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        await this.recordCapture(intent.id, data.paymentId)
        await this.logSync('payment_synced', intent.id, intent.amount)
      } else {
        const error = await response.json()
        console.error(`[PaymentIntentManager] Sync failed for ${intent.id}:`, error)
        // Don't mark as failed - will retry
      }
    } catch (error) {
      console.error(`[PaymentIntentManager] Network error syncing ${intent.id}:`, error)
      // Don't mark as failed - will retry on next interval
    }
  }

  /**
   * Get all intents that need reconciliation (for EOD report)
   */
  async getIntentsNeedingReconciliation(): Promise<PaymentIntent[]> {
    return offlineDb.paymentIntents
      .where('needsReconciliation')
      .equals(1) // IndexedDB stores booleans as 0/1
      .toArray()
  }

  /**
   * Get all offline-captured intents (for EOD report flagging)
   */
  async getOfflineCapturedIntents(): Promise<PaymentIntent[]> {
    return offlineDb.paymentIntents
      .where('isOfflineCapture')
      .equals(1)
      .filter((i) => i.status === 'captured')
      .toArray()
  }

  /**
   * Mark intent as reconciled (verified against bank statement)
   */
  async markReconciled(intentId: string, employeeId: string): Promise<void> {
    const intent = await offlineDb.paymentIntents.get(intentId)
    if (!intent) throw new Error(`Intent ${intentId} not found`)

    const now = new Date().toISOString()
    intent.needsReconciliation = false
    intent.reconciledAt = now
    intent.reconciledBy = employeeId
    intent.statusHistory.push({
      status: 'reconciled',
      timestamp: now,
      details: `Reconciled by employee ${employeeId}`,
    })

    await offlineDb.paymentIntents.put(intent)
  }

  /**
   * Get intent by ID
   */
  async getIntent(intentId: string): Promise<PaymentIntent | undefined> {
    return offlineDb.paymentIntents.get(intentId)
  }

  /**
   * Get all intents for an order
   */
  async getIntentsForOrder(orderId: string): Promise<PaymentIntent[]> {
    return offlineDb.paymentIntents.where('orderId').equals(orderId).toArray()
  }

  /**
   * Get recent intents for display
   */
  async getRecentIntents(limit = 50): Promise<PaymentIntent[]> {
    return offlineDb.paymentIntents
      .orderBy('createdAt')
      .reverse()
      .limit(limit)
      .toArray()
  }

  /**
   * Log to sync logs
   */
  private async logSync(
    action: 'payment_intent_created' | 'payment_tokenized' | 'payment_authorized' | 'payment_captured' | 'payment_offline_queued' | 'payment_synced' | 'payment_declined' | 'payment_failed',
    localId: string,
    amount: number
  ): Promise<void> {
    await offlineDb.syncLogs.add({
      timestamp: new Date().toISOString(),
      action,
      details: `${action} for $${amount.toFixed(2)}`,
      localId,
      amount,
    })
  }

  /**
   * Cleanup old captured intents (older than 30 days)
   */
  async cleanupOldIntents(): Promise<number> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const oldIntents = await offlineDb.paymentIntents
      .where('status')
      .equals('captured')
      .filter((i: PaymentIntent) => Boolean(i.capturedAt) && new Date(i.capturedAt!) < thirtyDaysAgo)
      .toArray()

    for (const intent of oldIntents) {
      await offlineDb.paymentIntents.delete(intent.id)
    }

    return oldIntents.length
  }
}

// Singleton export
export const PaymentIntentManager = new PaymentIntentManagerClass()

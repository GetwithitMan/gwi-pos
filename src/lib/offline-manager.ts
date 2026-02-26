import {
  offlineDb,
  PendingOrder,
  PendingPrintJob,
  PendingPayment,
  generateLocalOrderId,
  getNextLocalSequence,
} from './offline-db'
import { uuid } from './uuid'

type ConnectionStatus = 'online' | 'offline' | 'degraded'
type SyncCallback = (status: { pending: number; syncing: boolean; lastError?: string }) => void

class OfflineManagerClass {
  private isProcessing = false
  private retryInterval: NodeJS.Timeout | null = null
  private healthCheckInterval: NodeJS.Timeout | null = null
  private connectionStatus: ConnectionStatus = 'online'
  private listeners: Set<SyncCallback> = new Set()
  private terminalId: string | null = null
  private terminalName: string = 'TERM'
  private lastSuccessfulPing: number = Date.now()
  private consecutiveFailures: number = 0

  // Initialize with terminal info
  initialize(terminalId: string, terminalName: string) {
    this.terminalId = terminalId
    this.terminalName = terminalName

    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline())
      window.addEventListener('offline', () => this.handleOffline())

      // Check initial status
      this.connectionStatus = navigator.onLine ? 'online' : 'offline'

      // Start retry interval (every 30 seconds)
      this.startRetryInterval()

      // Start health check interval (every 60 seconds)
      // This detects "Zombie Wi-Fi" - connected to router but no internet
      this.startHealthCheckInterval()

      // Do an immediate health check
      this.checkServerHealth()
    }
  }

  /**
   * Check if the server is actually reachable
   * navigator.onLine only tells us if Wi-Fi is connected, not if internet works
   */
  private async checkServerHealth(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

      const response = await fetch('/api/health', {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        this.lastSuccessfulPing = Date.now()
        this.consecutiveFailures = 0

        // If we were degraded but server is now reachable, upgrade to online
        if (this.connectionStatus === 'degraded') {
          this.connectionStatus = 'online'
          this.notifyListeners()
          // Process queues now that we're back
          this.processOrderQueue()
          this.processPrintQueue()
          this.processPaymentQueue()
        }
        return true
      }

      throw new Error(`Health check returned ${response.status}`)
    } catch (error) {
      this.consecutiveFailures++

      // After 2 consecutive failures, mark as degraded (Zombie Wi-Fi detection)
      if (this.consecutiveFailures >= 2 && this.connectionStatus === 'online') {
        console.warn('[OfflineManager] Zombie Wi-Fi detected - navigator.onLine=true but server unreachable')
        this.connectionStatus = 'degraded'
        await this.logAction('connection_lost', 'Server unreachable (Zombie Wi-Fi detected)')
        this.notifyListeners()
      }

      return false
    }
  }

  private startHealthCheckInterval() {
    if (this.healthCheckInterval) return

    // Check server health every 60 seconds
    this.healthCheckInterval = setInterval(() => {
      // Only check if navigator thinks we're online
      if (navigator.onLine) {
        this.checkServerHealth()
      }
    }, 60000)
  }

  // Subscribe to sync status changes
  subscribe(callback: SyncCallback): () => void {
    this.listeners.add(callback)
    this.notifyListeners()
    return () => this.listeners.delete(callback)
  }

  private async notifyListeners() {
    const pending = await this.getPendingCount()
    const status = {
      pending,
      syncing: this.isProcessing,
      lastError: undefined,
    }
    this.listeners.forEach((cb) => cb(status))
  }

  // Get count of pending items
  async getPendingCount(): Promise<number> {
    const orders = await offlineDb.pendingOrders.where('status').anyOf(['pending', 'failed']).count()
    const payments = await offlineDb.pendingPayments
      .where('status')
      .anyOf(['pending', 'failed'])
      .count()
    return orders + payments
  }

  // Get all pending orders for display
  async getPendingOrders(): Promise<PendingOrder[]> {
    return offlineDb.pendingOrders.where('status').anyOf(['pending', 'failed', 'syncing']).toArray()
  }

  // Queue an order for sync
  async queueOrder(orderData: PendingOrder['data']): Promise<{ localId: string; id: string }> {
    if (!this.terminalId) {
      throw new Error('OfflineManager not initialized')
    }

    const sequence = await getNextLocalSequence(this.terminalId)
    const localId = generateLocalOrderId(this.terminalName, sequence)
    const id = uuid()

    const entry: PendingOrder = {
      id,
      localId,
      terminalId: this.terminalId,
      data: orderData,
      timestamp: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    }

    await offlineDb.pendingOrders.add(entry)
    await this.logAction('order_queued', `Order ${localId} queued for sync`, localId)

    // Immediately try to sync if online
    if (this.connectionStatus === 'online') {
      this.processOrderQueue()
    }

    this.notifyListeners()
    return { localId, id }
  }

  // Queue a print job (for when server is down but local network is up)
  async queuePrintJob(
    orderId: string,
    printerIp: string,
    printerPort: number,
    ticketData: number[]
  ): Promise<string> {
    const id = uuid()

    const entry: PendingPrintJob = {
      id,
      orderId,
      printerIp,
      printerPort,
      ticketData,
      timestamp: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    }

    await offlineDb.pendingPrintJobs.add(entry)
    await this.logAction('print_queued', `Print job queued for ${printerIp}`)

    // Try to print immediately
    this.processPrintQueue()

    return id
  }

  // Queue a payment for sync
  async queuePayment(
    orderId: string,
    paymentData: PendingPayment['data'],
    localOrderId?: string
  ): Promise<string> {
    const id = uuid()

    const entry: PendingPayment = {
      id,
      orderId,
      localOrderId,
      data: paymentData,
      timestamp: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    }

    await offlineDb.pendingPayments.add(entry)

    // Immediately try to sync if online
    if (this.connectionStatus === 'online') {
      this.processPaymentQueue()
    }

    this.notifyListeners()
    return id
  }

  // Process the order queue
  private async processOrderQueue() {
    if (this.isProcessing) return
    if (this.connectionStatus === 'offline') return

    this.isProcessing = true
    this.notifyListeners()

    try {
      const pending = await offlineDb.pendingOrders
        .where('status')
        .anyOf(['pending', 'failed'])
        .sortBy('timestamp')

      for (const order of pending) {
        // Update status to syncing
        await offlineDb.pendingOrders.update(order.id, {
          status: 'syncing',
          lastAttempt: new Date().toISOString(),
          attempts: order.attempts + 1,
        })

        try {
          // Try to sync with server
          const res = await fetch('/api/orders/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...order.data,
              localId: order.localId,
              offlineId: order.id,
              offlineTimestamp: order.timestamp,
            }),
          })

          if (res.ok) {
            const raw = await res.json()
            const data = raw.data ?? raw
            // Success - mark as synced
            await offlineDb.pendingOrders.update(order.id, {
              status: 'synced',
              serverOrderId: data.order?.id,
            })
            await this.logAction('order_synced', `Order ${order.localId} synced`, order.localId, data.order?.id)
          } else if (res.status === 409) {
            // Duplicate - already synced
            const raw409 = await res.json()
            const data = raw409.data ?? raw409
            await offlineDb.pendingOrders.update(order.id, {
              status: 'synced',
              serverOrderId: data.existingOrderId,
            })
          } else {
            throw new Error(`Server returned ${res.status}`)
          }
        } catch (err) {
          // Failed - mark for retry
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          await offlineDb.pendingOrders.update(order.id, {
            status: 'failed',
            errorMessage,
          })
          await this.logAction('order_failed', `Order ${order.localId} sync failed: ${errorMessage}`, order.localId)

          // If network error, stop processing and wait for reconnect
          if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
            this.connectionStatus = 'degraded'
            break
          }
        }
      }
    } finally {
      this.isProcessing = false
      this.notifyListeners()
    }
  }

  // Process the print queue (direct to printer over local network)
  private async processPrintQueue() {
    const pending = await offlineDb.pendingPrintJobs
      .where('status')
      .anyOf(['pending', 'failed'])
      .sortBy('timestamp')

    for (const job of pending) {
      await offlineDb.pendingPrintJobs.update(job.id, {
        status: 'printing',
        attempts: job.attempts + 1,
      })

      try {
        // Try direct TCP connection to printer
        // Note: This requires a local print proxy or WebSocket bridge
        // For now, we'll try the local print API
        const res = await fetch('/api/print/direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerIp: job.printerIp,
            printerPort: job.printerPort,
            data: job.ticketData,
          }),
        })

        if (res.ok) {
          await offlineDb.pendingPrintJobs.update(job.id, { status: 'printed' })
          await this.logAction('print_sent', `Print job sent to ${job.printerIp}`)
        } else {
          throw new Error(`Print failed: ${res.status}`)
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        await offlineDb.pendingPrintJobs.update(job.id, {
          status: 'failed',
          errorMessage,
        })
      }
    }
  }

  // Process the payment queue
  private async processPaymentQueue() {
    if (this.connectionStatus === 'offline') return

    const pending = await offlineDb.pendingPayments
      .where('status')
      .anyOf(['pending', 'failed'])
      .sortBy('timestamp')

    for (const payment of pending) {
      await offlineDb.pendingPayments.update(payment.id, {
        status: 'syncing',
        attempts: payment.attempts + 1,
      })

      try {
        // If this payment is for an offline order, we need the server order ID
        let orderId = payment.orderId
        if (payment.localOrderId) {
          const order = await offlineDb.pendingOrders
            .where('localId')
            .equals(payment.localOrderId)
            .first()
          if (order?.serverOrderId) {
            orderId = order.serverOrderId
          } else if (order?.status !== 'synced') {
            // Order not synced yet - skip this payment
            await offlineDb.pendingPayments.update(payment.id, { status: 'pending' })
            continue
          }
        }

        // Transform PendingPayment.data into PaymentRequestSchema shape
        // PendingPayment stores: { paymentMethodId, amount, tipAmount, employeeId }
        // Pay route expects: { payments: [{ method, amount, tipAmount }], employeeId, terminalId }
        const payData = payment.data
        const payloadMethod = (payData as Record<string, unknown>).paymentMethodId ?? (payData as Record<string, unknown>).method ?? 'cash'
        const payloadAmount = payData.amount
        const payloadTip = payData.tipAmount ?? 0
        const payloadEmployee = payData.employeeId

        // If data already has a `payments` array (new callers), pass through;
        // otherwise transform the flat structure into the expected shape
        const body = (payData as Record<string, unknown>).payments
          ? payData
          : {
              payments: [{
                method: payloadMethod,
                amount: payloadAmount,
                tipAmount: payloadTip,
                // Forward cash-specific fields if present
                ...((payData as Record<string, unknown>).amountTendered ? { amountTendered: (payData as Record<string, unknown>).amountTendered } : {}),
              }],
              employeeId: payloadEmployee,
              terminalId: this.terminalId || undefined,
            }

        const res = await fetch(`/api/orders/${orderId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (res.ok) {
          await offlineDb.pendingPayments.update(payment.id, { status: 'synced' })
        } else {
          // Capture response body for debugging
          let errorDetail = ''
          let errBody: Record<string, unknown> | null = null
          try {
            errBody = await res.json() as Record<string, unknown>
            errorDetail = (errBody?.error as string) || JSON.stringify(errBody).slice(0, 200)
          } catch { /* ignore parse errors */ }

          // If order is already paid/closed, treat as success (stop retrying)
          const alreadyPaid = errorDetail.includes('already paid')
            || errorDetail.includes('already closed')
            || errorDetail.includes('status: paid')
            || errorDetail.includes('status: closed')
            || (errBody?.data as Record<string, unknown>)?.alreadyPaid === true
          if (alreadyPaid) {
            await offlineDb.pendingPayments.update(payment.id, { status: 'synced' })
            continue
          }

          throw new Error(`Payment failed: ${res.status}${errorDetail ? ` — ${errorDetail}` : ''}`)
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        await offlineDb.pendingPayments.update(payment.id, {
          status: 'failed',
          errorMessage,
        })
      }
    }

    this.notifyListeners()
  }

  // Handle coming online
  private async handleOnline() {
    this.connectionStatus = 'online'
    await this.logAction('connection_restored', 'Network connection restored')
    this.notifyListeners()

    // Reset backoff for fast queue clearing
    this.resetBackoff()

    // Process all queues immediately
    this.processOrderQueue()
    this.processPrintQueue()
    this.processPaymentQueue()
  }

  // Handle going offline
  private async handleOffline() {
    this.connectionStatus = 'offline'
    await this.logAction('connection_lost', 'Network connection lost')
    this.notifyListeners()
  }

  // Start retry interval with exponential backoff
  // After coming back online, we retry quickly (5s, 10s, 20s, 30s) then settle at 30s
  private retryBackoffMs: number = 5000
  private readonly MIN_BACKOFF = 5000   // Start at 5 seconds
  private readonly MAX_BACKOFF = 30000  // Cap at 30 seconds

  private startRetryInterval() {
    if (this.retryInterval) return

    const runRetryLoop = async () => {
      if (this.connectionStatus !== 'offline' && !this.isProcessing) {
        const hadPending = await this.getPendingCount()

        await this.processOrderQueue()
        await this.processPrintQueue()
        await this.processPaymentQueue()

        const stillPending = await this.getPendingCount()

        // Adaptive backoff: if we successfully synced items, reset to fast retry
        // If nothing changed, slow down to reduce server load
        if (hadPending > 0 && stillPending < hadPending) {
          // Progress made! Keep retrying quickly
          this.retryBackoffMs = this.MIN_BACKOFF
        } else if (stillPending === 0) {
          // Queue is clear, slow down
          this.retryBackoffMs = this.MAX_BACKOFF
        } else {
          // No progress, exponential backoff
          this.retryBackoffMs = Math.min(this.retryBackoffMs * 2, this.MAX_BACKOFF)
        }
      }

      // Schedule next retry
      this.retryInterval = setTimeout(runRetryLoop, this.retryBackoffMs)
    }

    // Start the loop
    this.retryInterval = setTimeout(runRetryLoop, this.retryBackoffMs)
  }

  // Reset backoff when coming back online (clear queue faster)
  private resetBackoff() {
    this.retryBackoffMs = this.MIN_BACKOFF
  }

  // Log sync actions
  private async logAction(
    action: 'order_queued' | 'order_synced' | 'order_failed' | 'print_queued' | 'print_sent' | 'connection_lost' | 'connection_restored',
    details: string,
    localId?: string,
    serverId?: string
  ) {
    await offlineDb.syncLogs.add({
      timestamp: new Date().toISOString(),
      action,
      details,
      localId,
      serverId,
    })

    // Keep only last 1000 logs
    const count = await offlineDb.syncLogs.count()
    if (count > 1000) {
      const oldest = await offlineDb.syncLogs.orderBy('id').limit(count - 1000).toArray()
      await offlineDb.syncLogs.bulkDelete(oldest.map((l) => l.id!))
    }
  }

  // Get sync logs
  async getSyncLogs(limit = 50): Promise<any[]> {
    return offlineDb.syncLogs.orderBy('id').reverse().limit(limit).toArray()
  }

  // Check connection status
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus
  }

  // Force a sync attempt
  async forceSync() {
    this.connectionStatus = 'online'
    await this.processOrderQueue()
    await this.processPrintQueue()
    await this.processPaymentQueue()
  }

  // Clear synced items (cleanup)
  async clearSyncedItems() {
    await offlineDb.pendingOrders.where('status').equals('synced').delete()
    await offlineDb.pendingPrintJobs.where('status').equals('printed').delete()
    await offlineDb.pendingPayments.where('status').equals('synced').delete()
  }
}

// Singleton instance
export const OfflineManager = new OfflineManagerClass()

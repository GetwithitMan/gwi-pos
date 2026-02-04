import Dexie, { Table } from 'dexie'

// Types for offline storage
export interface PendingOrder {
  id: string // UUID for deduplication
  localId: string // Terminal-prefixed ID (e.g., "BAR1-102")
  terminalId: string
  data: {
    locationId: string
    tableId?: string
    orderTypeId?: string
    employeeId: string
    items: any[]
    customFields?: any
  }
  timestamp: string
  attempts: number
  lastAttempt?: string
  status: 'pending' | 'syncing' | 'failed' | 'synced'
  errorMessage?: string
  serverOrderId?: string // Set after successful sync
}

export interface PendingPrintJob {
  id: string
  orderId: string // Local or server order ID
  printerIp: string
  printerPort: number
  ticketData: Buffer | number[] // ESC/POS command bytes
  timestamp: string
  attempts: number
  status: 'pending' | 'printing' | 'failed' | 'printed'
  errorMessage?: string
}

export interface PendingPayment {
  id: string
  orderId: string
  localOrderId?: string // If order was created offline
  data: {
    paymentMethodId: string
    amount: number
    tipAmount?: number
    employeeId: string
  }
  timestamp: string
  attempts: number
  status: 'pending' | 'syncing' | 'failed' | 'synced'
  errorMessage?: string
}

// Payment Intent - Tracks the handshake state for payment persistence
// This is the "Transaction Intent" that gets logged BEFORE any network request
export type PaymentIntentStatus =
  | 'intent_created'      // Step 1: Intent logged locally
  | 'tokenizing'          // Step 2: Getting card token from SDK
  | 'token_received'      // Step 3: Token saved, ready to authorize
  | 'authorizing'         // Step 4: Sent to gateway, awaiting response
  | 'authorized'          // Step 5: Gateway approved
  | 'capture_pending'     // Step 6: Waiting to capture (store-and-forward)
  | 'captured'            // Step 7: Payment captured successfully
  | 'declined'            // Gateway declined
  | 'failed'              // Network or system error
  | 'voided'              // Payment was voided
  | 'reconciled'          // Matched with bank statement

export interface PaymentIntent {
  id: string              // UUID for this intent
  idempotencyKey: string  // Terminal+Order+Timestamp fingerprint for deduplication
  orderId: string         // Server order ID (if known)
  localOrderId?: string   // Local order ID (if order was offline)
  terminalId: string      // Which terminal initiated this
  employeeId: string      // Who processed the payment

  // Amount details
  amount: number          // Total charge amount
  tipAmount: number       // Tip portion
  subtotal: number        // Amount minus tip

  // Payment method details
  paymentMethod: 'card' | 'cash' | 'gift_card' | 'house_account'
  cardBrand?: string      // Visa, Mastercard, Amex, Discover
  cardLast4?: string      // Last 4 digits for display
  cardToken?: string      // Tokenized card data from SDK

  // Gateway tracking
  gatewayTransactionId?: string   // ID from payment gateway
  authorizationCode?: string      // Auth code from gateway

  // Status tracking
  status: PaymentIntentStatus
  statusHistory: Array<{
    status: PaymentIntentStatus
    timestamp: string
    details?: string
  }>

  // Timestamps
  createdAt: string       // When intent was created
  authorizedAt?: string   // When authorization was received
  capturedAt?: string     // When capture completed

  // Offline tracking
  isOfflineCapture: boolean       // Was this captured while offline?
  offlineCapturedAt?: string      // When it was queued for offline capture
  syncedAt?: string               // When it was synced to server

  // Error handling
  attempts: number
  lastAttempt?: string
  lastError?: string

  // Reconciliation
  needsReconciliation: boolean    // Flag for EOD report
  reconciledAt?: string
  reconciledBy?: string           // Employee who verified
}

export type SyncLogAction =
  | 'order_queued'
  | 'order_synced'
  | 'order_failed'
  | 'print_queued'
  | 'print_sent'
  | 'connection_lost'
  | 'connection_restored'
  | 'payment_intent_created'
  | 'payment_tokenized'
  | 'payment_authorized'
  | 'payment_captured'
  | 'payment_offline_queued'
  | 'payment_synced'
  | 'payment_declined'
  | 'payment_failed'

export interface SyncLog {
  id?: number
  timestamp: string
  action: SyncLogAction
  details: string
  localId?: string
  serverId?: string
  amount?: number  // For payment logs
}

class OfflineDatabase extends Dexie {
  pendingOrders!: Table<PendingOrder, string>
  pendingPrintJobs!: Table<PendingPrintJob, string>
  pendingPayments!: Table<PendingPayment, string>
  paymentIntents!: Table<PaymentIntent, string>
  syncLogs!: Table<SyncLog, number>

  constructor() {
    super('GWI_POS_Offline')

    // Version 1: Initial schema
    this.version(1).stores({
      pendingOrders: 'id, localId, terminalId, timestamp, status',
      pendingPrintJobs: 'id, orderId, printerIp, timestamp, status',
      pendingPayments: 'id, orderId, localOrderId, timestamp, status',
      syncLogs: '++id, timestamp, action',
    })

    // Version 2: Add paymentIntents for store-and-forward payments
    this.version(2).stores({
      pendingOrders: 'id, localId, terminalId, timestamp, status',
      pendingPrintJobs: 'id, orderId, printerIp, timestamp, status',
      pendingPayments: 'id, orderId, localOrderId, timestamp, status',
      paymentIntents: 'id, orderId, localOrderId, terminalId, status, isOfflineCapture, needsReconciliation, createdAt',
      syncLogs: '++id, timestamp, action',
    })
  }
}

export const offlineDb = new OfflineDatabase()

// Utility to generate terminal-prefixed IDs
export function generateLocalOrderId(terminalName: string, sequence: number): string {
  // Create a short prefix from terminal name (e.g., "Bar Terminal 1" -> "BAR1")
  const prefix = terminalName
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4)
  return `${prefix}-${sequence.toString().padStart(3, '0')}`
}

// Get next sequence number for this terminal
export async function getNextLocalSequence(terminalId: string): Promise<number> {
  const orders = await offlineDb.pendingOrders
    .where('terminalId')
    .equals(terminalId)
    .toArray()

  if (orders.length === 0) return 1

  // Extract sequence numbers and find max
  const sequences = orders
    .map((o) => {
      const match = o.localId.match(/-(\d+)$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => !isNaN(n))

  return Math.max(...sequences, 0) + 1
}

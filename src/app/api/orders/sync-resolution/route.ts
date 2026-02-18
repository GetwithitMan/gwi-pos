import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * Transaction payload from offline queue
 */
interface OfflineTransaction {
  localId: string           // Local UUID for this transaction
  orderId: string           // Server order ID (or local order ID if order was offline)
  localOrderId?: string     // Local order ID if created offline
  idempotencyKey: string    // Terminal+Order+Timestamp fingerprint
  amount: number
  tipAmount?: number
  method: 'card' | 'cash' | 'gift_card' | 'house_account'
  gatewayToken?: string     // For card payments
  cardBrand?: string
  cardLast4?: string
  authCode?: string
  gatewayTransactionId?: string
  terminalId: string
  terminalName?: string     // Display name of terminal
  employeeId: string
  timestamp: string         // When the payment was initiated locally
  isVoid?: boolean          // If true, this is a void request
  voidReason?: string       // Reason for void
}

interface SyncResult {
  id: string
  status: 'synced' | 'failed' | 'duplicate_ignored' | 'voided'
  serverId?: string         // Server payment ID if created
  note?: string
  error?: string
}

/**
 * Create an audit log entry
 */
async function logAuditEntry(params: {
  locationId: string
  orderId: string
  paymentId?: string
  terminalId: string
  terminalName: string
  employeeId?: string
  amount: number
  idempotencyKey: string
  localIntentId?: string
  status: 'SUCCESS' | 'DUPLICATE_BLOCKED' | 'OFFLINE_SYNC' | 'VOIDED' | 'FAILED'
  statusNote?: string
  cardLast4?: string
}) {
  try {
    await db.syncAuditEntry.create({
      data: {
        locationId: params.locationId,
        orderId: params.orderId,
        paymentId: params.paymentId || null,
        terminalId: params.terminalId,
        terminalName: params.terminalName,
        employeeId: params.employeeId || null,
        amount: params.amount,
        idempotencyKey: params.idempotencyKey,
        localIntentId: params.localIntentId || null,
        status: params.status,
        statusNote: params.statusNote || null,
        cardLast4: params.cardLast4 || null,
      },
    })
  } catch (error) {
    console.error('[SyncResolution] Failed to log audit entry:', error)
  }
}

/**
 * POST /api/orders/sync-resolution
 *
 * Handles batch syncing of offline payments with idempotency protection.
 * Each transaction has a "fingerprint" (idempotencyKey) that prevents double-charges.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const { transactions, locationId } = await request.json()

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'transactions array is required' },
        { status: 400 }
      )
    }

    const results: SyncResult[] = []
    let duplicatesBlocked = 0
    let successfulSyncs = 0
    let failedSyncs = 0
    let voidedCount = 0

    // Get terminal names for audit logging
    const terminalIds = [...new Set(transactions.map((t: OfflineTransaction) => t.terminalId))]
    const terminals = await db.terminal.findMany({
      where: { id: { in: terminalIds } },
      select: { id: true, name: true },
    })
    const terminalNameMap = new Map(terminals.map((t) => [t.id, t.name]))

    for (const tx of transactions as OfflineTransaction[]) {
      const terminalName = tx.terminalName || terminalNameMap.get(tx.terminalId) || tx.terminalId

      try {
        // ========================================
        // 0. VOID HANDLING
        // ========================================
        if (tx.isVoid) {
          // Mark this idempotency key as voided - never process it
          // Check if there's an existing payment to void
          const existingPayment = await db.payment.findFirst({
            where: {
              OR: [
                { idempotencyKey: tx.idempotencyKey },
                { offlineIntentId: tx.localId },
              ],
            },
          })

          if (existingPayment) {
            // Void the existing payment
            await db.payment.update({
              where: { id: existingPayment.id },
              data: {
                status: 'voided',
                refundReason: tx.voidReason || 'Voided before sync',
              },
            })
          }

          // Log the void attempt for audit
          await logAuditEntry({
            locationId,
            orderId: tx.orderId,
            terminalId: tx.terminalId,
            terminalName,
            employeeId: tx.employeeId,
            amount: tx.amount,
            idempotencyKey: tx.idempotencyKey,
            localIntentId: tx.localId,
            status: 'VOIDED',
            statusNote: tx.voidReason || 'Voided offline before sync',
            cardLast4: tx.cardLast4,
          })

          voidedCount++
          results.push({
            id: tx.localId,
            status: 'voided',
            note: 'Transaction voided - will never be processed',
          })
          continue
        }

        // ========================================
        // 1. DEDUPLICATION CHECK (Idempotency)
        // ========================================
        const existingPayment = await db.payment.findFirst({
          where: {
            OR: [
              { idempotencyKey: tx.idempotencyKey },
              { offlineIntentId: tx.localId },
            ],
          },
        })

        if (existingPayment) {
          // We've already processed this! Skip it but tell the client it's "resolved"
          // Log this for the audit trail - proves we saved the merchant from a double-charge
          await logAuditEntry({
            locationId,
            orderId: tx.orderId,
            paymentId: existingPayment.id,
            terminalId: tx.terminalId,
            terminalName,
            employeeId: tx.employeeId,
            amount: tx.amount,
            idempotencyKey: tx.idempotencyKey,
            localIntentId: tx.localId,
            status: 'DUPLICATE_BLOCKED',
            statusNote: 'Duplicate charge attempt blocked by idempotency engine',
            cardLast4: tx.cardLast4,
          })

          duplicatesBlocked++
          results.push({
            id: tx.localId,
            status: 'duplicate_ignored',
            serverId: existingPayment.id,
            note: 'Payment already processed - duplicate blocked',
          })
          continue
        }

        // ========================================
        // 2. RESOLVE ORDER ID
        // ========================================
        let resolvedOrderId = tx.orderId

        // If we have a local order ID, find the synced order first
        if (tx.localOrderId && !tx.orderId.startsWith('c')) {
          const syncedOrder = await db.order.findFirst({
            where: { offlineLocalId: tx.localOrderId },
          })

          if (syncedOrder) {
            resolvedOrderId = syncedOrder.id
          } else {
            // Order hasn't been synced yet - fail this transaction
            failedSyncs++
            results.push({
              id: tx.localId,
              status: 'failed',
              error: 'Order not synced yet - retry after order sync',
            })
            continue
          }
        }

        // Verify the order exists
        const order = await db.order.findUnique({
          where: { id: resolvedOrderId },
        })

        if (!order) {
          failedSyncs++
          results.push({
            id: tx.localId,
            status: 'failed',
            error: 'Order not found',
          })
          continue
        }

        // ========================================
        // 3. ATOMIC TRANSACTION
        // ========================================
        // Use a database transaction to ensure the payment is logged
        // AND the order is updated simultaneously
        const payment = await db.$transaction(async (prisma) => {
          // Create the payment record
          const newPayment = await prisma.payment.create({
            data: {
              locationId: order.locationId,
              orderId: resolvedOrderId,
              employeeId: tx.employeeId,
              paymentMethod: tx.method === 'card' ? 'credit' : tx.method,
              amount: tx.amount,
              tipAmount: tx.tipAmount || 0,
              totalAmount: tx.amount,
              status: 'completed',
              // Card details
              cardBrand: tx.cardBrand || null,
              cardLast4: tx.cardLast4 || null,
              authCode: tx.authCode || null,
              transactionId: tx.gatewayTransactionId || null,
              // Idempotency & offline tracking
              idempotencyKey: tx.idempotencyKey,
              offlineIntentId: tx.localId,
              isOfflineCapture: true,
              offlineCapturedAt: new Date(tx.timestamp),
              offlineTerminalId: tx.terminalId,
              needsReconciliation: true, // Flag for EOD report
              syncAttempts: 1,
            },
          })

          // Calculate new totals
          const allPayments = await prisma.payment.findMany({
            where: { orderId: resolvedOrderId, status: 'completed' },
          })

          const totalPaid = allPayments.reduce(
            (sum, p) => sum + Number(p.amount),
            0
          )
          const totalTips = allPayments.reduce(
            (sum, p) => sum + Number(p.tipAmount || 0),
            0
          )

          const orderTotal = Number(order.total)
          const remainingBalance = Math.max(0, orderTotal - totalPaid)
          const isFullyPaid = remainingBalance === 0

          // Update the order
          await prisma.order.update({
            where: { id: resolvedOrderId },
            data: {
              tipTotal: totalTips,
              status: isFullyPaid ? 'paid' : order.status,
              paidAt: isFullyPaid ? new Date() : order.paidAt,
            },
          })

          return newPayment
        })

        // Log successful offline sync
        await logAuditEntry({
          locationId,
          orderId: resolvedOrderId,
          paymentId: payment.id,
          terminalId: tx.terminalId,
          terminalName,
          employeeId: tx.employeeId,
          amount: tx.amount,
          idempotencyKey: tx.idempotencyKey,
          localIntentId: tx.localId,
          status: 'OFFLINE_SYNC',
          statusNote: 'Payment captured offline and synced successfully',
          cardLast4: tx.cardLast4,
        })

        successfulSyncs++
        results.push({
          id: tx.localId,
          status: 'synced',
          serverId: payment.id,
        })
      } catch (error) {
        console.error(`Sync failed for tx ${tx.idempotencyKey}:`, error)

        // Log failed sync attempt
        await logAuditEntry({
          locationId,
          orderId: tx.orderId,
          terminalId: tx.terminalId,
          terminalName,
          employeeId: tx.employeeId,
          amount: tx.amount,
          idempotencyKey: tx.idempotencyKey,
          localIntentId: tx.localId,
          status: 'FAILED',
          statusNote: error instanceof Error ? error.message : 'Unknown error',
          cardLast4: tx.cardLast4,
        })

        failedSyncs++
        results.push({
          id: tx.localId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error - retry required',
        })
      }
    }

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: transactions.length,
        synced: successfulSyncs,
        duplicatesBlocked,
        voided: voidedCount,
        failed: failedSyncs,
      },
    })
  } catch (error) {
    console.error('Sync resolution batch failed:', error)
    return NextResponse.json(
      { error: 'Batch sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})

/**
 * GET /api/orders/sync-resolution
 *
 * Get sync audit statistics for the admin dashboard
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const dateStr = searchParams.get('date') // YYYY-MM-DD format

    // Build date filter
    let dateFilter = {}
    if (dateStr) {
      const date = new Date(dateStr)
      const nextDay = new Date(date)
      nextDay.setDate(nextDay.getDate() + 1)
      dateFilter = {
        createdAt: {
          gte: date,
          lt: nextDay,
        },
      }
    } else {
      // Default to today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      dateFilter = {
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      }
    }

    // Get all payments for the period
    const allPayments = await db.payment.findMany({
      where: {
        locationId,
        ...dateFilter,
      },
      select: {
        id: true,
        amount: true,
        isOfflineCapture: true,
        wasDuplicateBlocked: true,
        needsReconciliation: true,
        syncAttempts: true,
        createdAt: true,
      },
    })

    // Calculate statistics
    const totalTransactions = allPayments.length
    const offlineCaptures = allPayments.filter((p) => p.isOfflineCapture).length
    const duplicatesBlocked = allPayments.filter((p) => p.wasDuplicateBlocked).length
    const needingReconciliation = allPayments.filter((p) => p.needsReconciliation).length
    const totalAmount = allPayments.reduce((sum, p) => sum + Number(p.amount), 0)
    const offlineAmount = allPayments
      .filter((p) => p.isOfflineCapture)
      .reduce((sum, p) => sum + Number(p.amount), 0)

    // Get recent offline payments for the audit log
    const recentOfflinePayments = await db.payment.findMany({
      where: {
        locationId,
        isOfflineCapture: true,
        ...dateFilter,
      },
      include: {
        order: {
          select: { id: true, orderNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return NextResponse.json({
      summary: {
        totalTransactions,
        offlineCaptures,
        duplicatesBlocked,
        needingReconciliation,
        totalAmount,
        offlineAmount,
        offlinePercentage: totalTransactions > 0
          ? ((offlineCaptures / totalTransactions) * 100).toFixed(1)
          : '0',
      },
      recentOfflinePayments: recentOfflinePayments.map((p) => ({
        id: p.id,
        orderNumber: p.order?.orderNumber,
        amount: Number(p.amount),
        createdAt: p.createdAt,
        syncAttempts: p.syncAttempts,
        needsReconciliation: p.needsReconciliation,
      })),
    })
  } catch (error) {
    console.error('Failed to get sync audit stats:', error)
    return NextResponse.json(
      { error: 'Failed to get sync statistics' },
      { status: 500 }
    )
  }
})

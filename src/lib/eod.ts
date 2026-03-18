/**
 * Unified End-of-Day (EOD) Reset Engine
 *
 * Single shared function called by both:
 *   - POST /api/eod/reset  (manual, manager-triggered)
 *   - GET  /api/cron/eod-batch-close (automated nightly cron)
 *
 * Handles: tab auto-capture, stale order rollover, orphaned table reset,
 * entertainment cleanup, Datacap batch close, walkout detection, audit logging,
 * and socket notifications.
 */

import { db, adminDb } from '@/lib/db'
import { parseSettings, DEFAULT_EOD_SETTINGS } from '@/lib/settings'
import type { LocationSettings } from '@/lib/settings'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getDatacapClient, requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { detectPotentialWalkouts } from '@/lib/walkout-detector'
import { OrderRepository } from '@/lib/repositories'
import { emitToLocation } from '@/lib/socket-server'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { enableSyncReplication } from '@/lib/db-helpers'
import { calculateCardPrice } from '@/lib/pricing'
import { allocateTipsForPayment } from '@/lib/domain/tips/tip-allocation'
import { processNextDeduction } from '@/lib/deduction-processor'
import {
  dispatchOpenOrdersChanged,
  dispatchFloorPlanUpdate,
  dispatchEntertainmentStatusChanged,
  dispatchTabUpdated,
  dispatchTabStatusUpdate,
  dispatchTabClosed,
  dispatchOrderClosed,
} from '@/lib/socket-dispatch'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { writeFile } from 'fs/promises'

// ─── Public Types ────────────────────────────────────────────────────────────

export interface EodResetOptions {
  locationId: string
  employeeId?: string      // null for cron-triggered
  triggeredBy: 'manual' | 'cron'
  dryRun?: boolean
}

export interface EodResetResult {
  rolledOverOrders: number
  tablesReset: number
  entertainmentReset: number
  entertainmentSessionsCharged: number
  entertainmentTotalCharges: number
  waitlistCancelled: number
  tabsCaptured: number
  tabsCapturedAmount: number
  tabsDeclined: number
  tabsRolledOver: number
  batchCloseSuccess: boolean | null  // null if not attempted
  businessDay: string
  alreadyRanToday: boolean
  warnings: string[]
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function executeEodReset(options: EodResetOptions): Promise<EodResetResult> {
  const { locationId, employeeId, triggeredBy, dryRun = false } = options
  const now = new Date()
  const warnings: string[] = []

  // ── 1. Load location settings ──────────────────────────────────────────────
  const location = await db.location.findFirst({
    where: { id: locationId },
    select: { settings: true },
  })
  const locSettings = parseSettings(location?.settings as Record<string, unknown> | null)
  const eodSettings = locSettings.eod ?? DEFAULT_EOD_SETTINGS
  const dayStartTime = locSettings.businessDay.dayStartTime ?? '04:00'
  const businessDay = getCurrentBusinessDay(dayStartTime)
  const businessDayDate = businessDay.date

  // ── 2. Idempotency check ──────────────────────────────────────────────────
  const auditAction = triggeredBy === 'cron' ? 'eod_auto_batch_close' : 'eod_reset_completed'
  const alreadyRan = await db.auditLog.findFirst({
    where: {
      locationId,
      action: auditAction,
      entityType: 'location',
      entityId: locationId,
      createdAt: { gte: businessDay.start },
    },
    select: { id: true, details: true },
  })

  if (alreadyRan) {
    // Extract previous stats from the audit log details if available
    const prev = alreadyRan.details as Record<string, unknown> | null
    return {
      rolledOverOrders: (prev?.rolledOverOrders as number) ?? (prev?.staleOrdersDetected as number) ?? 0,
      tablesReset: (prev?.tablesReset as number) ?? 0,
      entertainmentReset: (prev?.entertainmentReset as number) ?? 0,
      entertainmentSessionsCharged: (prev?.entertainmentSessionsCharged as number) ?? 0,
      entertainmentTotalCharges: (prev?.entertainmentTotalCharges as number) ?? 0,
      waitlistCancelled: (prev?.waitlistCancelled as number) ?? 0,
      tabsCaptured: (prev?.tabsCaptured as number) ?? 0,
      tabsCapturedAmount: (prev?.tabsCapturedAmount as number) ?? 0,
      tabsDeclined: (prev?.tabsDeclined as number) ?? 0,
      tabsRolledOver: (prev?.tabsRolledOver as number) ?? 0,
      batchCloseSuccess: (prev?.batchCloseSuccess as boolean) ?? null,
      businessDay: businessDayDate,
      alreadyRanToday: true,
      warnings: ['EOD already ran for this business day'],
    }
  }

  // ── 3. Tab auto-capture ────────────────────────────────────────────────────
  let tabsCaptured = 0
  let tabsCapturedAmount = 0
  let tabsDeclined = 0
  let tabsRolledOver = 0

  if (eodSettings.autoCaptureTabs && !dryRun) {
    const autoGratuityPct = eodSettings.autoGratuityPercent ?? 20

    // Find all open bar tabs with authorized cards
    const openTabs = await adminDb.order.findMany({
      where: {
        locationId,
        orderType: 'bar_tab',
        status: 'open',
        deletedAt: null,
        cards: {
          some: {
            status: 'authorized',
            deletedAt: null,
          },
        },
      },
      include: {
        cards: {
          where: { status: 'authorized', deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
        items: {
          where: { deletedAt: null, status: 'active' },
        },
      },
    })

    for (const tab of openTabs) {
      try {
        const card = tab.cards[0]
        if (!card) {
          tabsRolledOver++
          warnings.push(`Tab #${tab.orderNumber} has no authorized cards — rolled over`)
          continue
        }

        // Calculate purchase amount (card price if dual pricing)
        const cashBaseAmount = Number(tab.total) - Number(tab.tipTotal)
        const dualPricing = locSettings.dualPricing
        const purchaseAmount = dualPricing?.enabled
          ? calculateCardPrice(cashBaseAmount, dualPricing.cashDiscountPercent ?? 4.0)
          : cashBaseAmount

        // Zero-amount tab — release pre-auth instead of capturing $0
        if (purchaseAmount <= 0) {
          try {
            const client = await requireDatacapClient(locationId)
            await client.voidSale(card.readerId, { recordNo: card.recordNo })
            await db.$transaction(async (tx) => {
              await tx.orderCard.update({
                where: { id: card.id },
                data: { status: 'released' },
              })
              await tx.order.update({
                where: { id: tab.id },
                data: {
                  status: 'voided',
                  tabStatus: 'closed',
                  paidAt: now,
                  closedAt: now,
                  version: { increment: 1 },
                  lastMutatedBy: 'local',
                },
              })
            })
            tabsCaptured++
            continue
          } catch (releaseErr) {
            tabsRolledOver++
            warnings.push(`Tab #${tab.orderNumber} ($0): pre-auth release failed — ${releaseErr instanceof Error ? releaseErr.message : 'Unknown'}`)
            continue
          }
        }

        // Calculate auto-gratuity
        const gratuityAmount = Math.round(purchaseAmount * (autoGratuityPct / 100) * 100) / 100
        const totalCaptured = purchaseAmount + gratuityAmount

        // Attempt pre-auth capture via Datacap
        await validateReader(card.readerId, locationId)
        const client = await requireDatacapClient(locationId)
        const response = await client.preAuthCapture(card.readerId, {
          recordNo: card.recordNo,
          purchaseAmount,
          gratuityAmount,
        })

        const approved = response.cmdStatus === 'Approved'

        if (!approved) {
          // Capture declined — mark the tab
          await OrderRepository.updateOrder(tab.id, locationId, {
            tabStatus: 'declined_capture',
            captureDeclinedAt: now,
            captureRetryCount: { increment: 1 },
            lastCaptureError: `EOD auto-capture declined: ${response.textResponse || 'Unknown'}`,
          })
          tabsDeclined++
          warnings.push(`Tab #${tab.orderNumber} ($${purchaseAmount.toFixed(2)}): capture declined`)
          continue
        }

        // Capture approved — record payment atomically
        const createdPaymentId = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${tab.id} FOR UPDATE`
          await enableSyncReplication(tx)

          await tx.orderCard.update({
            where: { id: card.id },
            data: {
              status: 'captured',
              capturedAmount: totalCaptured,
              capturedAt: now,
              tipAmount: gratuityAmount,
              lastMutatedBy: 'local',
            },
          })

          await tx.order.update({
            where: { id: tab.id },
            data: {
              status: 'paid',
              tabStatus: 'closed',
              paidAt: now,
              closedAt: now,
              tipTotal: gratuityAmount,
              total: totalCaptured,
              version: { increment: 1 },
              lastMutatedBy: 'local',
            },
          })

          const payment = await tx.payment.create({
            data: {
              locationId,
              orderId: tab.id,
              employeeId: tab.employeeId || employeeId || null,
              amount: purchaseAmount,
              tipAmount: gratuityAmount,
              totalAmount: totalCaptured,
              paymentMethod: card.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
              cardBrand: card.cardType || 'unknown',
              cardLast4: card.cardLast4,
              authCode: response.authCode || null,
              datacapRecordNo: card.recordNo,
              entryMethod: 'Chip',
              status: 'completed',
              lastMutatedBy: 'local',
              acqRefData: response.acqRefData || null,
              processData: response.processData || null,
              aid: response.aid || null,
              cvmResult: response.cvm ? String(response.cvm) : null,
              tokenFrequency: 'Recurring',
            },
          })

          // Void any remaining authorized cards on this tab
          for (const c of tab.cards.filter(c => c.id !== card.id && c.status === 'authorized')) {
            await tx.orderCard.update({
              where: { id: c.id },
              data: { status: 'voided' },
            })
          }

          return payment.id
        })

        tabsCaptured++
        tabsCapturedAmount += totalCaptured

        // Fire-and-forget side effects for each captured tab
        void emitOrderEvent(locationId, tab.id, 'TAB_CLOSED', {
          employeeId: employeeId || null,
          tipCents: Math.round(gratuityAmount * 100),
          adjustedAmountCents: Math.round(totalCaptured * 100),
          eodAutoCapture: true,
        })
        void emitOrderEvent(locationId, tab.id, 'PAYMENT_APPLIED', {
          paymentId: createdPaymentId,
          method: card.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
          amountCents: Math.round(purchaseAmount * 100),
          tipCents: Math.round(gratuityAmount * 100),
          totalCents: Math.round(totalCaptured * 100),
          cardBrand: card.cardType || null,
          cardLast4: card.cardLast4 || null,
          status: 'approved',
          eodAutoCapture: true,
        })
        void emitOrderEvent(locationId, tab.id, 'ORDER_CLOSED', {
          closedStatus: 'paid',
          eodAutoCapture: true,
        })

        // Inventory deduction outbox
        void db.pendingDeduction.upsert({
          where: { orderId: tab.id },
          create: { orderId: tab.id, locationId, status: 'pending', attempts: 0, maxAttempts: 5 },
          update: {},
        }).then(() => processNextDeduction()).catch(console.error)

        // Tip allocation
        if (gratuityAmount > 0 && tab.employeeId) {
          void allocateTipsForPayment({
            locationId,
            orderId: tab.id,
            primaryEmployeeId: tab.employeeId,
            createdPayments: [{ id: createdPaymentId, paymentMethod: card.cardType || 'credit', tipAmount: gratuityAmount }],
            totalTipsDollars: gratuityAmount,
            tipBankSettings: locSettings.tipBank,
            kind: 'auto_gratuity',
          }).catch(err => console.error('[EOD] Tip allocation failed for tab', tab.id, err))
        }

        // Socket dispatches for tab close
        void dispatchTabUpdated(locationId, { orderId: tab.id, status: 'closed' }).catch(() => {})
        dispatchTabStatusUpdate(locationId, { orderId: tab.id, status: 'closed' })
        dispatchTabClosed(locationId, { orderId: tab.id, total: totalCaptured, tipAmount: gratuityAmount })
        void dispatchOrderClosed(locationId, {
          orderId: tab.id,
          status: 'paid',
          closedAt: now.toISOString(),
          closedByEmployeeId: employeeId || null,
          locationId,
        }, { async: true }).catch(() => {})

      } catch (tabErr) {
        tabsRolledOver++
        warnings.push(`Tab #${tab.orderNumber}: capture error — ${tabErr instanceof Error ? tabErr.message : 'Unknown'}`)
      }
    }

    // Notify terminals if any tabs were processed
    if (tabsCaptured > 0 || tabsDeclined > 0) {
      void dispatchOpenOrdersChanged(locationId, { trigger: 'paid' as any }, { async: true }).catch(() => {})
    }
  }

  // ── 4. Roll over stale orders ──────────────────────────────────────────────
  const staleOpenOrders = await db.orderSnapshot.findMany({
    where: {
      locationId,
      status: 'open',
      OR: [
        { businessDayDate: { lt: businessDay.start } },
        { businessDayDate: null, createdAt: { lt: businessDay.start } },
      ],
      deletedAt: null,
    },
    select: {
      id: true,
      orderNumber: true,
      totalCents: true,
      createdAt: true,
    },
  })

  let rolledOverOrders = 0

  if (!dryRun && staleOpenOrders.length > 0) {
    await db.$transaction(async (tx) => {
      for (const order of staleOpenOrders) {
        await tx.auditLog.create({
          data: {
            locationId,
            employeeId: employeeId || null,
            action: 'eod_stale_order_detected',
            entityType: 'order',
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              total: order.totalCents / 100,
              createdAt: order.createdAt.toISOString(),
              message: 'Order open for more than 24 hours detected during EOD reset',
            },
          },
        })
      }

      await tx.order.updateMany({
        where: { id: { in: staleOpenOrders.map((o: any) => o.id) } },
        data: {
          rolledOverAt: now,
          rolledOverFrom: `EOD reset (${triggeredBy})${employeeId ? ` by employee ${employeeId}` : ''}`,
        },
      })
    })

    rolledOverOrders = staleOpenOrders.length

    // Emit ORDER_METADATA_UPDATED for rolled-over orders (fire-and-forget)
    void Promise.all(
      staleOpenOrders.map(o =>
        emitOrderEvent(locationId, o.id, 'ORDER_METADATA_UPDATED', {
          rolledOverAt: now.toISOString(),
          rolledOverFrom: `EOD reset (${triggeredBy})`,
        })
      )
    ).catch(console.error)

    void dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any }, { async: true }).catch(() => {})
  }

  if (staleOpenOrders.length > 0) {
    warnings.push(`${staleOpenOrders.length} stale order(s) detected and rolled over`)
  }

  // ── 5. Reset orphaned tables ───────────────────────────────────────────────
  let tablesReset = 0

  if (!dryRun) {
    const orphanedTables = await db.table.findMany({
      where: {
        locationId,
        status: 'occupied',
        deletedAt: null,
        orders: { none: { status: 'open', deletedAt: null } },
      },
      select: { id: true },
    })

    if (orphanedTables.length > 0) {
      await db.table.updateMany({
        where: { id: { in: orphanedTables.map(t => t.id) } },
        data: { status: 'available' },
      })
      tablesReset = orphanedTables.length
    }
  }

  // ── 6. Clean entertainment ─────────────────────────────────────────────────
  let entertainmentReset = 0
  let entertainmentSessionsCharged = 0
  let entertainmentTotalCharges = 0
  let waitlistCancelled = 0
  let cleanedEntertainmentIds: string[] = []

  if (!dryRun) {
    // 6a. Stop all active entertainment sessions and calculate final charges
    const staleEntertainment = await adminDb.menuItem.findMany({
      where: {
        locationId,
        itemType: 'timed_rental',
        entertainmentStatus: 'in_use',
      },
      select: {
        id: true,
        name: true,
        currentOrderId: true,
        currentOrderItemId: true,
        ratePerMinute: true,
        overtimeEnabled: true,
        overtimeMode: true,
        overtimeMultiplier: true,
        overtimePerMinuteRate: true,
        overtimeFlatFee: true,
        overtimeGraceMinutes: true,
      },
    })

    if (staleEntertainment.length > 0) {
      // For each active session, update the order item's block time expiry to now
      // This ensures charges are calculated up to the current time
      for (const item of staleEntertainment) {
        if (item.currentOrderItemId) {
          try {
            const orderItem = await adminDb.orderItem.findUnique({
              where: { id: item.currentOrderItemId },
              select: {
                id: true,
                blockTimeStartedAt: true,
                blockTimeMinutes: true,
                blockTimeExpiresAt: true,
                price: true,
                itemTotal: true,
              },
            })

            if (orderItem?.blockTimeStartedAt) {
              // Calculate actual minutes used up to now
              const actualMinutes = Math.ceil(
                (now.getTime() - orderItem.blockTimeStartedAt.getTime()) / (1000 * 60)
              )

              // Update the order item to reflect final session end time
              await adminDb.orderItem.update({
                where: { id: orderItem.id },
                data: {
                  blockTimeExpiresAt: now,
                },
              })

              entertainmentSessionsCharged++
              entertainmentTotalCharges += Number(orderItem.itemTotal) || 0
            }
          } catch (itemErr) {
            warnings.push(`Failed to finalize session for ${item.name}: ${itemErr instanceof Error ? itemErr.message : 'Unknown'}`)
          }
        }
      }

      // Reset all entertainment menu items to available
      await adminDb.menuItem.updateMany({
        where: { id: { in: staleEntertainment.map(i => i.id) } },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      })

      // Reset all linked floor plan elements
      for (const item of staleEntertainment) {
        await db.floorPlanElement.updateMany({
          where: { linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
          data: {
            status: 'available',
            currentOrderId: null,
            sessionStartedAt: null,
            sessionExpiresAt: null,
          },
        })
      }

      entertainmentReset = staleEntertainment.length
      cleanedEntertainmentIds = staleEntertainment.map(i => i.id)
    }

    // 6b. Cancel all waiting/notified waitlist entries with EOD note
    const waitlistResult = await db.entertainmentWaitlist.updateMany({
      where: {
        locationId,
        deletedAt: null,
        status: { in: ['waiting', 'notified'] },
      },
      data: {
        status: 'cancelled',
        notes: 'End of day',
      },
    })
    waitlistCancelled = waitlistResult.count

    // Dispatch entertainment socket events + waitlist notifications
    if (cleanedEntertainmentIds.length > 0) {
      void dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
      for (const itemId of cleanedEntertainmentIds) {
        void dispatchEntertainmentStatusChanged(locationId, {
          itemId,
          entertainmentStatus: 'available',
          currentOrderId: null,
          expiresAt: null,
        }, { async: true }).catch(() => {})
        void notifyNextWaitlistEntry(locationId, itemId).catch(() => {})
      }
    }

    // Log entertainment EOD summary
    if (entertainmentReset > 0 || waitlistCancelled > 0) {
      console.log(
        `[EOD] Entertainment cleanup: Stopped ${entertainmentReset} sessions, ` +
        `cancelled ${waitlistCancelled} waitlist entries, ` +
        `$${entertainmentTotalCharges.toFixed(2)} total charges`
      )
    }
  }

  // ── 7. Datacap batch close ─────────────────────────────────────────────────
  let batchCloseSuccess: boolean | null = null

  if (!dryRun && eodSettings.autoBatchClose && locSettings.payments.processor === 'datacap') {
    try {
      const datacapClient = await getDatacapClient(locationId)
      const readers = await db.paymentReader.findMany({
        where: { locationId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      })

      let allSucceeded = true
      for (const reader of readers) {
        try {
          const result = await datacapClient.batchClose(reader.id)
          await db.auditLog.create({
            data: {
              locationId,
              employeeId: employeeId || null,
              action: 'eod_batch_close_success',
              entityType: 'payment_reader',
              entityId: reader.id,
              details: {
                readerName: reader.name,
                batchNo: result.batchNo ?? null,
                batchItemCount: result.batchItemCount ?? null,
                automated: triggeredBy === 'cron',
              },
            },
          })
          console.log(`[EOD] Batch close succeeded for reader ${reader.name} (${reader.id})`)

          // Write last-batch.json for NUC heartbeat reporting (fire-and-forget)
          void writeFile('/opt/gwi-pos/last-batch.json', JSON.stringify({
            batchClosedAt: now.toISOString(),
            batchStatus: 'closed',
            batchItemCount: result.batchItemCount ?? null,
            batchNo: result.batchNo ?? null,
          })).catch(() => {}) // Not on NUC — skip silently
        } catch (readerErr) {
          allSucceeded = false
          await db.auditLog.create({
            data: {
              locationId,
              employeeId: employeeId || null,
              action: 'eod_batch_close_failed',
              entityType: 'payment_reader',
              entityId: reader.id,
              details: {
                readerName: reader.name,
                error: readerErr instanceof Error ? readerErr.message : 'Unknown error',
                automated: triggeredBy === 'cron',
              },
            },
          })
          warnings.push(`Batch close failed for reader ${reader.name}: ${readerErr instanceof Error ? readerErr.message : 'Unknown'}`)
          console.error(`[EOD] Batch close failed for reader ${reader.name}:`, readerErr)
        }
      }
      batchCloseSuccess = allSucceeded
    } catch (err) {
      batchCloseSuccess = false
      warnings.push(`Batch close init failed: ${err instanceof Error ? err.message : 'Unknown'}`)
      console.error('[EOD] Batch close init failed:', err)
    }
  }

  // ── 8. Walkout detection ───────────────────────────────────────────────────
  if (!dryRun) {
    void detectPotentialWalkouts(locationId).catch(err => {
      console.error('[EOD] Walkout detection failed:', err)
    })
  }

  // ── 9. Orphaned offline payment warning ────────────────────────────────────
  if (!dryRun) {
    try {
      const orphanedPaymentSuspects = await OrderRepository.countOrders(
        locationId,
        {
          status: { in: ['open', 'sent', 'in_progress'] },
          updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
          deletedAt: null,
        },
      )
      if (orphanedPaymentSuspects > 0) {
        warnings.push(`${orphanedPaymentSuspects} order(s) may have orphaned offline card payments. Check Datacap batch report.`)
        console.warn(
          `[EOD] WARNING: ${orphanedPaymentSuspects} stale open order(s) found at location ${locationId}. ` +
          `These may have orphaned offline card payments.`
        )
      }
    } catch (err) {
      console.error('[EOD] Orphaned payment check failed:', err)
    }
  }

  // ── 10. Write audit log ────────────────────────────────────────────────────
  const stats: EodResetResult = {
    rolledOverOrders,
    tablesReset,
    entertainmentReset,
    entertainmentSessionsCharged,
    entertainmentTotalCharges: Math.round(entertainmentTotalCharges * 100) / 100,
    waitlistCancelled,
    tabsCaptured,
    tabsCapturedAmount: Math.round(tabsCapturedAmount * 100) / 100,
    tabsDeclined,
    tabsRolledOver,
    batchCloseSuccess,
    businessDay: businessDayDate,
    alreadyRanToday: false,
    warnings,
  }

  if (!dryRun) {
    await db.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId || null,
        action: auditAction,
        entityType: 'location',
        entityId: locationId,
        details: {
          triggeredBy,
          rolledOverOrders: stats.rolledOverOrders,
          tablesReset: stats.tablesReset,
          entertainmentReset: stats.entertainmentReset,
          entertainmentSessionsCharged: stats.entertainmentSessionsCharged,
          entertainmentTotalCharges: stats.entertainmentTotalCharges,
          waitlistCancelled: stats.waitlistCancelled,
          tabsCaptured: stats.tabsCaptured,
          tabsCapturedAmount: stats.tabsCapturedAmount,
          tabsDeclined: stats.tabsDeclined,
          tabsRolledOver: stats.tabsRolledOver,
          batchCloseSuccess: stats.batchCloseSuccess,
          staleOrdersDetected: stats.rolledOverOrders,
          timestamp: now.toISOString(),
        },
      },
    })

    // ── 11. Emit socket event ──────────────────────────────────────────────
    void emitToLocation(locationId, 'eod:reset-complete', {
      rolledOverOrders: stats.rolledOverOrders,
      tablesReset: stats.tablesReset,
      entertainmentReset: stats.entertainmentReset,
      entertainmentSessionsCharged: stats.entertainmentSessionsCharged,
      entertainmentTotalCharges: stats.entertainmentTotalCharges,
      waitlistCancelled: stats.waitlistCancelled,
      tabsCaptured: stats.tabsCaptured,
      tabsCapturedAmount: stats.tabsCapturedAmount,
      tabsDeclined: stats.tabsDeclined,
      tabsRolledOver: stats.tabsRolledOver,
      batchCloseSuccess: stats.batchCloseSuccess,
      businessDay: businessDayDate,
      triggeredBy,
    }).catch(console.error)
  }

  return stats
}

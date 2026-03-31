/**
 * Shared tab-recording logic for open-tab and record-card-auth.
 *
 * Extracts the "record the result" portion of the tab-opening flow:
 *   1. Duplicate check by recordNo
 *   2. Create OrderCard + update Order in a $transaction
 *   3. Emit TAB_OPENED event
 *   4. Dispatch socket events (tab:updated, orders:list-changed)
 *
 * Used by:
 *   - open-tab/route.ts (after Datacap EMVPreAuth succeeds)
 *   - record-card-auth/route.ts (after Android SDK completes card auth)
 */

import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { dispatchTabUpdated, dispatchTabStatusUpdate, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('datacap.record-tab')

export interface RecordTabParams {
  locationId: string
  orderId: string
  readerId: string        // resolved reader ID (or 'android-sdk' for SDK path)
  recordNo: string        // Datacap vault token
  cardType: string        // "VISA", "MASTERCARD", etc
  cardLast4: string       // "4111"
  cardholderName?: string // Already normalized (First Last)
  authAmount: number      // Amount authorized
  authCode?: string       // 6-digit approval code
  tabName?: string        // Fallback tab name if no cardholder name
  tableId?: string | null // For socket dispatch context
  // Datacap metadata for ByRecordNo operations + chargeback defense
  tokenFrequency?: string  // 'OneTime' | 'Recurring'
  acqRefData?: string      // Acquirer reference data
  processData?: string     // Processor routing data
  aid?: string             // EMV Application ID
  cvm?: string             // Cardholder Verification Method
  avsResult?: string       // AVS response code
  refNo?: string           // Reference number from Datacap
}

export interface RecordTabResult {
  orderCardId: string
  tabName: string
  cardType: string
  cardLast4: string
  authAmount: number
  recordNo: string
}

export interface DuplicateTabInfo {
  orderId: string
  tabName: string
  tabNumber: number
  authAmount: number
  brand: string
  last4: string
}

export class DuplicateTabError extends Error {
  public readonly existingTab: DuplicateTabInfo

  constructor(existingTab: DuplicateTabInfo) {
    super(`Card already has an open tab: ${existingTab.tabName}`)
    this.name = 'DuplicateTabError'
    this.existingTab = existingTab
  }
}

/**
 * Record a tab opening after card authorization is complete.
 *
 * Checks for duplicate tabs by recordNo, creates the OrderCard + Order update
 * in a single transaction, and emits all necessary events.
 *
 * @throws DuplicateTabError if the recordNo already has an open tab at this location
 */
export async function recordTab(params: RecordTabParams): Promise<RecordTabResult> {
  const {
    locationId,
    orderId,
    readerId,
    recordNo,
    cardType,
    cardLast4,
    cardholderName,
    authAmount,
    authCode,
    tabName: fallbackTabName,
    tableId,
    tokenFrequency,
    acqRefData,
    processData,
    aid,
    cvm,
    avsResult,
    refNo,
  } = params

  // Resolve the display tab name
  const resolvedTabName = cardholderName || fallbackTabName

  // Duplicate check + create OrderCard + update Order in a single transaction
  // The FOR UPDATE lock on OrderCard prevents two concurrent open-tab requests
  // for the same card from both succeeding (race condition → duplicate tabs).
  const orderCard = await db.$transaction(async (tx) => {
    // Lock any existing OrderCard row for this recordNo to prevent race conditions
    const existingByRecordNo = await tx.$queryRaw<any[]>(
      Prisma.sql`SELECT oc.id, oc."authAmount", oc."cardType", oc."cardLast4",
              o.id AS "orderId", o."tabName", o."orderNumber"
       FROM "OrderCard" oc
       JOIN "Order" o ON o.id = oc."orderId"
       WHERE oc."recordNo" = ${recordNo} AND oc."deletedAt" IS NULL
       AND o.status = 'open' AND o."orderType" = 'bar_tab' AND o."locationId" = ${locationId}
       FOR UPDATE OF oc LIMIT 1`,
    )

    if (existingByRecordNo.length > 0) {
      const existing = existingByRecordNo[0]
      throw new DuplicateTabError({
        orderId: existing.orderId,
        tabName: existing.tabName ?? `Tab #${existing.orderNumber}`,
        tabNumber: existing.orderNumber,
        authAmount: Number(existing.authAmount),
        brand: existing.cardType,
        last4: existing.cardLast4,
      })
    }

    const created = await tx.orderCard.create({
      data: {
        locationId,
        orderId,
        readerId,
        recordNo,
        cardType,
        cardLast4,
        cardholderName,
        authAmount,
        authCode,
        isDefault: true,
        status: 'authorized',
        lastMutatedBy: 'local',
        // Datacap metadata for ByRecordNo operations + chargeback defense
        tokenFrequency: tokenFrequency || 'Recurring',
        acqRefData,
        processData,
        aid,
        cvm,
        avsResult,
        refNo,
      },
    })

    await tx.order.update({
      where: { id: orderId },
      data: {
        tabStatus: 'open',
        tabName: resolvedTabName,
        preAuthId: authCode,
        preAuthAmount: authAmount,
        preAuthLast4: cardLast4,
        preAuthCardBrand: cardType,
        preAuthExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Pre-auths expire in ~24h
        preAuthRecordNo: recordNo,
        preAuthReaderId: readerId,
        lastMutatedBy: 'local',
        version: { increment: 1 },
      },
    })

    return created
  })

  // Emit order event for tab opened (fire-and-forget)
  void emitOrderEvent(locationId, orderId, 'TAB_OPENED', {
    cardLast4,
    preAuthId: authCode || null,
    tabName: resolvedTabName || null,
  })

  // Fire-and-forget socket dispatches for cross-terminal sync
  void dispatchTabUpdated(locationId, {
    orderId,
    status: 'open',
  }).catch(err => log.warn({ err }, 'fire-and-forget failed in datacap.record-tab'))
  dispatchTabStatusUpdate(locationId, { orderId, status: 'open' })
  void dispatchOpenOrdersChanged(locationId, {
    trigger: 'created',
    orderId,
    tableId: tableId || undefined,
  }).catch(err => log.warn({ err }, 'fire-and-forget failed in datacap.record-tab'))

  return {
    orderCardId: orderCard.id,
    tabName: resolvedTabName || `Tab`,
    cardType,
    cardLast4,
    authAmount,
    recordNo,
  }
}

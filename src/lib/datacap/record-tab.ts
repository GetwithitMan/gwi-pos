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

import { db } from '@/lib/db'
import { dispatchTabUpdated, dispatchTabStatusUpdate, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

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

  // Duplicate check: does this recordNo already have an open bar_tab at this location?
  const existingByRecordNo = await db.orderCard.findFirst({
    where: {
      recordNo,
      deletedAt: null,
      order: { status: 'open', orderType: 'bar_tab', locationId },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      order: { select: { id: true, tabName: true, orderNumber: true } },
    },
  })

  if (existingByRecordNo) {
    throw new DuplicateTabError({
      orderId: existingByRecordNo.order.id,
      tabName: existingByRecordNo.order.tabName ?? `Tab #${existingByRecordNo.order.orderNumber}`,
      tabNumber: existingByRecordNo.order.orderNumber,
      authAmount: Number(existingByRecordNo.authAmount),
      brand: existingByRecordNo.cardType,
      last4: existingByRecordNo.cardLast4,
    })
  }

  // Resolve the display tab name
  const resolvedTabName = cardholderName || fallbackTabName

  // Create OrderCard + update Order in a single transaction
  const [orderCard] = await db.$transaction([
    db.orderCard.create({
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
        // Datacap metadata for ByRecordNo operations + chargeback defense
        tokenFrequency: tokenFrequency || 'Recurring',
        acqRefData,
        processData,
        aid,
        cvm,
        avsResult,
        refNo,
      },
    }),
    db.order.update({
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
        version: { increment: 1 },
      },
    }),
  ])

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
  }).catch(() => {})
  dispatchTabStatusUpdate(locationId, { orderId, status: 'open' })
  void dispatchOpenOrdersChanged(locationId, {
    trigger: 'created',
    orderId,
    tableId: tableId || undefined,
  }).catch(() => {})

  return {
    orderCardId: orderCard.id,
    tabName: resolvedTabName || `Tab`,
    cardType,
    cardLast4,
    authAmount,
    recordNo,
  }
}

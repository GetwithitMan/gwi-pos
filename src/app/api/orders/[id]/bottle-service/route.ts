import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { parseSettings } from '@/lib/settings'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { dispatchCFDOrderUpdated } from '@/lib/socket-dispatch/cfd-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('orders.id.bottle-service')

// POST - Open a bottle service tab (with tier selection + deposit pre-auth)
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const { readerId, employeeId, tierId, correlationId } = body
    if (correlationId) log.info({ correlationId, orderId, tierId }, '[BOTTLE-SERVICE] upgrade request received')

    if (!readerId || !employeeId || !tierId) {
      return err('Missing required fields: readerId, employeeId, tierId')
    }

    // Permission check: POS_ACCESS required to open bottle service tabs
    // Resolve locationId first for permission check
    let bottleCheckLocationId = getRequestLocationId()
    if (!bottleCheckLocationId) {
      const bottleOrderCheck = await db.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { locationId: true },
      })
      if (!bottleOrderCheck) {
        return notFound('Order not found')
      }
      bottleCheckLocationId = bottleOrderCheck.locationId
    }
    const bottleAuth = await requirePermission(employeeId, bottleCheckLocationId, PERMISSIONS.POS_ACCESS)
    if (!bottleAuth.authorized) return err(bottleAuth.error, bottleAuth.status)

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let orderLocationId = getRequestLocationId()
    if (!orderLocationId) {
      // Bootstrap: lightweight fetch for locationId, then tenant-safe fetch with include
      const orderCheck = await db.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return notFound('Order not found')
      }
      orderLocationId = orderCheck.locationId
    }

    // Get order with location settings
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, orderLocationId, {
      location: { select: { id: true, settings: true } },
    })

    if (!order) {
      return notFound('Order not found')
    }

    // Idempotency: if already bottle service, return existing state
    if (order.isBottleService === true) {
      return ok({
          approved: true,
          tabStatus: order.tabStatus,
          isBottleService: true,
          alreadyActive: true,
        })
    }

    // Get tier
    const tier = await db.bottleServiceTier.findFirst({
      where: { id: tierId, locationId: order.locationId, deletedAt: null, isActive: true },
    })

    if (!tier) {
      return notFound('Bottle service tier not found or inactive')
    }

    const locationId = order.locationId
    const depositAmount = Number(tier.depositAmount)

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    // Step 1: Set tab status to pending_auth
    await OrderRepository.updateOrder(orderId, locationId, { tabStatus: 'pending_auth' })

    // Step 2: CollectCardData to read chip
    let cardholderName: string | undefined
    let cardType: string | undefined
    let cardLast4: string | undefined

    try {
      const collectResponse = await client.collectCardData(readerId, {})
      const collectOk = collectResponse.cmdStatus === 'Success' || collectResponse.cmdStatus === 'Approved'
      if (collectOk) {
        cardholderName = collectResponse.cardholderName || undefined
        cardType = collectResponse.cardType || undefined
        cardLast4 = collectResponse.cardLast4 || undefined
      }
    } catch (err) {
      console.warn('[Bottle Service] CollectCardData failed, continuing with PreAuth:', err)
    }

    // Step 3: EMVPreAuth for deposit amount
    const preAuthResponse = await client.preAuth(readerId, {
      invoiceNo: orderId,
      amount: depositAmount,
      requestRecordNo: true,
    })

    const preAuthError = parseError(preAuthResponse)
    const approved = preAuthResponse.cmdStatus === 'Approved'

    if (!approved) {
      await OrderRepository.updateOrder(orderId, locationId, {
        tabStatus: 'no_card',
        tabName: cardholderName || order.tabName,
      })

      return ok({
          approved: false,
          tabStatus: 'no_card',
          cardholderName,
          cardType: cardType || preAuthResponse.cardType,
          cardLast4: cardLast4 || preAuthResponse.cardLast4,
          error: preAuthError
            ? { code: preAuthError.code, message: preAuthError.text, isRetryable: preAuthError.isRetryable }
            : { code: 'DECLINED', message: 'Deposit pre-authorization declined', isRetryable: true },
        })
    }

    // Step 4: Approved — set up bottle service tab
    const finalCardholderName = cardholderName || preAuthResponse.cardholderName || undefined
    const finalCardType = cardType || preAuthResponse.cardType || 'unknown'
    const finalCardLast4 = cardLast4 || preAuthResponse.cardLast4 || '????'
    const recordNo = preAuthResponse.recordNo

    if (!recordNo) {
      console.error('[Bottle Service] PreAuth approved but no RecordNo returned')
      return err('Pre-auth approved but no RecordNo token received', 500)
    }

    // Create OrderCard + update Order in a transaction
    const orderCard = await db.$transaction(async (tx) => {
      const card = await tx.orderCard.create({
        data: {
          locationId,
          orderId,
          readerId,
          recordNo,
          cardType: finalCardType,
          cardLast4: finalCardLast4,
          cardholderName: finalCardholderName,
          authAmount: depositAmount,
          isDefault: true,
          status: 'authorized',
          lastMutatedBy: 'local',
        },
      })
      await OrderRepository.updateOrder(orderId, locationId, {
        tabStatus: 'open',
        tabName: finalCardholderName || order.tabName,
        isBottleService: true,
        bottleServiceTierId: tierId,
        bottleServiceDeposit: depositAmount,
        bottleServiceMinSpend: Number(tier.minimumSpend),
        bottleServiceCurrentSpend: Number(order.subtotal) || 0,
        preAuthId: preAuthResponse.authCode,
        preAuthAmount: depositAmount,
        preAuthLast4: finalCardLast4,
        preAuthCardBrand: finalCardType,
        preAuthRecordNo: recordNo,
        preAuthReaderId: readerId,
      }, tx)
      return card
    })

    // Fire-and-forget: emit order event for event-sourced sync
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      isBottleService: true,
      tierId,
      depositAmount,
      minimumSpend: Number(tier.minimumSpend),
      preAuthId: preAuthResponse.authCode,
      cardLast4: finalCardLast4,
      cardType: finalCardType,
      tabName: finalCardholderName || order.tabName,
    })

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderUpdated(order.locationId, {
      orderId,
      changes: ['bottle-service', 'tabStatus'],
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.bottle-service'))

    const cfdOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      items: { include: { modifiers: true } },
      discounts: true,
    })
    if (cfdOrder) {
      dispatchCFDOrderUpdated(order.locationId, {
        orderId: cfdOrder.id,
        orderNumber: cfdOrder.orderNumber,
        items: cfdOrder.items
          .filter(i => i.status === 'active')
          .map(i => ({
            name: i.name,
            quantity: i.quantity,
            price: Number(i.itemTotal),
            modifiers: i.modifiers.map(m => m.name),
            status: i.status,
          })),
        subtotal: Number(cfdOrder.subtotal),
        tax: Number(cfdOrder.taxTotal),
        total: Number(cfdOrder.total),
        discountTotal: Number(cfdOrder.discountTotal),
        taxFromInclusive: Number(cfdOrder.taxFromInclusive ?? 0),
        taxFromExclusive: Number(cfdOrder.taxFromExclusive ?? 0),
      })
    }

    pushUpstream()

    return ok({
        approved: true,
        tabStatus: 'open',
        isBottleService: true,
        tier: {
          id: tier.id,
          name: tier.name,
          color: tier.color,
          depositAmount,
          minimumSpend: Number(tier.minimumSpend),
          autoGratuityPercent: tier.autoGratuityPercent ? Number(tier.autoGratuityPercent) : null,
        },
        cardholderName: finalCardholderName,
        cardType: finalCardType,
        cardLast4: finalCardLast4,
        authAmount: depositAmount,
        recordNo,
        orderCardId: orderCard.id,
      })
  } catch (error) {
    console.error('Failed to open bottle service tab:', error)
    return err('Failed to open bottle service tab', 500)
  }
})

// GET - Get bottle service status for an order (spend progress, alerts)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let getLocationId = getRequestLocationId()
    if (!getLocationId) {
      // Bootstrap: lightweight fetch for locationId + bottle service check
      const getCheck = await db.order.findFirst({
        where: { id: orderId, deletedAt: null, isBottleService: true },
        select: { id: true, locationId: true },
      })

      if (!getCheck) {
        return notFound('Bottle service order not found')
      }
      getLocationId = getCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, getLocationId, {
      location: { select: { settings: true } },
      cards: {
        where: { deletedAt: null },
        orderBy: { isDefault: 'desc' },
      },
    })

    if (!order) {
      return notFound('Bottle service order not found')
    }

    const settings = parseSettings(order.location.settings)
    const currentSpend = order.bottleServiceCurrentSpend != null ? Number(order.bottleServiceCurrentSpend) : Number(order.subtotal)
    const depositAmount = Number(order.bottleServiceDeposit) || 0
    const minimumSpend = Number(order.bottleServiceMinSpend) || 0
    const totalAuth = order.cards.reduce((sum, c) => sum + Number(c.authAmount), 0)

    // Calculate spend progress
    const spendProgress = minimumSpend > 0 ? Math.min((currentSpend / minimumSpend) * 100, 100) : 100
    const minimumMet = currentSpend >= minimumSpend
    const remainingToMinimum = Math.max(minimumSpend - currentSpend, 0)

    // Check if re-auth alert is needed (spend approaching deposit amount)
    const reAuthNeeded = settings.payments.bottleServiceReAuthAlertEnabled &&
      depositAmount > 0 && currentSpend >= depositAmount * 0.8

    // Check if a previous increment auth was declined (persisted flag)
    const incrementAuthFailed = order.incrementAuthFailed ?? false

    // Auto-gratuity
    let autoGratuityPercent = settings.payments.bottleServiceAutoGratuityPercent
    if (order.bottleServiceTierId) {
      const tier = await db.bottleServiceTier.findFirst({
        where: { id: order.bottleServiceTierId, deletedAt: null },
      })
      if (tier?.autoGratuityPercent) {
        autoGratuityPercent = Number(tier.autoGratuityPercent)
      }
    }

    return ok({
        orderId,
        isBottleService: true,
        tierId: order.bottleServiceTierId,
        depositAmount,
        minimumSpend,
        currentSpend,
        spendProgress: Math.round(spendProgress),
        minimumMet,
        remainingToMinimum,
        totalAuthorized: totalAuth,
        reAuthNeeded,
        incrementAuthFailed,
        autoGratuityPercent,
        cards: order.cards.map(c => ({
          id: c.id,
          cardType: c.cardType,
          cardLast4: c.cardLast4,
          authAmount: Number(c.authAmount),
          isDefault: c.isDefault,
          status: c.status,
        })),
      })
  } catch (error) {
    console.error('Failed to get bottle service status:', error)
    return err('Failed to get bottle service status', 500)
  }
})

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { generateFakeTransactionId, calculatePreAuthExpiration } from '@/lib/payment'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { TabUpdatedPayload, OrdersListChangedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import type { OrderStatus } from '@/generated/prisma/client'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// ── Zod schema for POST /api/tabs ───────────────────────────────────
const CreateTabSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  tabName: z.string().max(100).optional(),
  locationId: z.string().min(1).optional(),
  preAuth: z.object({
    cardBrand: z.string().min(1),
    cardLast4: z.string().regex(/^\d{4}$/, 'Card last 4 must be exactly 4 digits'),
    amount: z.number().positive().optional(),
  }).optional(),
}).passthrough()

// GET - List open tabs with pagination
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const employeeId = searchParams.get('employeeId')
    const status = (searchParams.get('status') || 'open') as OrderStatus | 'all'
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

    // Auth check: resolve actor from query param or session, then validate
    const actorId = employeeId || (await getActorFromRequest(request)).employeeId
    if (actorId) {
      // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
      let tabsLocationId = getRequestLocationId()
      if (!tabsLocationId) {
        const actor = await db.employee.findUnique({ where: { id: actorId, deletedAt: null }, select: { locationId: true } })
        tabsLocationId = actor?.locationId
      }
      if (tabsLocationId) {
        const auth = await requirePermission(actorId, tabsLocationId, PERMISSIONS.POS_ACCESS)
        if (!auth.authorized) {
          return err(auth.error, auth.status)
        }
      }
    }

    // TODO: Phase 2 — extract into OrderRepository once a findTabs method with pagination,
    // cards, and custom includes is available. Current query requires locationId filtering.
    const where = {
      orderType: 'bar_tab' as const,
      ...(status !== 'all' ? { status } : {}),
      ...(employeeId ? { employeeId } : {}),
    }

    const tabs = await db.order.findMany({
      where,
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: { where: { deletedAt: null } },
            ingredientModifications: true,
          },
        },
        payments: true,
        cards: {
          where: { deletedAt: null },
          select: {
            id: true,
            cardType: true,
            cardLast4: true,
            cardholderName: true,
            isDefault: true,
            status: true,
            authAmount: true,
            recordNo: true,
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { openedAt: 'desc' },
      skip: offset,
      take: limit,
    })

    return ok({
      tabs: tabs.map(tab => {
        const tabAny = tab as typeof tab & {
          tabStatus?: string | null
          tabNickname?: string | null
          isBottleService?: boolean
          bottleServiceTierName?: string | null
          bottleServiceTierColor?: string | null
        }
        return {
          id: tab.id,
          tabName: tab.tabName,
          tabNickname: tabAny.tabNickname ?? null,
          tabStatus: tabAny.tabStatus ?? null,
          orderNumber: tab.orderNumber,
          status: tab.status,
          isBottleService: tabAny.isBottleService ?? false,
          bottleServiceTierName: tabAny.bottleServiceTierName ?? null,
          bottleServiceTierColor: tabAny.bottleServiceTierColor ?? null,
          employee: {
            id: tab.employee.id,
            name: tab.employee.displayName || `${tab.employee.firstName} ${tab.employee.lastName}`,
          },
          itemCount: tab.items.reduce((sum, item) => sum + item.quantity, 0),
          items: tab.items
            .filter(item => !item.deletedAt)
            .map(item => ({
              id: item.id,
              menuItemId: item.menuItemId,
              name: item.name,
              price: Number(item.price),
              quantity: item.quantity,
              sentToKitchen: item.kitchenStatus !== 'pending',
              specialNotes: item.specialNotes,
              isHeld: item.isHeld,
              isCompleted: item.isCompleted,
              seatNumber: item.seatNumber,
              courseNumber: item.courseNumber,
              courseStatus: item.courseStatus,
              resendCount: item.resendCount,
              createdAt: item.createdAt?.toISOString(),
              modifiers: item.modifiers
                .filter((m: { deletedAt: Date | null }) => !m.deletedAt)
                .map((m: { id: string; name: string; price: unknown; preModifier: string | null; depth: number | null }) => ({
                  id: m.id,
                  name: m.name,
                  price: Number(m.price),
                  preModifier: m.preModifier,
                  depth: m.depth || 0,
                })),
            })),
          subtotal: Number(tab.subtotal),
          taxTotal: Number(tab.taxTotal),
          total: Number(tab.total),
          // OrderCard records (source of truth for Datacap pre-auths)
          cards: tab.cards.map(c => ({
            id: c.id,
            cardType: c.cardType,
            cardLast4: c.cardLast4,
            cardholderName: c.cardholderName,
            isDefault: c.isDefault,
            status: c.status,
            authAmount: Number(c.authAmount),
            recordNo: c.recordNo,
          })),
          // Legacy pre-auth info kept for backward compat
          hasPreAuth: tab.cards.length > 0 || !!tab.preAuthId,
          preAuth: tab.cards.length > 0 ? {
            cardBrand: tab.cards[0].cardType,
            last4: tab.cards[0].cardLast4,
            amount: Number(tab.cards[0].authAmount),
            expiresAt: null,
          } : tab.preAuthId ? {
            cardBrand: tab.preAuthCardBrand,
            last4: tab.preAuthLast4,
            amount: tab.preAuthAmount ? Number(tab.preAuthAmount) : null,
            expiresAt: tab.preAuthExpiresAt?.toISOString(),
          } : null,
          openedAt: tab.openedAt.toISOString(),
          paidAmount: tab.payments
            .filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + Number(p.totalAmount), 0),
        }
      }),
    })
  } catch (error) {
    console.error('Failed to fetch tabs:', error)
    return err('Failed to fetch tabs', 500)
  }
})

// POST - Create new tab
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const parseResult = CreateTabSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    const {
      employeeId,
      tabName,
      preAuth,
    } = body

    const locationId = body.locationId

    // Run employee lookup + last order number in parallel
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: { location: true },
    })

    if (!employee) {
      return notFound('Employee not found')
    }

    const resolvedLocationId = locationId || employee.locationId
    const settings = parseSettings(employee.location.settings)

    // Auth check
    const auth = await requirePermission(employeeId, resolvedLocationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Create pre-auth data if provided
    let preAuthData = {}
    if (preAuth && preAuth.cardLast4) {
      if (!/^\d{4}$/.test(preAuth.cardLast4)) {
        return err('Invalid card last 4 digits')
      }

      // Enforce minimum pre-auth amount if configured
      const resolvedPreAuthAmount = preAuth.amount || settings.payments.defaultPreAuthAmount
      const minPreAuth = settings.payments.minPreAuthAmount ?? 0
      if (minPreAuth > 0 && resolvedPreAuthAmount < minPreAuth) {
        return err(`Pre-auth amount ($${resolvedPreAuthAmount}) is below the minimum required ($${minPreAuth})`)
      }

      preAuthData = {
        preAuthId: generateFakeTransactionId(),
        preAuthAmount: resolvedPreAuthAmount,
        preAuthLast4: preAuth.cardLast4,
        preAuthCardBrand: preAuth.cardBrand || 'visa',
        preAuthExpiresAt: calculatePreAuthExpiration(settings.payments.preAuthExpirationDays),
      }
    }

    // Create the tab atomically with order number lock + socket outbox in one transaction
    // TODO: Phase 2 — extract order creation into OrderRepository.createOrder() with number lock
    const tab = await db.$transaction(async (tx) => {
      // Lock latest order row to prevent duplicate order numbers
      const lastOrderRows = await tx.$queryRaw<{ orderNumber: number }[]>`
        SELECT "orderNumber" FROM "Order" WHERE "locationId" = ${resolvedLocationId} AND "createdAt" >= ${today} AND "createdAt" < ${tomorrow} ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE
      `
      const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

      // TX-KEEP: CREATE — bar tab order with pre-auth data inside order-number lock; no repo create method
      const created = await tx.order.create({
        data: {
          locationId: resolvedLocationId,
          employeeId,
          orderNumber,
          orderType: 'bar_tab',
          tabName: tabName || null,
          status: 'open',
          guestCount: 1,
          ...preAuthData,
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
        },
      })

      // Queue critical socket events inside the transaction (outbox pattern)
      const tabPayload: TabUpdatedPayload = { orderId: created.id, status: 'open' }
      await queueSocketEvent(tx, resolvedLocationId, SOCKET_EVENTS.TAB_UPDATED, tabPayload)

      const listPayload: OrdersListChangedPayload = {
        trigger: 'created',
        orderId: created.id,
        orderNumber: created.orderNumber,
        status: 'open',
      }
      await queueSocketEvent(tx, resolvedLocationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)

      return created
    })

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    flushOutboxSafe(resolvedLocationId)
    pushUpstream()

    // Emit order events for event-sourced log (fire-and-forget, non-critical)
    void emitOrderEvent(resolvedLocationId, tab.id, 'ORDER_CREATED', {
      locationId: resolvedLocationId,
      employeeId,
      orderType: 'bar_tab',
      guestCount: 1,
      orderNumber: tab.orderNumber,
      tabName: tab.tabName || null,
    })
    if (preAuth && preAuth.cardLast4 && tab.preAuthId) {
      void emitOrderEvent(resolvedLocationId, tab.id, 'TAB_OPENED', {
        cardLast4: preAuth.cardLast4,
        preAuthId: tab.preAuthId,
        tabName: tab.tabName || null,
      })
    }

    return ok({
      id: tab.id,
      tabName: tab.tabName || `Tab #${tab.orderNumber}`,
      orderNumber: tab.orderNumber,
      status: tab.status,
      employee: {
        id: tab.employee.id,
        name: tab.employee.displayName || `${tab.employee.firstName} ${tab.employee.lastName}`,
      },
      hasPreAuth: !!tab.preAuthId,
      preAuth: tab.preAuthId ? {
        cardBrand: tab.preAuthCardBrand,
        last4: tab.preAuthLast4,
        amount: tab.preAuthAmount ? Number(tab.preAuthAmount) : null,
        expiresAt: tab.preAuthExpiresAt?.toISOString(),
      } : null,
      openedAt: tab.openedAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create tab:', error)
    return err('Failed to create tab', 500)
  }
})

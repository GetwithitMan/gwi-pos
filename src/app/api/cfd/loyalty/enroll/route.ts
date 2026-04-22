/**
 * POST /api/cfd/loyalty/enroll
 *
 * CFD-authenticated loyalty phone-entry endpoint.
 *
 * Flow (from the Android CFD's phone-entry screen):
 *   1. CFD collects phone (and optionally name) and POSTs here with its
 *      device-token Bearer (same token used by all other Bearer-authed CFD
 *      routes — mirrors `authenticateTerminal` from `src/lib/terminal-auth.ts`).
 *   2. Server normalizes the phone, looks up a Customer in the paired venue.
 *   3. If matched — attach to order in a single transaction, emit
 *      ORDER_UPDATED via the socket outbox, return the customer snapshot.
 *   4. If not matched AND no firstName — return `promptForName: true` so the
 *      CFD can re-prompt without creating a phantom customer.
 *   5. If not matched AND firstName provided — create + attach atomically in
 *      a single transaction, emit ORDER_UPDATED, return the new customer.
 *
 * Guard-rails:
 *   - Paired-venue check (the Terminal.locationId MUST match the order's
 *     locationId — prevents a paired CFD from mutating a different venue's
 *     order even if it guesses the orderId).
 *   - Order status must not be closed/paid/voided/completed.
 *   - Loyalty enablement gate: if `location.settings.loyalty.enabled === false`,
 *     the endpoint rejects with 403 `loyalty_disabled`. The CFD also gates
 *     client-side, but the server never trusts the client for this.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { authenticateTerminal } from '@/lib/terminal-auth'
import { normalizePhone } from '@/lib/utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { dispatchCFDOrderUpdated } from '@/lib/socket-dispatch/cfd-dispatch'
import { calculateOrderTotals, type OrderItemForCalculation } from '@/lib/order-calculations'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
import type { CFDLoyaltyCustomer } from '@/types/multi-surface'

const log = createChildLogger('cfd-loyalty-enroll')

const EnrollSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
  phone: z.string().min(1, 'phone is required'),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
}).passthrough()

const CLOSED_STATUSES = new Set(['closed', 'paid', 'voided', 'completed'])

function toLoyaltyCustomer(row: {
  id: string
  firstName: string
  lastName: string | null
  phone: string | null
  loyaltyPoints: number
  loyaltyTier?: { name: string } | null
}): CFDLoyaltyCustomer & { phone: string } {
  const ln = row.lastName?.trim() ?? ''
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: ln.length > 0 ? ln : null,
    phone: row.phone ?? '',
    loyaltyPoints: row.loyaltyPoints,
    tier: row.loyaltyTier?.name ?? null,
  }
}

export const POST = withVenue(async function POST(request: NextRequest) {
  // 1. CFD auth — Bearer device-token (or cellular/session JWT fallback).
  //    Mirrors the exact scheme used by other Bearer-authed routes on this box.
  const authResult = await authenticateTerminal(request)
  if ('error' in authResult && authResult.error) {
    return authResult.error
  }
  const callerTerminal = authResult.terminal!

  // 2. Body validation
  let parsed
  try {
    const rawBody = await request.json()
    parsed = EnrollSchema.safeParse(rawBody)
  } catch {
    return err('Invalid JSON body')
  }
  if (!parsed.success) {
    return err(
      `Validation failed: ${parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
    )
  }
  const { orderId, phone, firstName, lastName, email } = parsed.data

  // 3. Phone normalization (same helper the match-by-phone route uses).
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    return err('phone_format_invalid')
  }

  // 4. Load the order scoped to the caller's paired venue. Using a
  // locationId-scoped lookup via OrderRepository (rather than a bare
  // `db.order.findFirst`) satisfies the `no-restricted-syntax` lint
  // guard AND folds the paired-venue check into the query itself —
  // an order at a different location appears identically to a missing
  // order, which deliberately prevents cross-venue existence leaks.
  const locationId = callerTerminal.locationId
  const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
    location: true,
  })
  if (!order) {
    return notFound('Order not found')
  }

  // 5. Status guard — never enroll against a finalized order.
  if (CLOSED_STATUSES.has(order.status)) {
    return err('order_not_mutable', 409)
  }

  // 6. Loyalty gate — server-side authoritative.
  const settings = parseSettings(order.location.settings)
  if (!settings.loyalty.enabled) {
    return forbidden('loyalty_disabled')
  }

  // 7. Lookup by phone — prefer exact normalized match, fall back to raw.
  const phoneTrimmed = phone.trim()
  const existingRows = await db.customer.findMany({
    where: {
      locationId,
      isActive: true,
      deletedAt: null,
      OR: [
        { phone: normalizedPhone },
        ...(phoneTrimmed !== normalizedPhone ? [{ phone: phoneTrimmed }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      loyaltyPoints: true,
      loyaltyTier: { select: { name: true } },
    },
  })
  const existing = existingRows[0] ?? null

  // ── Branch 1: matched — attach in a single transaction ──────────────
  if (existing) {
    await db.$transaction(async (tx) => {
      await OrderRepository.updateOrder(
        orderId,
        locationId,
        { customerId: existing.id },
        tx,
      )
      const updatedPayload: OrderUpdatedPayload = {
        orderId,
        changes: ['customer'],
      }
      await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_UPDATED, updatedPayload)
    })

    flushOutboxSafe(locationId)
    pushUpstream()

    // Event-sourced order rule: every Order mutation must emit an event.
    void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
      customerId: existing.id,
    }).catch(e => log.warn({ err: e }, 'ORDER_METADATA_UPDATED emit failed'))

    // Refresh CFDs in the location with the new loyalty snapshot so the
    // display immediately reflects the attached customer + points.
    void refreshCFD(orderId, locationId, existing.id).catch(e =>
      log.warn({ err: e }, 'CFD refresh after attach failed'))

    const customer = toLoyaltyCustomer(existing)
    return ok({
      matched: true,
      created: false,
      customer,
    })
  }

  // ── Branch 2: no match AND no firstName — prompt the CFD for name ───
  const firstNameTrimmed = firstName?.trim()
  if (!firstNameTrimmed) {
    return ok({
      matched: false,
      created: false,
      promptForName: true,
    })
  }

  // ── Branch 3: no match AND firstName provided — create + attach atomically ─
  const lastNameTrimmed = lastName?.trim() || null
  const emailTrimmed = (email && email.length > 0) ? email.trim() : null

  // Duplicate-email guard (phone was already looked up above; idempotency
  // against concurrent enrolls for the same phone is enforced by the single
  // transaction + unique lookup — a racing insert would violate a uniqueness
  // invariant that doesn't exist here, but a second enroll would simply match
  // the just-created row and branch to the matched path on retry).
  if (emailTrimmed) {
    const emailDup = await db.customer.findFirst({
      where: { locationId, email: emailTrimmed, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (emailDup) {
      return err('email_already_exists', 409)
    }
  }

  const welcomeBonus = (settings.loyalty.enabled && settings.loyalty.welcomeBonus > 0)
    ? settings.loyalty.welcomeBonus
    : 0

  const created = await db.$transaction(async (tx) => {
    const c = await tx.customer.create({
      data: {
        locationId,
        firstName: firstNameTrimmed,
        lastName: lastNameTrimmed ?? '',
        email: emailTrimmed,
        phone: normalizedPhone,
        tags: [],
        marketingOptIn: false,
        ...(welcomeBonus > 0 ? { loyaltyPoints: welcomeBonus } : {}),
        lastMutatedBy: 'local',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        loyaltyPoints: true,
        loyaltyTier: { select: { name: true } },
      },
    })

    await OrderRepository.updateOrder(orderId, locationId, { customerId: c.id }, tx)

    const updatedPayload: OrderUpdatedPayload = { orderId, changes: ['customer'] }
    await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_UPDATED, updatedPayload)

    return c
  })

  flushOutboxSafe(locationId)
  void notifyDataChanged({
    locationId,
    domain: 'customers',
    action: 'created',
    entityId: created.id,
  })
  pushUpstream()

  // Event-sourced order rule: every Order mutation must emit an event.
  void emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', {
    customerId: created.id,
  }).catch(e => log.warn({ err: e }, 'ORDER_METADATA_UPDATED emit failed'))

  void refreshCFD(orderId, locationId, created.id).catch(e =>
    log.warn({ err: e }, 'CFD refresh after create+attach failed'))

  const customer = toLoyaltyCustomer(created)
  return ok({
    matched: false,
    created: true,
    customer,
  })
})

/**
 * After a successful attach (matched or created), push a cfd:order-updated
 * event carrying the fresh loyalty snapshot. CFDs in the room refresh their
 * display immediately without waiting for a subsequent show-order.
 */
async function refreshCFD(
  orderId: string,
  locationId: string,
  customerId: string,
): Promise<void> {
  const orderWithItems = await OrderRepository.getOrderByIdWithInclude(
    orderId,
    locationId,
    {
      items: { where: { deletedAt: null, status: 'active' } },
      discounts: { where: { deletedAt: null } },
      location: { select: { settings: true } },
    },
  )
  if (!orderWithItems) return

  const settings = parseSettings(orderWithItems.location.settings)
  const itemsForCalc: OrderItemForCalculation[] = orderWithItems.items.map(i => ({
    price: Number(i.price),
    quantity: i.quantity,
    isTaxExempt: false,
    itemDiscounts: [],
  }))
  const discountTotal = orderWithItems.discounts.reduce(
    (sum, d) => sum + Number(d.amount),
    0,
  )
  const totals = calculateOrderTotals(
    itemsForCalc,
    { tax: settings.tax ?? undefined },
    discountTotal,
    Number(orderWithItems.tipTotal ?? 0),
  )

  const customer = await db.customer.findFirst({
    where: { id: customerId, locationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      loyaltyPoints: true,
      loyaltyTier: { select: { name: true } },
    },
  })

  dispatchCFDOrderUpdated(locationId, {
    orderId,
    orderNumber: orderWithItems.orderNumber,
    items: orderWithItems.items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      price: Number(i.price),
      modifiers: [],
    })),
    subtotal: totals.subtotal,
    tax: totals.taxTotal,
    total: totals.total,
    discountTotal,
    customer: customer
      ? {
          id: customer.id,
          firstName: customer.firstName,
          lastName: (customer.lastName?.trim() ?? '').length > 0 ? customer.lastName!.trim() : null,
          loyaltyPoints: customer.loyaltyPoints,
          tier: customer.loyaltyTier?.name ?? null,
        }
      : null,
    loyaltyEnabled: settings.loyalty.enabled === true,
  })
}

/**
 * Resolve the loyalty snapshot for a CFD order-display event.
 *
 * When `location.settings.loyalty.enabled === false`, customer is stripped to
 * null and `loyaltyEnabled` is false — disabled loyalty never leaks customer
 * data or points to the customer-facing display.
 *
 * When loyalty is enabled AND the order has a linked customer, returns the
 * minimal shape the CFD renders: id/firstName/lastName/loyaltyPoints/tier.
 */

import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { parseSettings } from '@/lib/settings'
import type { CFDLoyaltyCustomer } from '@/types/multi-surface'

export interface CFDLoyaltySnapshot {
  customer: CFDLoyaltyCustomer | null
  loyaltyEnabled: boolean
}

export async function loadCfdLoyaltySnapshot(
  orderId: string,
  locationId: string,
): Promise<CFDLoyaltySnapshot> {
  try {
    const order = await OrderRepository.getOrderByIdWithSelect(
      orderId,
      locationId,
      {
        customerId: true,
        location: { select: { settings: true } },
      },
    )
    if (!order) return { customer: null, loyaltyEnabled: false }

    const settings = parseSettings(order.location.settings)
    const loyaltyEnabled = settings.loyalty.enabled === true

    // If loyalty is disabled, strip the customer — do not leak to the CFD.
    if (!loyaltyEnabled) return { customer: null, loyaltyEnabled: false }

    if (!order.customerId) return { customer: null, loyaltyEnabled: true }

    const customer = await db.customer.findFirst({
      where: { id: order.customerId, locationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        loyaltyPoints: true,
        loyaltyTier: { select: { name: true } },
      },
    })
    if (!customer) return { customer: null, loyaltyEnabled: true }

    const ln = customer.lastName?.trim() ?? ''
    return {
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: ln.length > 0 ? ln : null,
        loyaltyPoints: customer.loyaltyPoints,
        tier: customer.loyaltyTier?.name ?? null,
      },
      loyaltyEnabled: true,
    }
  } catch {
    // Fail-safe: never let a snapshot failure break CFD dispatch
    return { customer: null, loyaltyEnabled: false }
  }
}

/**
 * Customer Upsert for Online Ordering
 *
 * Conservative matching strategy:
 * 1. Exact phone match (preferred)
 * 2. Exact email fallback
 * 3. Conflict detection — if identifiers resolve to different customers, don't merge
 * 4. Never merge silently — ambiguous matches create new records with structured logging
 */

import type { PrismaClient, Customer } from '@/generated/prisma/client'

interface OnlineCustomerData {
  phone?: string
  email?: string
  name: string
  locationId: string
}

export async function upsertOnlineCustomer(
  db: PrismaClient,
  data: OnlineCustomerData
): Promise<Customer> {
  // Step 1: Try exact phone match (preferred identifier)
  let existing: Customer | null = null
  if (data.phone) {
    existing = await db.customer.findFirst({
      where: { locationId: data.locationId, phone: data.phone, deletedAt: null }
    })
  }

  // Step 2: If no phone match, try exact email match
  if (!existing && data.email) {
    const emailMatch = await db.customer.findFirst({
      where: { locationId: data.locationId, email: data.email, deletedAt: null }
    })

    // Step 3: Conflict detection — phone matched nobody, but email matched someone
    // who has a DIFFERENT phone. Don't silently merge; create new + log.
    if (emailMatch && data.phone && emailMatch.phone && emailMatch.phone !== data.phone) {
      console.error(JSON.stringify({
        event: 'customer_upsert_conflict',
        locationId: data.locationId,
        phoneProvided: data.phone,
        emailProvided: data.email,
        conflictCustomerId: emailMatch.id,
        conflictPhone: emailMatch.phone,
        action: 'creating_new_record',
        timestamp: new Date().toISOString(),
      }))
      // Fall through to create new record
    } else {
      existing = emailMatch
    }
  }

  // Update existing — only backfill missing contact info, never overwrite
  if (existing) {
    return db.customer.update({
      where: { id: existing.id },
      data: {
        ...(data.email && !existing.email && { email: data.email }),
        ...(data.phone && !existing.phone && { phone: data.phone }),
        lastVisit: new Date(),
      }
    })
  }

  // Create new customer record
  const [firstName, ...rest] = data.name.split(' ')
  return db.customer.create({
    data: {
      locationId: data.locationId,
      firstName: firstName || 'Guest',
      lastName: rest.join(' ') || '',
      email: data.email || null,
      phone: data.phone || null,
      lastVisit: new Date(),
      marketingOptIn: false,
    }
  })
}

/**
 * Accrue loyalty points after successful checkout.
 * $1 spent = 1 point (configurable later).
 */
export async function accrueOnlineLoyaltyPoints(
  db: PrismaClient,
  customerId: string,
  orderTotal: number,
): Promise<void> {
  const pointsEarned = Math.floor(orderTotal) // $1 = 1 point
  if (pointsEarned <= 0) return

  await db.customer.update({
    where: { id: customerId },
    data: {
      loyaltyPoints: { increment: pointsEarned },
      totalOrders: { increment: 1 },
      totalSpent: { increment: orderTotal },
    }
  })
}

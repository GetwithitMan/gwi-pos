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
import { normalizePhone } from '@/lib/utils'

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
  // Normalize phone before any matching — ensures "(555) 123-4567" matches "5551234567"
  const normalizedPhone = data.phone ? normalizePhone(data.phone) : undefined

  // Step 1: Try exact phone match (preferred identifier)
  let existing: Customer | null = null
  if (normalizedPhone) {
    existing = await db.customer.findFirst({
      where: { locationId: data.locationId, phone: normalizedPhone, deletedAt: null }
    })
  }

  // Step 2: If no phone match, try exact email match
  if (!existing && data.email) {
    const emailMatch = await db.customer.findFirst({
      where: { locationId: data.locationId, email: data.email, deletedAt: null }
    })

    // Step 3: Conflict detection — phone matched nobody, but email matched someone
    // who has a DIFFERENT phone. Don't silently merge; create new + log.
    if (emailMatch && normalizedPhone && emailMatch.phone && emailMatch.phone !== normalizedPhone) {
      console.error(JSON.stringify({
        event: 'customer_upsert_conflict',
        locationId: data.locationId,
        phoneProvided: normalizedPhone,
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

  // Step 4: Check soft-deleted records — reactivate instead of creating duplicates
  if (!existing) {
    let softDeleted: Customer | null = null
    if (normalizedPhone) {
      softDeleted = await db.customer.findFirst({
        where: { locationId: data.locationId, phone: normalizedPhone, deletedAt: { not: null } }
      })
    }
    if (!softDeleted && data.email) {
      softDeleted = await db.customer.findFirst({
        where: { locationId: data.locationId, email: data.email, deletedAt: { not: null } }
      })
    }
    if (softDeleted) {
      return db.customer.update({
        where: { id: softDeleted.id },
        data: {
          deletedAt: null,
          lastVisit: new Date(),
          ...(data.email && { email: data.email }),
          ...(normalizedPhone && { phone: normalizedPhone }),
        }
      })
    }
  }

  // Update existing — only backfill missing contact info, never overwrite
  if (existing) {
    return db.customer.update({
      where: { id: existing.id },
      data: {
        ...(data.email && !existing.email && { email: data.email }),
        ...(normalizedPhone && !existing.phone && { phone: normalizedPhone }),
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
      phone: normalizedPhone || null,
      lastVisit: new Date(),
      marketingOptIn: false,
    }
  })
}

/**
 * @deprecated Online loyalty earn now runs through the canonical loyalty engine
 * module (`@/lib/domain/loyalty/compute-earn`). The earlier flat `Math.floor($)`
 * path was removed because it ignored `pointsPerDollar`, tier multipliers,
 * `earnOnSubtotal`/`earnOnTips`, and the minimum-earn threshold.
 *
 * Kept as a throwing stub so any accidental reintroduction of a parallel
 * implementation fails loudly in CI instead of silently drifting from POS
 * behavior. Callers must use `recordOnlineCustomerLoyaltyEarn` in
 * `@/lib/domain/loyalty/record-online-earn` (which wraps the canonical engine
 * and writes a `LoyaltyTransaction`).
 */
export function accrueOnlineLoyaltyPoints(): never {
  throw new Error(
    'accrueOnlineLoyaltyPoints is removed. Use recordOnlineCustomerLoyaltyEarn from @/lib/domain/loyalty/record-online-earn instead — it calls the canonical loyalty engine.'
  )
}

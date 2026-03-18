/**
 * Customer Matcher — find-or-create customer for reservations
 *
 * Phone-first matching (E.164 normalized), email fallback (case-insensitive).
 * Preference preservation: customer profile fields copy INTO reservation only when blank.
 */

import { PrismaClient } from '@/generated/prisma/client'
import { formatPhoneE164 } from '../twilio'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('reservations')

interface CustomerMatchParams {
  phone?: string | null
  email?: string | null
  name: string
  locationId: string
  db: PrismaClient
}

interface CustomerMatchResult {
  customer: any // Prisma Customer type
  created: boolean
}

/**
 * Find existing customer by phone (primary) or email (fallback), or create a new one.
 * Phone is normalized to E.164 before lookup.
 */
export async function findOrCreateCustomer(params: CustomerMatchParams): Promise<CustomerMatchResult> {
  const { phone, email, name, locationId, db } = params

  // 1. Phone match (primary)
  if (phone) {
    const normalized = formatPhoneE164(phone)
    const byPhone = await db.customer.findFirst({
      where: { locationId, phone: normalized, deletedAt: null },
    })
    if (byPhone) return { customer: byPhone, created: false }
  }

  // 2. Email match (fallback, case-insensitive)
  if (email) {
    const byEmail = await db.customer.findFirst({
      where: {
        locationId,
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
      },
    })
    if (byEmail) return { customer: byEmail, created: false }
  }

  // 3. Create new customer
  const nameParts = name.trim().split(/\s+/)
  const firstName = nameParts[0] || ''
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''

  const customer = await db.customer.create({
    data: {
      locationId,
      firstName,
      lastName,
      displayName: name.trim(),
      phone: phone ? formatPhoneE164(phone) : null,
      email: email || null,
    },
  })

  return { customer, created: true }
}

/**
 * Check if a customer is currently blacklisted.
 * Returns false if blacklistOverrideUntil is in the future (temporary override active).
 */
export function isBlacklisted(customer: {
  isBlacklisted: boolean
  blacklistOverrideUntil?: Date | null
}): boolean {
  if (!customer.isBlacklisted) return false

  // Override active — customer is temporarily un-blacklisted
  if (customer.blacklistOverrideUntil && customer.blacklistOverrideUntil >= new Date()) {
    return false
  }

  return true
}

/**
 * Atomically increment no-show count for a customer.
 */
export async function incrementNoShowCount(customerId: string, db: PrismaClient): Promise<void> {
  await db.customer.update({
    where: { id: customerId },
    data: { noShowCount: { increment: 1 } },
  })
}

/**
 * Check if customer has hit the no-show threshold and auto-blacklist if so.
 * Returns true if blacklisted.
 */
export async function checkAndApplyBlacklist(
  customerId: string,
  threshold: number,
  db: PrismaClient
): Promise<boolean> {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } })

  if (customer.noShowCount >= threshold) {
    await db.customer.update({
      where: { id: customerId },
      data: { isBlacklisted: true },
    })
    return true
  }

  return false
}

/**
 * Clear blacklist status for a customer (manager override).
 * Optionally set a temporary override window (blacklistOverrideUntil).
 * Audit event should be written by the caller.
 */
export async function clearBlacklist(params: {
  customerId: string
  reason: string
  actorId: string
  overrideUntil?: Date
  db: PrismaClient
}): Promise<void> {
  const { customerId, reason, actorId, overrideUntil, db } = params

  await db.customer.update({
    where: { id: customerId },
    data: {
      isBlacklisted: false,
      blacklistOverrideUntil: overrideUntil || null,
    },
  })

  log.info(`[Reservations] Blacklist cleared for customer ${customerId} by ${actorId}: ${reason}`)
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { withVenue } from '@/lib/with-venue'
import { hashPassword, hashPin } from '@/lib/auth'
import { checkLoginRateLimit, recordLoginFailure } from '@/lib/auth-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

/**
 * POST /api/auth/venue-setup
 *
 * First-time admin password setup for a venue. Uses PROVISION_API_KEY
 * as the bootstrap auth mechanism — this key is shared between Mission
 * Control and the POS, so GWI admins can use it to provision initial
 * credentials without needing a separate auth system.
 *
 * Usage:
 *   curl -X POST https://{slug}.ordercontrolcenter.com/api/auth/venue-setup \
 *     -H 'Content-Type: application/json' \
 *     -d '{"email":"owner@example.com","setupKey":"<PROVISION_API_KEY>","newPassword":"securepass"}'
 *
 * If an Employee with the given email already exists, their password is updated.
 * If not, a new admin employee is created in the venue database.
 *
 * This endpoint will also be called automatically by Mission Control
 * during venue provisioning in a future update.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  // ── Rate limiting (5 attempts / 5 minutes) ─────────────────────
  const ip = getClientIp(request)

  const rateCheck = checkLoginRateLimit(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: rateCheck.reason },
      {
        status: 429,
        headers: rateCheck.retryAfterSeconds
          ? { 'Retry-After': String(rateCheck.retryAfterSeconds) }
          : undefined,
      }
    )
  }

  const body = await request.json().catch(() => ({}))
  const { email, setupKey, newPassword } = body

  if (!email || !setupKey || !newPassword) {
    return err('email, setupKey, and newPassword are required')
  }

  // Validate using PROVISION_API_KEY as bootstrap auth
  const secret = process.env.PROVISION_API_KEY
  if (!secret || setupKey !== secret) {
    recordLoginFailure(ip)
    return forbidden('Invalid setup key')
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return err('Password must be at least 8 characters')
  }

  const normalizedEmail = email.trim().toLowerCase()
  const passwordHash = await hashPassword(newPassword)

  // Check for existing employee with this email (includes locationId for tenant-scoped update)
  const existing = await db.employee.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, locationId: true },
  })

  if (existing) {
    await EmployeeRepository.updateEmployee(existing.id, existing.locationId, { password: passwordHash })
    return ok({ success: true, action: 'updated', employeeId: existing.id })
  }

  // No employee found — create a venue admin employee
  const location = await db.location.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!location) {
    return notFound('No location found in venue database')
  }

  // Find a Manager or Admin role; fall back to any role
  const role = await db.role.findFirst({
    where: {
      locationId: location.id,
      deletedAt: null,
      name: { in: ['Manager', 'Admin', 'Owner'] },
    },
  }) ?? await db.role.findFirst({
    where: { locationId: location.id, deletedAt: null },
    orderBy: { name: 'asc' },
  })

  if (!role) {
    return notFound('No roles found in venue database')
  }

  const namePart = normalizedEmail.split('@')[0]
  const pinHash = await hashPin('000000') // Placeholder PIN — admin uses password, not PIN

  const newEmployee = await EmployeeRepository.createEmployee(location.id, {
    roleId: role.id,
    firstName: namePart,
    lastName: '',
    email: normalizedEmail,
    password: passwordHash,
    pin: pinHash,
  })

  return ok({ success: true, action: 'created', employeeId: newEmployee.id })
})

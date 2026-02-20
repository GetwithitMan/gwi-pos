import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { hashPassword, hashPin } from '@/lib/auth'

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
  const body = await request.json().catch(() => ({}))
  const { email, setupKey, newPassword } = body

  if (!email || !setupKey || !newPassword) {
    return NextResponse.json(
      { error: 'email, setupKey, and newPassword are required' },
      { status: 400 }
    )
  }

  // Validate using PROVISION_API_KEY as bootstrap auth
  const secret = process.env.PROVISION_API_KEY
  if (!secret || setupKey !== secret) {
    return NextResponse.json({ error: 'Invalid setup key' }, { status: 403 })
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }

  const normalizedEmail = email.trim().toLowerCase()
  const passwordHash = await hashPassword(newPassword)

  // Check for existing employee with this email
  const existing = await db.employee.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  })

  if (existing) {
    await db.employee.update({
      where: { id: existing.id },
      data: { password: passwordHash },
    })
    return NextResponse.json({
      data: { success: true, action: 'updated', employeeId: existing.id },
    })
  }

  // No employee found — create a venue admin employee
  const location = await db.location.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!location) {
    return NextResponse.json({ error: 'No location found in venue database' }, { status: 404 })
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
    return NextResponse.json({ error: 'No roles found in venue database' }, { status: 404 })
  }

  const namePart = normalizedEmail.split('@')[0]
  const pinHash = await hashPin('000000') // Placeholder PIN — admin uses password, not PIN

  const newEmployee = await db.employee.create({
    data: {
      locationId: location.id,
      roleId: role.id,
      firstName: namePart,
      lastName: '',
      email: normalizedEmail,
      password: passwordHash,
      pin: pinHash,
    },
    select: { id: true },
  })

  return NextResponse.json({
    data: { success: true, action: 'created', employeeId: newEmployee.id },
  })
})

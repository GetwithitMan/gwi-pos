import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { err, unauthorized } from '@/lib/api-response'

// POST: employee enters PIN on mobile device → returns session token + sets cookie
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { pin, locationId, deviceName = 'Mobile Device', deviceFingerprint } = body

    if (!pin || !locationId) {
      return err('Missing pin or locationId')
    }

    // Find active employees scoped to this location
    const employees = await db.employee.findMany({
      where: { locationId, isActive: true, deletedAt: null },
      select: {
        id: true,
        pin: true,
        firstName: true,
        lastName: true,
        displayName: true,
        role: { select: { id: true, name: true, permissions: true } },
      },
    })

    // Verify PIN against hashed PINs (must iterate — pins are hashed)
    let matchedEmployee = null
    for (const emp of employees) {
      if (emp.pin && await bcrypt.compare(String(pin), emp.pin)) {
        matchedEmployee = emp
        break
      }
    }

    if (!matchedEmployee) {
      return unauthorized('Invalid PIN')
    }

    // Find or create a RegisteredDevice for this fingerprint.
    // When no fingerprint is supplied, skip the lookup entirely and always create
    // a new device record. This prevents matching an arbitrary existing device
    // (Prisma drops undefined filters, which would match the first row).
    let device = deviceFingerprint
      ? await db.registeredDevice.findFirst({
          where: {
            locationId,
            deviceFingerprint,
            deletedAt: null,
          },
        })
      : null

    if (!device) {
      device = await db.registeredDevice.create({
        data: {
          locationId,
          name: deviceName as string,
          deviceFingerprint: deviceFingerprint ?? null,
          registeredById: matchedEmployee.id,
        },
      })
    } else {
      await db.registeredDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      })
    }

    // Generate 256-bit session token
    const sessionToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000) // 8 hours

    await db.mobileSession.create({
      data: {
        locationId,
        deviceId: device.id,
        employeeId: matchedEmployee.id,
        sessionToken,
        expiresAt,
      },
    })

    const response = NextResponse.json({
      data: {
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        employee: {
          id: matchedEmployee.id,
          firstName: matchedEmployee.firstName,
          lastName: matchedEmployee.lastName,
          displayName: matchedEmployee.displayName,
          role: matchedEmployee.role,
        },
      },
    })

    // Set httpOnly session cookie (8 hours, path scoped to /mobile)
    response.cookies.set('mobile-session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/mobile',
    })

    return response
  } catch (error) {
    console.error('[mobile/device/register] Error:', error)
    return err('Internal server error', 500)
  }
}))

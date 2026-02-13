import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { compare } from 'bcryptjs'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/auth/verify-pin
 *
 * Verifies an employee PIN without doing a full login.
 * Used for operations that require PIN confirmation (stock adjustments, voids, etc.)
 *
 * Does NOT create an audit log entry for login - the calling operation
 * should log its own audit entry with the verified employee ID.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const { pin, locationId } = await request.json()

    if (!pin || pin.length < 4) {
      return NextResponse.json(
        { error: 'PIN must be at least 4 digits' },
        { status: 400 }
      )
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Get active employees for this location
    const employees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
      },
      select: {
        id: true,
        pin: true,
        firstName: true,
        lastName: true,
        role: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    })

    // Find employee with matching PIN
    let matchedEmployee = null
    for (const employee of employees) {
      const pinMatch = await compare(pin, employee.pin)
      if (pinMatch) {
        matchedEmployee = employee
        break
      }
    }

    if (!matchedEmployee) {
      return NextResponse.json(
        { error: 'Invalid PIN' },
        { status: 401 }
      )
    }

    // Return minimal employee info for verification
    return NextResponse.json({
      employee: {
        id: matchedEmployee.id,
        firstName: matchedEmployee.firstName,
        lastName: matchedEmployee.lastName,
        role: matchedEmployee.role.name,
      },
      verified: true,
    })
  } catch (error) {
    console.error('PIN verification error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
})

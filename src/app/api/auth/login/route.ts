import { NextRequest, NextResponse } from 'next/server'
// import { authenticateEmployee } from '@/lib/auth'
// import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json()

    if (!pin || pin.length < 4) {
      return NextResponse.json(
        { error: 'PIN must be at least 4 digits' },
        { status: 400 }
      )
    }

    // TODO: Get locationId from request headers/cookies once multi-location is set up
    // For now, use a demo response

    // Demo employee for testing (remove once database is connected)
    if (pin === '1234') {
      return NextResponse.json({
        employee: {
          id: 'demo-employee-1',
          firstName: 'Demo',
          lastName: 'User',
          displayName: 'Demo U.',
          role: {
            id: 'demo-role-1',
            name: 'Manager',
          },
          location: {
            id: 'demo-location-1',
            name: 'Demo Location',
          },
          permissions: ['admin'],
        },
      })
    }

    // Uncomment once database is set up:
    // const locationId = request.headers.get('x-location-id') || 'default'
    // const employee = await authenticateEmployee(locationId, pin)
    //
    // if (!employee) {
    //   return NextResponse.json(
    //     { error: 'Invalid PIN' },
    //     { status: 401 }
    //   )
    // }
    //
    // // Log the login
    // await db.auditLog.create({
    //   data: {
    //     locationId: employee.location.id,
    //     employeeId: employee.id,
    //     action: 'login',
    //     entityType: 'employee',
    //     entityId: employee.id,
    //   },
    // })
    //
    // return NextResponse.json({ employee })

    return NextResponse.json(
      { error: 'Invalid PIN' },
      { status: 401 }
    )
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

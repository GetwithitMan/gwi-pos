import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get employee's preferences including room order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const employee = await db.employee.findUnique({
      where: { id },
      select: {
        id: true,
        preferredRoomOrder: true,
      },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Parse room order JSON
    let roomOrder: string[] = []
    if (employee.preferredRoomOrder) {
      try {
        roomOrder = JSON.parse(employee.preferredRoomOrder)
      } catch {
        roomOrder = []
      }
    }

    return NextResponse.json({
      preferences: {
        preferredRoomOrder: roomOrder,
      },
    })
  } catch (error) {
    console.error('Failed to get employee preferences:', error)
    return NextResponse.json(
      { error: 'Failed to get preferences' },
      { status: 500 }
    )
  }
})

// PUT - Update employee's room order preference
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { preferredRoomOrder } = body as { preferredRoomOrder: string[] }

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Validate input
    if (!Array.isArray(preferredRoomOrder)) {
      return NextResponse.json(
        { error: 'preferredRoomOrder must be an array of room IDs' },
        { status: 400 }
      )
    }

    // Update employee
    await db.employee.update({
      where: { id },
      data: {
        preferredRoomOrder: JSON.stringify(preferredRoomOrder),
      },
    })

    return NextResponse.json({
      success: true,
      preferences: {
        preferredRoomOrder,
      },
    })
  } catch (error) {
    console.error('Failed to update employee preferences:', error)
    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 }
    )
  }
})

// DELETE - Reset employee's room order preference
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.employee.update({
      where: { id },
      data: {
        preferredRoomOrder: null,
      },
    })

    return NextResponse.json({
      success: true,
      preferences: {
        preferredRoomOrder: [],
      },
    })
  } catch (error) {
    console.error('Failed to reset employee preferences:', error)
    return NextResponse.json(
      { error: 'Failed to reset preferences' },
      { status: 500 }
    )
  }
})

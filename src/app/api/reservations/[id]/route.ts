import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get a single reservation
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const reservation = await db.reservation.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        table: { select: { id: true, name: true } },
      },
    })

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { reservation } })
  } catch (error) {
    console.error('Failed to fetch reservation:', error)
    return NextResponse.json({ error: 'Failed to fetch reservation' }, { status: 500 })
  }
})

// PUT - Update a reservation
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.reservation.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const reservation = await db.reservation.update({
      where: { id },
      data: {
        ...(body.customerName !== undefined && { customerName: body.customerName }),
        ...(body.customerPhone !== undefined && { customerPhone: body.customerPhone }),
        ...(body.customerEmail !== undefined && { customerEmail: body.customerEmail }),
        ...(body.partySize !== undefined && { partySize: body.partySize }),
        ...(body.reservationTime !== undefined && { reservationTime: body.reservationTime }),
        ...(body.duration !== undefined && { duration: body.duration }),
        ...(body.tableId !== undefined && { tableId: body.tableId }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.specialRequests !== undefined && { specialRequests: body.specialRequests }),
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        table: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ data: { reservation } })
  } catch (error) {
    console.error('Failed to update reservation:', error)
    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
})

// DELETE - Cancel/delete a reservation
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const cancel = searchParams.get('cancel') === 'true'

    const reservation = await db.reservation.findUnique({ where: { id } })
    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    if (cancel) {
      await db.reservation.update({
        where: { id },
        data: { status: 'cancelled' },
      })
      return NextResponse.json({ data: { success: true, message: 'Reservation cancelled' } })
    }

    await db.reservation.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete reservation:', error)
    return NextResponse.json({ error: 'Failed to delete reservation' }, { status: 500 })
  }
})

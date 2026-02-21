import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// DELETE - Employee cancels their own pending swap request (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const swapRequest = await db.shiftSwapRequest.findUnique({
      where: { id: requestId },
    })

    if (!swapRequest) {
      return NextResponse.json({ error: 'Swap request not found' }, { status: 404 })
    }

    if (swapRequest.locationId !== locationId) {
      return NextResponse.json({ error: 'Swap request does not belong to this location' }, { status: 403 })
    }

    if (swapRequest.deletedAt !== null) {
      return NextResponse.json({ error: 'Swap request already cancelled' }, { status: 404 })
    }

    if (swapRequest.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot cancel a swap request with status '${swapRequest.status}'` },
        { status: 400 }
      )
    }

    // Soft delete
    await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { message: 'Swap request cancelled' } })
  } catch (error) {
    console.error('Failed to cancel swap request:', error)
    return NextResponse.json({ error: 'Failed to cancel swap request' }, { status: 500 })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Employee accepts a swap request (moves to 'accepted' status)
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const body = await request.json()
    const { locationId } = body as { locationId: string }

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
      return NextResponse.json({ error: 'Swap request has been cancelled' }, { status: 404 })
    }

    if (swapRequest.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot accept a swap request with status '${swapRequest.status}'` },
        { status: 400 }
      )
    }

    const updated = await db.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
    })

    return NextResponse.json({ data: { request: updated } })
  } catch (error) {
    console.error('Failed to accept swap request:', error)
    return NextResponse.json({ error: 'Failed to accept swap request' }, { status: 500 })
  }
})

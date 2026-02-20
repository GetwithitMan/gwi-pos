import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getDatacapClient } from '@/lib/datacap/helpers'

/**
 * Cloud reader cancel proxy
 * Sends EMVPadReset to reset the cloud-connected reader to idle.
 * Called when user navigates away mid-transaction or explicitly cancels.
 */
export const POST = withVenue(async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const reader = await db.paymentReader.findFirst({
      where: { id, deletedAt: null },
      select: { locationId: true },
    })

    if (!reader) {
      return NextResponse.json({ data: { success: false } })
    }

    const client = await getDatacapClient(reader.locationId)
    await client.padReset(id)

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    // Cancel errors are non-fatal — log and return gracefully
    console.error('[cloud/cancel] padReset failed:', error)
    return NextResponse.json({ data: { success: false } })
  }
})

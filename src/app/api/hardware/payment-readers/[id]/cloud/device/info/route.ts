import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * Cloud reader device info proxy
 * For cloud-mode readers (e.g. VP3350 USB), there is no direct HTTP device handshake.
 * We return the stored serial + firmware from our DB so useDatacap can verify identity.
 */
export const GET = withVenue(async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const reader = await db.paymentReader.findFirst({
    where: { id, deletedAt: null },
    select: { serialNumber: true, firmwareVersion: true, deviceType: true, communicationMode: true },
  })

  if (!reader) {
    return NextResponse.json({ error: 'Reader not found' }, { status: 404 })
  }

  if (reader.communicationMode !== 'cloud') {
    return NextResponse.json({ error: 'Reader is not in cloud mode' }, { status: 400 })
  }

  return NextResponse.json({
    serialNumber: reader.serialNumber,
    firmwareVersion: reader.firmwareVersion || null,
    model: reader.deviceType || 'VP3350',
  })
})

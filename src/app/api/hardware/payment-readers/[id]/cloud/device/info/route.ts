import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

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
    return notFound('Reader not found')
  }

  if (reader.communicationMode !== 'cloud') {
    return err('Reader is not in cloud mode')
  }

  return ok({
    serialNumber: reader.serialNumber,
    firmwareVersion: reader.firmwareVersion || null,
    model: reader.deviceType || 'VP3350',
  })
})

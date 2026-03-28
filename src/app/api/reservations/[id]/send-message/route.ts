import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { sendReservationNotification, type TemplateKey } from '@/lib/reservations/notifications'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { templateKey, channel, customMessage } = body as {
      templateKey: TemplateKey
      channel?: 'sms' | 'email'
      customMessage?: string
    }

    if (!templateKey) {
      return err('templateKey is required')
    }

    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return err('No location found')
    }

    // Load reservation with customer
    const reservation = await db.reservation.findUnique({
      where: { id },
      include: { customer: true, table: true, location: { select: { id: true, name: true, settings: true, phone: true, address: true } } },
    })

    if (!reservation || reservation.locationId !== callerLocationId) {
      return notFound('Reservation not found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, reservation.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return forbidden(auth.error || 'Permission denied')
    }

    const settings = parseSettings(reservation.location.settings)
    const templates = settings.reservationTemplates!

    const results = await sendReservationNotification({
      reservation,
      templateKey,
      db,
      templates,
      venueInfo: {
        name: reservation.location.name,
        phone: reservation.location.phone || undefined,
        address: reservation.location.address || undefined,
        slug: '',
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`,
      },
      customMessage,
      channels: channel ? [channel] : undefined,
    })

    return ok(results)
  } catch (error) {
    console.error('[reservations/[id]/send-message] POST error:', error)
    return err('Failed to send message', 500)
  }
})

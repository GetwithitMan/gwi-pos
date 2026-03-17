import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { sendReservationNotification, type TemplateKey } from '@/lib/reservations/notifications'

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
      return NextResponse.json({ error: 'templateKey is required' }, { status: 400 })
    }

    // Load reservation with customer
    const reservation = await db.reservation.findUnique({
      where: { id },
      include: { customer: true, table: true, location: { select: { id: true, name: true, settings: true, phone: true, address: true } } },
    })

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, reservation.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
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
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006',
      },
      customMessage,
      channels: channel ? [channel] : undefined,
    })

    return NextResponse.json({ data: results })
  } catch (error) {
    console.error('[reservations/[id]/send-message] POST error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
})

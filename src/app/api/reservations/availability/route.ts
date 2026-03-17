import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { getAvailableSlots, type OperatingHours } from '@/lib/reservations/availability'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const date = sp.get('date')
    const partySize = parseInt(sp.get('partySize') || '2', 10)

    if (!locationId || !date) {
      return NextResponse.json({ error: 'locationId and date are required' }, { status: 400 })
    }

    // Load location settings + operating hours
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = parseSettings(location.settings)
    const resSettings = settings.reservationSettings!

    // Resolve operating hours for this day
    const dayOfWeek = new Date(date + 'T12:00:00').getDay()
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const hoursConfig = (settings as any)?.operatingHours || {}
    const hours = hoursConfig[dayNames[dayOfWeek]] as OperatingHours | null | undefined

    const slots = await getAvailableSlots({
      locationId,
      date,
      partySize,
      db,
      settings: resSettings,
      operatingHours: hours || null,
      isPublic: sp.get('public') === 'true',
    })

    return NextResponse.json({ data: slots })
  } catch (error) {
    console.error('[reservations/availability] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 })
  }
})

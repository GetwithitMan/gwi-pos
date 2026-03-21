import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { getActorFromRequest } from '@/lib/api-auth'
import { createReservationWithRules, CreateReservationError } from '@/lib/reservations/create-reservation'
import type { OperatingHours } from '@/lib/reservations/availability'
import { SOURCE_TYPES, type SourceType } from '@/lib/reservations/state-machine'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'

// GET - List reservations
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }
    const date = searchParams.get('date')
    const serviceDate = searchParams.get('serviceDate')
    const status = searchParams.get('status')
    const tableId = searchParams.get('tableId')
    const source = searchParams.get('source')

    const whereClause: Record<string, unknown> = { locationId, deletedAt: null }

    // Filter by date (calendar date or service date)
    if (serviceDate) {
      whereClause.serviceDate = new Date(serviceDate + 'T00:00:00Z')
    } else if (date) {
      whereClause.reservationDate = new Date(date)
    }

    if (status) {
      if (status.includes(',')) {
        whereClause.status = { in: status.split(',') }
      } else {
        whereClause.status = status
      }
    }

    if (tableId) {
      whereClause.tableId = tableId
    }

    if (source) {
      whereClause.source = source
    }

    const reservations = await db.reservation.findMany({
      where: whereClause,
      include: {
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
            section: { select: { id: true, name: true } },
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            noShowCount: true,
            isBlacklisted: true,
          },
        },
        bottleServiceTier: {
          select: {
            id: true,
            name: true,
            color: true,
            depositAmount: true,
            minimumSpend: true,
          },
        },
      },
      orderBy: [
        { reservationDate: 'asc' },
        { reservationTime: 'asc' },
      ],
    })

    return NextResponse.json(reservations)
  } catch (error) {
    console.error('Failed to fetch reservations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reservations' },
      { status: 500 }
    )
  }
})

// POST - Create a new reservation via the reservation engine
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const body = await request.json()
    const {
      guestName,
      guestPhone,
      guestEmail,
      partySize,
      reservationDate,
      reservationTime,
      duration,
      tableId,
      specialRequests,
      internalNotes,
      occasion,
      dietaryRestrictions,
      sectionPreference,
      source,
      externalId,
      smsOptIn,
      tags,
      bottleServiceTierId,
      idempotencyKey,
      forceBook,
    } = body

    if (!guestName || !partySize || !reservationDate || !reservationTime) {
      return NextResponse.json(
        { error: 'guestName, partySize, reservationDate, and reservationTime are required' },
        { status: 400 }
      )
    }

    // Validate partySize: must be a positive integer, capped at a reasonable max
    const MAX_PARTY_SIZE = 200
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > MAX_PARTY_SIZE) {
      return NextResponse.json(
        { error: `partySize must be a positive integer (max ${MAX_PARTY_SIZE})` },
        { status: 400 }
      )
    }

    // Validate reservationDate: must match YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate)) {
      return NextResponse.json(
        { error: 'reservationDate must be in YYYY-MM-DD format' },
        { status: 400 }
      )
    }

    // Validate reservationTime: must match HH:MM format with valid hours/minutes
    const timeMatch = reservationTime.match(/^(\d{2}):(\d{2})$/)
    if (!timeMatch) {
      return NextResponse.json(
        { error: 'reservationTime must be in HH:MM format' },
        { status: 400 }
      )
    }
    const parsedHours = parseInt(timeMatch[1], 10)
    const parsedMinutes = parseInt(timeMatch[2], 10)
    if (parsedHours < 0 || parsedHours > 23 || parsedMinutes < 0 || parsedMinutes > 59) {
      return NextResponse.json(
        { error: 'reservationTime has invalid hours (0-23) or minutes (0-59)' },
        { status: 400 }
      )
    }

    // Validate source against allowed types
    if (source && !SOURCE_TYPES.includes(source as SourceType)) {
      return NextResponse.json(
        { error: `Invalid source. Must be one of: ${SOURCE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Load location settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, settings: true, timezone: true, phone: true, address: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = parseSettings(location.settings)
    const resSettings = settings.reservationSettings!
    const depRules = settings.depositRules!
    const templates = settings.reservationTemplates!
    const tz = (location.timezone as string) || 'America/New_York'

    // Resolve operating hours for this day
    const dayOfWeek = new Date(reservationDate + 'T12:00:00').getDay()
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const hoursConfig = (settings as any)?.operatingHours || {}
    const hours = hoursConfig[dayNames[dayOfWeek]] as OperatingHours | null | undefined

    // Resolve actor
    const actorInfo = await getActorFromRequest(request)

    const result = await createReservationWithRules({
      locationId,
      guestName,
      guestPhone,
      guestEmail,
      partySize,
      reservationDate,
      reservationTime,
      duration,
      specialRequests,
      internalNotes,
      occasion,
      dietaryRestrictions,
      sectionPreference,
      source: (source as SourceType) || 'staff',
      externalId,
      smsOptIn,
      tags,
      tableId,
      bottleServiceTierId,
      idempotencyKey,
      forceBook,
      actor: {
        type: actorInfo.fromSession ? 'staff' : 'guest',
        id: actorInfo.employeeId || undefined,
      },
      db,
      settings: resSettings,
      depositRules: depRules,
      templates,
      operatingHours: hours || null,
      timezone: tz,
      venueInfo: {
        name: location.name,
        phone: location.phone || undefined,
        address: location.address || undefined,
        slug: '',
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006',
      },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'created', entityId: result.reservation.id })

    return NextResponse.json({
      data: result.reservation,
      customer: result.customer,
      customerCreated: result.created,
      depositRequired: result.depositRequired,
      depositToken: result.depositToken,
      depositExpiresAt: result.depositExpiresAt,
    })
  } catch (error) {
    if (error instanceof CreateReservationError) {
      const statusCode = error.code === 'SLOT_UNAVAILABLE' ? 409
        : error.code === 'BLACKLISTED' ? 403
        : 422
      return NextResponse.json({ error: error.message, code: error.code }, { status: statusCode })
    }
    console.error('Failed to create reservation:', error)
    return NextResponse.json(
      { error: 'Failed to create reservation' },
      { status: 500 }
    )
  }
})

import { z } from 'zod'
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
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// GET - List reservations
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
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

    return ok(reservations)
  } catch (error) {
    console.error('Failed to fetch reservations:', error)
    return err('Failed to fetch reservations', 500)
  }
})

const CreateReservationSchema = z.object({
  guestName: z.string().min(1, 'guestName is required'),
  guestPhone: z.string().optional().nullable(),
  guestEmail: z.string().email().optional().nullable(),
  partySize: z.number().int().min(1).max(200, 'partySize must be between 1 and 200'),
  reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reservationDate must be in YYYY-MM-DD format'),
  reservationTime: z.string().regex(/^\d{2}:\d{2}$/, 'reservationTime must be in HH:MM format'),
  duration: z.number().int().positive().optional(),
  tableId: z.string().optional().nullable(),
  specialRequests: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  occasion: z.string().optional().nullable(),
  dietaryRestrictions: z.string().optional().nullable(),
  sectionPreference: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  externalId: z.string().optional().nullable(),
  smsOptIn: z.boolean().optional(),
  tags: z.array(z.string()).optional().nullable(),
  bottleServiceTierId: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
  forceBook: z.boolean().optional(),
})

// POST - Create a new reservation via the reservation engine
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rawBody = await request.json()
    const parseResult = CreateReservationSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(i => i.message).join(', ')}`)
    }
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
    } = parseResult.data

    // Validate reservationTime hours/minutes range (regex only checks format)
    const timeMatch = reservationTime.match(/^(\d{2}):(\d{2})$/)!
    const parsedHours = parseInt(timeMatch[1], 10)
    const parsedMinutes = parseInt(timeMatch[2], 10)
    if (parsedHours < 0 || parsedHours > 23 || parsedMinutes < 0 || parsedMinutes > 59) {
      return err('reservationTime has invalid hours (0-23) or minutes (0-59)')
    }

    // Validate source against allowed types
    if (source && !SOURCE_TYPES.includes(source as SourceType)) {
      return err(`Invalid source. Must be one of: ${SOURCE_TYPES.join(', ')}`)
    }

    // Load location settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, settings: true, timezone: true, phone: true, address: true },
    })

    if (!location) {
      return notFound('Location not found')
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
      tags: tags ?? undefined,
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
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`,
      },
    })

    void notifyDataChanged({ locationId, domain: 'reservations', action: 'created', entityId: result.reservation.id })
    void pushUpstream()

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
    return err('Failed to create reservation', 500)
  }
})

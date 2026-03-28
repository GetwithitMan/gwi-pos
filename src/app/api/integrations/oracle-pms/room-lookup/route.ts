import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { lookupByRoom, lookupByName } from '@/lib/oracle-pms-client'
import { createRoomChargeSelection } from '@/lib/room-charge-selections'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'

// ─── Rate limiter: 10 lookups per employee per minute ────────────────────────
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'

const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 })

// ─── Input validation ─────────────────────────────────────────────────────────

function validateLookupInput(q: string, type: string): string | null {
  if (q.length > 40) return 'Search query is too long (max 40 characters)'

  if (type === 'room') {
    // Room numbers: alphanumeric, hyphens (no spaces — hotels use "101", "10A", "P2-101")
    if (!/^[A-Za-z0-9\-]+$/.test(q)) {
      return 'Room number must contain only letters, numbers, and hyphens'
    }
  } else if (type === 'name') {
    if (q.length < 2) return 'Last name must be at least 2 characters'
    // Names: Unicode letters (handles accented, non-Latin), spaces, hyphens, apostrophes (straight + iOS curly)
    if (!/^[\p{L}\s\-'\u2019]+$/u.test(q)) {
      return "Last name must contain only letters, spaces, hyphens, and apostrophes"
    }
  } else {
    return 'type must be "room" or "name"'
  }

  return null
}

// GET /api/integrations/oracle-pms/room-lookup?q=101&type=room&employeeId=...
// GET /api/integrations/oracle-pms/room-lookup?q=Smith&type=name&employeeId=...
export const GET = withVenue(async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const type = searchParams.get('type') ?? 'room'   // 'room' | 'name'
  const employeeId = searchParams.get('employeeId') ?? null

  if (!q) {
    return NextResponse.json({ error: 'q parameter is required' }, { status: 400 })
  }

  // Type-aware format validation
  const validationError = validateLookupInput(q, type)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  // Auth check — require POS access to perform guest lookups (exposes hotel guest data)
  const actor = await getActorFromRequest(request)
  const resolvedEmployeeId = actor.employeeId ?? employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.POS_ACCESS)
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Validate employeeId is a real employee at this location before using as rate-limit key.
  // Prevents a malicious client from cycling through fake IDs to bypass per-employee limits.
  let trustedEmployeeId: string | null = null
  if (employeeId) {
    const emp = await db.employee.findFirst({
      where: { id: employeeId, locationId: location.id, deletedAt: null },
      select: { id: true },
    })
    trustedEmployeeId = emp?.id ?? null
  }

  // Rate limiting per verified employee (or IP fallback for unverified/anonymous)
  const rateLimitKey = trustedEmployeeId
    ? `employee:${trustedEmployeeId}`
    : `ip:${getClientIp(request)}`

  if (!limiter.check(rateLimitKey).allowed) {
    return NextResponse.json(
      { error: 'Too many guest lookups. Please wait before trying again.' },
      { status: 429 }
    )
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const pms = settings.hotelPms

  if (!pms?.enabled || !pms.clientId) {
    return NextResponse.json({ error: 'Oracle PMS integration is not configured' }, { status: 400 })
  }

  if (type === 'name' && !pms.allowGuestLookup) {
    return NextResponse.json({ error: 'Guest name lookup is disabled' }, { status: 403 })
  }

  try {
    const results = type === 'name'
      ? await lookupByName(pms, location.id, q)
      : await lookupByRoom(pms, location.id, q)

    // Create server-trusted selection tokens — client sends selectionId to /pay, not raw OPERA IDs
    const guests = results.map(guest => {
      const selectionId = createRoomChargeSelection({
        locationId: location.id,
        reservationId: guest.reservationId,
        roomNumber: guest.roomNumber,
        guestName: guest.guestName,
        checkInDate: guest.checkInDate,
        checkOutDate: guest.checkOutDate,
        employeeId: trustedEmployeeId,
      })
      return { ...guest, selectionId }
    })

    return NextResponse.json({ data: { guests } })
  } catch {
    // Never send raw OPERA error bodies to the client
    return NextResponse.json(
      { error: 'Guest lookup failed. Please verify the PMS connection or try again.' },
      { status: 502 }
    )
  }
})

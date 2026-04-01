import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { normalizePhone } from '@/lib/utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// ── Zod schema for POST /api/customers ──────────────────────────────
const CreateCustomerSchema = z.object({
  locationId: z.string().min(1, 'Location ID is required'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(200).optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  phone: z.string().max(30).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  allergies: z.string().max(1000).optional().nullable(),
  favoriteDrink: z.string().max(200).optional().nullable(),
  favoriteFood: z.string().max(200).optional().nullable(),
  tags: z.array(z.string()).optional(),
  marketingOptIn: z.boolean().optional(),
  birthday: z.string().optional().nullable(),
  requestingEmployeeId: z.string().min(1).optional(),
}).passthrough()

// GET - List customers with optional search
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? searchParams.get('requestingEmployeeId')
    const search = searchParams.get('search')
    const tag = searchParams.get('tag')
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 500))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

    if (!locationId) {
      return err('Location ID is required')
    }

    // Auth check — POS search (has search param) only needs pos.access;
    // full admin customer list requires customers.view permission
    const requiredPerm = search ? PERMISSIONS.POS_ACCESS : PERMISSIONS.CUSTOMERS_VIEW
    const auth = await requirePermission(requestingEmployeeId, locationId, requiredPerm)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Build search filter (case-insensitive)
    // For phone search, also try normalized digits for consistent matching
    const normalizedSearch = normalizePhone(search || '')
    const searchFilter = search ? {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' as const } },
        { lastName: { contains: search, mode: 'insensitive' as const } },
        { displayName: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
        { phone: { contains: search } },
        // Also search by normalized phone digits (handles "5551234567" matching "(555) 123-4567")
        ...(normalizedSearch ? [{ phone: { contains: normalizedSearch } }] : []),
      ],
    } : {}

    const tagFilter = tag ? { tags: { string_contains: tag } } : {}

    const customers = await db.customer.findMany({
      where: {
        locationId,
        isActive: true,
        ...searchFilter,
        ...tagFilter,
      },
      orderBy: [
        { totalSpent: 'desc' },
        { lastName: 'asc' },
      ],
      take: limit,
      skip: offset,
    })

    const total = await db.customer.count({
      where: {
        locationId,
        isActive: true,
        ...searchFilter,
        ...tagFilter,
      },
    })

    return ok({
      customers: customers.map(c => {
        const tags = (c.tags ?? []) as string[]
        return {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          displayName: c.displayName,
          name: c.displayName || `${c.firstName} ${c.lastName}`,
          email: c.email,
          phone: c.phone,
          notes: c.notes,
          allergies: c.allergies,
          favoriteDrink: c.favoriteDrink,
          favoriteFood: c.favoriteFood,
          tags,
          isBanned: tags.includes('banned'),
          loyaltyPoints: c.loyaltyPoints,
          totalSpent: Number(c.totalSpent),
          totalOrders: c.totalOrders,
          averageTicket: Number(c.averageTicket),
          lastVisit: c.lastVisit?.toISOString() || null,
          marketingOptIn: c.marketingOptIn,
          birthday: c.birthday?.toISOString() || null,
          createdAt: c.createdAt.toISOString(),
        }
      }),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to fetch customers:', error)
    return err('Failed to fetch customers', 500)
  }
})

// POST - Create a new customer
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const parseResult = CreateCustomerSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    const {
      locationId,
      firstName,
      lastName,
      displayName,
      email,
      phone,
      notes,
      allergies,
      favoriteDrink,
      favoriteFood,
      tags,
      marketingOptIn,
      birthday,
      requestingEmployeeId: bodyEmployeeId,
    } = body

    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? bodyEmployeeId

    // Auth check — require customers.edit permission
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.CUSTOMERS_EDIT)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Normalize phone for consistent storage and dedup
    const normalizedPhone = normalizePhone(phone) || phone || null

    // Check for duplicate email or phone (single query)
    if (email || normalizedPhone) {
      const orConditions: Record<string, unknown>[] = []
      if (email) orConditions.push({ email })
      if (normalizedPhone) orConditions.push({ phone: normalizedPhone })

      const existing = await db.customer.findFirst({
        where: { locationId, isActive: true, OR: orConditions },
        select: { email: true, phone: true },
      })
      if (existing) {
        if (email && existing.email === email) {
          return err('A customer with this email already exists', 409)
        }
        return err('A customer with this phone number already exists', 409)
      }
    }

    // Load location settings to check for loyalty welcome bonus
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const welcomeBonus = (settings.loyalty.enabled && settings.loyalty.welcomeBonus > 0)
      ? settings.loyalty.welcomeBonus
      : 0

    const customer = await db.customer.create({
      data: {
        locationId,
        firstName,
        lastName,
        displayName: displayName || null,
        email: email || null,
        phone: normalizedPhone,
        notes: notes || null,
        allergies: allergies || null,
        favoriteDrink: favoriteDrink || null,
        favoriteFood: favoriteFood || null,
        tags: tags || [],
        marketingOptIn: marketingOptIn || false,
        birthday: birthday ? new Date(birthday) : null,
        ...(welcomeBonus > 0 ? { loyaltyPoints: welcomeBonus } : {}),
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void notifyDataChanged({ locationId, domain: 'customers', action: 'created', entityId: customer.id })
    void pushUpstream()

    return ok({
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      displayName: customer.displayName,
      name: customer.displayName || `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone,
      notes: customer.notes,
      allergies: customer.allergies,
      favoriteDrink: customer.favoriteDrink,
      favoriteFood: customer.favoriteFood,
      tags: customer.tags,
      loyaltyPoints: customer.loyaltyPoints,
      totalSpent: Number(customer.totalSpent),
      totalOrders: customer.totalOrders,
      averageTicket: Number(customer.averageTicket),
      lastVisit: customer.lastVisit?.toISOString() || null,
      marketingOptIn: customer.marketingOptIn,
      birthday: customer.birthday?.toISOString() || null,
      createdAt: customer.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create customer:', error)
    return err('Failed to create customer', 500)
  }
})

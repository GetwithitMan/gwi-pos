import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { normalizePhone } from '@/lib/utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - List customers with optional search
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? searchParams.get('requestingEmployeeId')
    const search = searchParams.get('search')
    const tag = searchParams.get('tag')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Auth check — POS search (has search param) only needs pos.access;
    // full admin customer list requires customers.view permission
    const requiredPerm = search ? PERMISSIONS.POS_ACCESS : PERMISSIONS.CUSTOMERS_VIEW
    const auth = await requirePermission(requestingEmployeeId, locationId, requiredPerm)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to fetch customers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    )
  }
})

// POST - Create a new customer
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
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
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!locationId || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Location ID, first name, and last name are required' },
        { status: 400 }
      )
    }

    // Normalize phone for consistent storage and dedup
    const normalizedPhone = normalizePhone(phone) || phone || null

    // Check for duplicate email or phone
    if (email) {
      const existingEmail = await db.customer.findFirst({
        where: { locationId, email, isActive: true },
      })
      if (existingEmail) {
        return NextResponse.json(
          { error: 'A customer with this email already exists' },
          { status: 409 }
        )
      }
    }

    if (normalizedPhone) {
      const existingPhone = await db.customer.findFirst({
        where: { locationId, phone: normalizedPhone, isActive: true },
      })
      if (existingPhone) {
        return NextResponse.json(
          { error: 'A customer with this phone number already exists' },
          { status: 409 }
        )
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

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to create customer:', error)
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    )
  }
})

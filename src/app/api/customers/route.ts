import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List customers with optional search
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
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

    // Build search filter
    const searchFilter = search ? {
      OR: [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { displayName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ],
    } : {}

    // For SQLite with JSON tags field, use string_contains to search within the JSON array
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

    return NextResponse.json({
      customers: customers.map(c => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        displayName: c.displayName,
        name: c.displayName || `${c.firstName} ${c.lastName}`,
        email: c.email,
        phone: c.phone,
        notes: c.notes,
        tags: c.tags,
        loyaltyPoints: c.loyaltyPoints,
        totalSpent: Number(c.totalSpent),
        totalOrders: c.totalOrders,
        averageTicket: Number(c.averageTicket),
        lastVisit: c.lastVisit?.toISOString() || null,
        marketingOptIn: c.marketingOptIn,
        birthday: c.birthday?.toISOString() || null,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to fetch customers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    )
  }
}

// POST - Create a new customer
export async function POST(request: NextRequest) {
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
      tags,
      marketingOptIn,
      birthday,
    } = body

    if (!locationId || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Location ID, first name, and last name are required' },
        { status: 400 }
      )
    }

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

    if (phone) {
      const existingPhone = await db.customer.findFirst({
        where: { locationId, phone, isActive: true },
      })
      if (existingPhone) {
        return NextResponse.json(
          { error: 'A customer with this phone number already exists' },
          { status: 409 }
        )
      }
    }

    const customer = await db.customer.create({
      data: {
        locationId,
        firstName,
        lastName,
        displayName: displayName || null,
        email: email || null,
        phone: phone || null,
        notes: notes || null,
        tags: tags || [],
        marketingOptIn: marketingOptIn || false,
        birthday: birthday ? new Date(birthday) : null,
      },
    })

    return NextResponse.json({
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      displayName: customer.displayName,
      name: customer.displayName || `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone,
      notes: customer.notes,
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
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    )
  }
}

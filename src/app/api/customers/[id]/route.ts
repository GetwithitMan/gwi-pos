import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { normalizePhone } from '@/lib/utils'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - Get customer details with order history
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Pagination params
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)))
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Build orders where clause with optional date filter
    const ordersWhere: Prisma.OrderWhereInput = {
      customerId: id,
      status: { in: ['completed', 'paid'] },
      deletedAt: null,
    }
    if (startDate || endDate) {
      ordersWhere.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      }
    }

    const customer = await db.customer.findFirst({
      where: { id, locationId },
      include: {
        orders: {
          where: ordersWhere,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            subtotal: true,
            total: true,
            status: true,
            createdAt: true,
            items: {
              select: {
                name: true,
                quantity: true,
                itemTotal: true,
              },
            },
          },
        },
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    // Total count for pagination (read from snapshot)
    const totalOrders = await db.orderSnapshot.count({
      where: {
        customerId: id,
        status: { in: ['completed', 'paid'] },
        deletedAt: null,
        ...(startDate || endDate ? {
          createdAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        } : {}),
      },
    })

    // Get favorite items (most ordered)
    const favoriteItems = await db.orderItem.groupBy({
      by: ['menuItemId', 'name'],
      where: {
        locationId,
        order: {
          customerId: id,
          status: { in: ['completed', 'paid'] },
        },
      },
      _count: { menuItemId: true },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    // House account summary (if linked)
    const houseAccount = await db.houseAccount.findFirst({
      where: { customerId: id, locationId },
      select: {
        id: true,
        name: true,
        status: true,
        currentBalance: true,
        creditLimit: true,
        paymentTerms: true,
      },
    })

    // Saved cards count (SavedCard table is raw SQL only — not in Prisma schema)
    const savedCardsResult = await db.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*) as count FROM "SavedCard"
       WHERE "customerId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      id, locationId
    )
    const savedCardsCount = Number(savedCardsResult[0]?.count ?? 0)

    // Recognized card profiles (auto-linked from payment card recognition)
    const cardProfiles = await db.cardProfile.findMany({
      where: { customerId: id, locationId, deletedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: {
        id: true,
        cardType: true,
        cardLast4: true,
        cardholderName: true,
        visitCount: true,
        totalSpend: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    })

    // Fetch memberships with plan info (raw SQL — not in Prisma schema)
    const memberships = await db.$queryRawUnsafe<any[]>(`
      SELECT
        m."id",
        m."status",
        m."billingStatus",
        m."currentPeriodStart",
        m."currentPeriodEnd",
        m."nextBillingDate",
        m."trialEndsAt",
        m."priceAtSignup",
        m."billingCycle",
        m."startedAt",
        m."cancelledAt",
        m."pausedAt",
        mp."id" as "planId",
        mp."name" as "planName",
        mp."price" as "planPrice",
        mp."description" as "planDescription",
        mp."benefits" as "planBenefits"
      FROM "Membership" m
      JOIN "MembershipPlan" mp ON mp."id" = m."planId"
      WHERE m."customerId" = $1
        AND m."locationId" = $2
        AND m."deletedAt" IS NULL
      ORDER BY m."createdAt" DESC
    `, id, locationId)

    const tags = (customer.tags ?? []) as string[]

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
      tags,
      isBanned: tags.includes('banned'),
      loyaltyPoints: customer.loyaltyPoints,
      totalSpent: Number(customer.totalSpent),
      totalOrders: customer.totalOrders,
      averageTicket: Number(customer.averageTicket),
      lastVisit: customer.lastVisit?.toISOString() || null,
      marketingOptIn: customer.marketingOptIn,
      birthday: customer.birthday?.toISOString() || null,
      createdAt: customer.createdAt.toISOString(),
      recentOrders: customer.orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        orderType: o.orderType,
        subtotal: Number(o.subtotal),
        total: Number(o.total),
        status: o.status,
        itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        createdAt: o.createdAt.toISOString(),
      })),
      ordersPagination: {
        page,
        limit,
        total: totalOrders,
        totalPages: Math.ceil(totalOrders / limit),
      },
      favoriteItems: favoriteItems.map(f => ({
        menuItemId: f.menuItemId,
        name: f.name,
        orderCount: f._count.menuItemId,
        totalQuantity: f._sum.quantity || 0,
      })),
      houseAccount: houseAccount ? {
        id: houseAccount.id,
        name: houseAccount.name,
        status: houseAccount.status,
        currentBalance: Number(houseAccount.currentBalance),
        creditLimit: Number(houseAccount.creditLimit),
        paymentTerms: houseAccount.paymentTerms,
      } : null,
      savedCardsCount,
      recognizedCards: cardProfiles.map(cp => ({
        id: cp.id,
        cardType: cp.cardType,
        cardLast4: cp.cardLast4,
        cardholderName: cp.cardholderName,
        visitCount: cp.visitCount,
        totalSpend: Number(cp.totalSpend),
        firstSeenAt: cp.firstSeenAt.toISOString(),
        lastSeenAt: cp.lastSeenAt.toISOString(),
      })),
      memberships: memberships.map((m: any) => ({
        id: m.id,
        status: m.status,
        billingStatus: m.billingStatus,
        planId: m.planId,
        planName: m.planName,
        planPrice: Number(m.planPrice),
        planDescription: m.planDescription,
        planBenefits: m.planBenefits,
        billingCycle: m.billingCycle,
        priceAtSignup: m.priceAtSignup ? Number(m.priceAtSignup) : null,
        currentPeriodStart: m.currentPeriodStart,
        currentPeriodEnd: m.currentPeriodEnd,
        nextBillingDate: m.nextBillingDate,
        trialEndsAt: m.trialEndsAt,
        startedAt: m.startedAt,
        cancelledAt: m.cancelledAt,
        pausedAt: m.pausedAt,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch customer:', error)
    return NextResponse.json(
      { error: 'Failed to fetch customer' },
      { status: 500 }
    )
  }
})

// PUT - Update customer
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const locationId = body.locationId || request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check — require customers.edit permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.CUSTOMERS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const customer = await db.customer.findFirst({
      where: { id, locationId },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    const {
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
      loyaltyPoints,
    } = body

    // Normalize phone for consistent storage
    const normalizedPhone = phone !== undefined ? (normalizePhone(phone) || phone || null) : undefined

    // Check for duplicate email if changing
    if (email && email !== customer.email) {
      const existingEmail = await db.customer.findFirst({
        where: {
          locationId: customer.locationId,
          email,
          isActive: true,
          id: { not: id },
        },
      })
      if (existingEmail) {
        return NextResponse.json(
          { error: 'A customer with this email already exists' },
          { status: 409 }
        )
      }
    }

    // Check for duplicate phone if changing
    const phoneToCheck = normalizedPhone !== undefined ? normalizedPhone : phone
    if (phoneToCheck && phoneToCheck !== customer.phone) {
      const existingPhone = await db.customer.findFirst({
        where: {
          locationId: customer.locationId,
          phone: phoneToCheck,
          isActive: true,
          id: { not: id },
        },
      })
      if (existingPhone) {
        return NextResponse.json(
          { error: 'A customer with this phone number already exists' },
          { status: 409 }
        )
      }
    }

    const updated = await db.customer.update({
      where: { id, locationId },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(email !== undefined && { email: email || null }),
        ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(allergies !== undefined && { allergies: allergies || null }),
        ...(favoriteDrink !== undefined && { favoriteDrink: favoriteDrink || null }),
        ...(favoriteFood !== undefined && { favoriteFood: favoriteFood || null }),
        ...(tags !== undefined && { tags }),
        ...(marketingOptIn !== undefined && { marketingOptIn }),
        ...(birthday !== undefined && { birthday: birthday ? new Date(birthday) : null }),
        ...(loyaltyPoints !== undefined && { loyaltyPoints }),
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void notifyDataChanged({ locationId, domain: 'customers', action: 'updated', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
      displayName: updated.displayName,
      name: updated.displayName || `${updated.firstName} ${updated.lastName}`,
      email: updated.email,
      phone: updated.phone,
      notes: updated.notes,
      allergies: updated.allergies,
      favoriteDrink: updated.favoriteDrink,
      favoriteFood: updated.favoriteFood,
      tags: updated.tags,
      loyaltyPoints: updated.loyaltyPoints,
      totalSpent: Number(updated.totalSpent),
      totalOrders: updated.totalOrders,
      averageTicket: Number(updated.averageTicket),
      lastVisit: updated.lastVisit?.toISOString() || null,
      marketingOptIn: updated.marketingOptIn,
      birthday: updated.birthday?.toISOString() || null,
    } })
  } catch (error) {
    console.error('Failed to update customer:', error)
    return NextResponse.json(
      { error: 'Failed to update customer' },
      { status: 500 }
    )
  }
})

// DELETE - Soft delete customer
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const customer = await db.customer.findFirst({
      where: { id, locationId },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    // Soft delete (tenant-scoped)
    await db.customer.update({
      where: { id, locationId },
      data: { isActive: false, deletedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
    })

    void notifyDataChanged({ locationId, domain: 'customers', action: 'deleted', entityId: id })
    void pushUpstream()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete customer:', error)
    return NextResponse.json(
      { error: 'Failed to delete customer' },
      { status: 500 }
    )
  }
})

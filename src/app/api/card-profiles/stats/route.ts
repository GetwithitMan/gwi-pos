import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const last4 = searchParams.get('last4')

    if (!locationId || !last4) {
      return err('Missing required params: locationId, last4')
    }

    // Find card profile by locationId + cardLast4 (uses @@index([locationId, cardLast4]))
    const profile = await db.cardProfile.findFirst({
      where: {
        locationId,
        cardLast4: last4,
        deletedAt: null,
      },
      orderBy: { lastSeenAt: 'desc' },
    })

    if (!profile) {
      return notFound('Card not found')
    }

    // Load linked customer info if customerId exists
    let customerName: string | null = null
    let customerPhone: string | null = null
    if (profile.customerId) {
      const customer = await db.customer.findUnique({
        where: { id: profile.customerId },
        select: { firstName: true, lastName: true, displayName: true, phone: true },
      })
      if (customer) {
        customerName = customer.displayName || `${customer.firstName} ${customer.lastName}`.trim()
        customerPhone = customer.phone
      }
    }

    // Query recent orders: find payments where cardLast4 matches + locationId, join to Order
    const recentPayments = await db.payment.findMany({
      where: {
        locationId,
        cardLast4: last4,
        deletedAt: null,
        order: {
          deletedAt: null,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            total: true,
            status: true,
            createdAt: true,
          },
        },
      },
    })

    // Deduplicate orders (multiple payments can reference the same order)
    const seenOrderIds = new Set<string>()
    const recentOrders = recentPayments
      .filter((p) => {
        if (seenOrderIds.has(p.order.id)) return false
        seenOrderIds.add(p.order.id)
        return true
      })
      .map((p) => ({
        id: p.order.id,
        orderNumber: p.order.orderNumber,
        total: Number(p.order.total),
        status: p.order.status,
        createdAt: p.order.createdAt.toISOString(),
      }))

    return ok({
        visitCount: profile.visitCount,
        totalSpend: Number(profile.totalSpend),
        cardType: profile.cardType,
        cardholderName: profile.cardholderName,
        firstSeenAt: profile.firstSeenAt.toISOString(),
        lastSeenAt: profile.lastSeenAt.toISOString(),
        customerId: profile.customerId,
        customerName,
        customerPhone,
        recentOrders,
      })
  } catch (error) {
    console.error('Failed to fetch card visit stats:', error)
    return err('Failed to fetch card visit stats', 500)
  }
})

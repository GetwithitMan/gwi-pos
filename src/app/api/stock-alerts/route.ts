import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List stock alerts
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = { locationId }
    if (status) where.status = status

    const alerts = await prisma.stockAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    // Get item names
    const itemIds = [...new Set(alerts.map(a => a.menuItemId))]
    const items = await prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, currentStock: true, lowStockAlert: true },
    })
    const itemMap = Object.fromEntries(items.map(i => [i.id, i]))

    return NextResponse.json({ data: {
      alerts: alerts.map(a => ({
        id: a.id,
        menuItemId: a.menuItemId,
        menuItemName: itemMap[a.menuItemId]?.name,
        currentStock: itemMap[a.menuItemId]?.currentStock ?? a.currentStock,
        lowStockThreshold: itemMap[a.menuItemId]?.lowStockAlert,
        alertType: a.alertType,
        threshold: a.threshold,
        status: a.status,
        acknowledgedAt: a.acknowledgedAt,
        resolvedAt: a.resolvedAt,
        createdAt: a.createdAt,
      })),
      summary: {
        total: alerts.length,
        active: alerts.filter(a => a.status === 'active').length,
        lowStock: alerts.filter(a => a.alertType === 'low_stock' && a.status === 'active').length,
        outOfStock: alerts.filter(a => a.alertType === 'out_of_stock' && a.status === 'active').length,
      },
    } })
  } catch (error) {
    console.error('Stock alerts error:', error)
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  }
})

// PUT - Acknowledge or resolve alerts
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { alertIds, action, employeeId } = body

    if (!alertIds || !action) {
      return NextResponse.json({ error: 'Alert IDs and action required' }, { status: 400 })
    }

    const now = new Date()

    if (action === 'acknowledge') {
      await prisma.stockAlert.updateMany({
        where: { id: { in: alertIds } },
        data: {
          status: 'acknowledged',
          acknowledgedAt: now,
          acknowledgedBy: employeeId,
        },
      })
    } else if (action === 'resolve') {
      await prisma.stockAlert.updateMany({
        where: { id: { in: alertIds } },
        data: {
          status: 'resolved',
          resolvedAt: now,
          resolvedBy: employeeId,
        },
      })
    }

    return NextResponse.json({ data: { success: true, updatedCount: alertIds.length } })
  } catch (error) {
    console.error('Update alerts error:', error)
    return NextResponse.json({ error: 'Failed to update alerts' }, { status: 500 })
  }
})

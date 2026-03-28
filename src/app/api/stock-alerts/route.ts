import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET - List stock alerts
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')

    if (!locationId) {
      return err('Location ID required')
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

    return ok({
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
    })
  } catch (error) {
    console.error('Stock alerts error:', error)
    return err('Failed to fetch alerts', 500)
  }
})

// PUT - Acknowledge or resolve alerts
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { alertIds, action, employeeId } = body

    if (!alertIds || !action) {
      return err('Alert IDs and action required')
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

    return ok({ success: true, updatedCount: alertIds.length })
  } catch (error) {
    console.error('Update alerts error:', error)
    return err('Failed to update alerts', 500)
  }
}))

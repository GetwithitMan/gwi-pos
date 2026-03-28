import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST - Submit a daily count for approval
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { submittedById } = body

    if (!submittedById) {
      return err('Submitted by ID required')
    }

    const existing = await db.dailyPrepCount.findUnique({
      where: { id },
      include: {
        countItems: true,
      },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Daily count not found')
    }

    if (existing.status !== 'draft') {
      return err('Can only submit draft counts')
    }

    if (existing.countItems.length === 0) {
      return err('Cannot submit a count with no items')
    }

    const count = await db.dailyPrepCount.update({
      where: { id },
      data: {
        status: 'submitted',
        submittedById,
        submittedAt: new Date(),
        lastMutatedBy: 'cloud',
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        submittedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        countItems: {
          include: {
            ingredient: {
              select: { id: true, name: true, standardUnit: true },
            },
          },
        },
      },
    })
    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'updated', entityId: id })
    pushUpstream()

    return ok({
        ...count,
        countItems: count.countItems.map(item => ({
          ...item,
          totalCounted: Number(item.totalCounted),
          expectedQuantity: item.expectedQuantity ? Number(item.expectedQuantity) : null,
          variance: item.variance ? Number(item.variance) : null,
          variancePercent: item.variancePercent ? Number(item.variancePercent) : null,
        })),
      })
  } catch (error) {
    console.error('Submit daily count error:', error)
    return err('Failed to submit daily count', 500)
  }
}))

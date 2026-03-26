import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - List waste log entries
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const reason = searchParams.get('reason')
    const inventoryItemId = searchParams.get('inventoryItemId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (reason) where.reason = reason
    if (inventoryItemId) where.inventoryItemId = inventoryItemId

    if (startDate || endDate) {
      where.wasteDate = {}
      if (startDate) (where.wasteDate as Record<string, Date>).gte = new Date(startDate)
      if (endDate) (where.wasteDate as Record<string, Date>).lte = new Date(endDate)
    }

    const entries = await db.wasteLogEntry.findMany({
      where,
      include: {
        inventoryItem: {
          select: { id: true, name: true, sku: true, category: true },
        },
      },
      orderBy: { wasteDate: 'desc' },
    })

    return NextResponse.json({ data: {
      entries: entries.map(entry => ({
        ...entry,
        quantity: Number(entry.quantity),
        costImpact: entry.costImpact ? Number(entry.costImpact) : null,
      })),
    } })
  } catch (error) {
    console.error('Waste log list error:', error)
    return NextResponse.json({ error: 'Failed to fetch waste log' }, { status: 500 })
  }
})

// POST - Create waste log entry
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      inventoryItemId,
      employeeId,
      reason,
      quantity,
      unit,
      notes,
    } = body

    if (!locationId || !inventoryItemId || !reason || !quantity || !unit) {
      return NextResponse.json({
        error: 'Location ID, inventory item, reason, quantity, and unit required',
      }, { status: 400 })
    }

    // Permission check — require inventory.waste permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.INVENTORY_WASTE)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get current item cost
    const item = await db.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { costPerUnit: true, currentStock: true, storageUnit: true },
    })

    if (!item) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
    }

    const costPerUnit = Number(item.costPerUnit)
    const qtyNum = Number(quantity)
    const costImpact = costPerUnit * qtyNum
    const currentStock = Number(item.currentStock)
    const businessDate = body.businessDate ? new Date(body.businessDate) : new Date()

    // H17: Create all waste records atomically in a single transaction
    const entry = await db.$transaction(async (tx) => {
      // Create waste log entry (legacy model)
      const wasteEntry = await tx.wasteLogEntry.create({
        data: {
          locationId,
          inventoryItemId,
          employeeId,
          reason,
          quantity: qtyNum,
          unit: unit || item.storageUnit,
          costImpact,
          notes,
          wasteDate: businessDate,
        },
        include: {
          inventoryItem: {
            select: { id: true, name: true, sku: true },
          },
        },
      })

      // Also create COGS-style WasteLog record for reporting
      try {
        await tx.wasteLog.create({
          data: {
            locationId,
            inventoryItemId,
            bottleProductId: body.bottleProductId || null,
            quantity: qtyNum,
            unit: unit || item.storageUnit,
            cost: costImpact,
            reason: reason as 'spoilage' | 'over_pour' | 'spill' | 'breakage' | 'expired' | 'void_comped' | 'other',
            notes,
            recordedById: employeeId,
            businessDate,
          },
        })
      } catch {
        // WasteLog model may not have all reason enum values — don't fail the whole transaction
      }

      // Deduct from inventory
      await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          currentStock: { decrement: qtyNum },
        },
      })

      // Create transaction record
      await tx.inventoryItemTransaction.create({
        data: {
          locationId,
          inventoryItemId,
          type: 'waste',
          quantityBefore: currentStock,
          quantityChange: -qtyNum,
          quantityAfter: currentStock - qtyNum,
          unitCost: costPerUnit,
          totalCost: costImpact,
          reason: notes || `Waste: ${reason}`,
        },
      })

      return wasteEntry
    })

    // Audit trail for waste recording
    console.log(`[AUDIT] WASTE_RECORDED: item=${inventoryItemId}, qty=${qtyNum}, reason="${reason}", by employee ${employeeId}, locationId=${locationId}`)

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: entry.id })
    pushUpstream()

    return NextResponse.json({ data: {
      entry: {
        ...entry,
        quantity: Number(entry.quantity),
        costImpact: entry.costImpact ? Number(entry.costImpact) : null,
      },
    } })
  } catch (error) {
    console.error('Create waste log entry error:', error)
    return NextResponse.json({ error: 'Failed to create waste log entry' }, { status: 500 })
  }
}))

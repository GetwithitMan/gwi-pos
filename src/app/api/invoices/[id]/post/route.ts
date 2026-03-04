import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { cascadeCostUpdate, type CostUpdateResult } from '@/lib/cost-cascade'

// POST /api/invoices/[id]/post — finalize invoice and cascade costs
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, requestingEmployeeId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.INVENTORY_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Load invoice with line items
    const invoice = await db.invoice.findFirst({
      where: { id, locationId, deletedAt: null },
      include: {
        vendor: { select: { id: true, name: true } },
        lineItems: {
          where: { deletedAt: null },
          include: {
            inventoryItem: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoiceStatus = String(invoice.status)
    if (invoiceStatus !== 'draft' && invoiceStatus !== 'pending') {
      return NextResponse.json(
        { error: `Invoice is already ${invoice.status}. Only draft or pending invoices can be posted.` },
        { status: 400 }
      )
    }

    // Cascade cost updates for each line item with an inventoryItemId
    const costResults: CostUpdateResult[] = []
    const errors: string[] = []

    for (const lineItem of invoice.lineItems) {
      if (!lineItem.inventoryItemId) continue

      try {
        const result = await cascadeCostUpdate(
          lineItem.inventoryItemId,
          Number(lineItem.unitCost),
          'invoice',
          locationId,
          invoice.id,
          invoice.vendor?.name,
          requestingEmployeeId,
        )
        costResults.push(result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`Failed to update cost for ${lineItem.inventoryItem?.name || lineItem.inventoryItemId}: ${msg}`)
      }
    }

    // Mark invoice as posted
    await db.invoice.update({
      where: { id },
      data: {
        status: 'posted' as never, // enum cast — resolves after prisma generate
        approvedById: requestingEmployeeId || null,
        approvedAt: new Date(),
      },
    })

    // Identify significant cost changes (>5%)
    const significantChanges = costResults.filter(r => Math.abs(r.changePercent) > 5)

    return NextResponse.json({
      data: {
        success: true,
        costsUpdated: costResults.length,
        recipesRecalculated: costResults.reduce((sum, r) => sum + r.recipesRecalculated, 0),
        significantChanges: significantChanges.map(c => ({
          itemName: c.inventoryItemName,
          oldCost: c.oldCostPerUnit,
          newCost: c.newCostPerUnit,
          changePercent: Math.round(c.changePercent * 100) / 100,
          menuItemsAffected: c.menuItemsUpdated,
        })),
        errors: errors.length > 0 ? errors : undefined,
      },
    })
  } catch (error) {
    console.error('Post invoice error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to post invoice', detail: message }, { status: 500 })
  }
})

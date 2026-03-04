import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const defaultEnd = now.toISOString().split('T')[0]

    const range = dateRangeToUTC(startDate || defaultStart, endDate || defaultEnd, timezone)

    const invoices = await db.invoice.findMany({
      where: {
        locationId,
        status: { in: ['posted', 'paid', 'approved'] },
        invoiceDate: { gte: range.start, lte: range.end },
      },
      include: {
        vendor: { select: { id: true, name: true } },
        lineItems: {
          where: { deletedAt: null },
          select: {
            description: true,
            totalCost: true,
            inventoryItem: { select: { name: true } },
          },
          orderBy: { totalCost: 'desc' },
        },
      },
    })

    // Group by vendor
    const vendorMap = new Map<string, {
      vendorId: string, vendorName: string,
      invoiceCount: number, totalSpend: number,
      itemSpends: Map<string, number>,
      lastInvoiceDate: Date,
      invoiceAmounts: number[],
    }>()

    for (const inv of invoices) {
      const key = inv.vendorId
      const amount = Number(inv.totalAmount)

      if (vendorMap.has(key)) {
        const v = vendorMap.get(key)!
        v.invoiceCount++
        v.totalSpend += amount
        v.invoiceAmounts.push(amount)
        if (inv.invoiceDate > v.lastInvoiceDate) v.lastInvoiceDate = inv.invoiceDate

        for (const li of inv.lineItems) {
          const itemName = li.inventoryItem?.name || li.description || 'Unknown'
          v.itemSpends.set(itemName, (v.itemSpends.get(itemName) || 0) + Number(li.totalCost))
        }
      } else {
        const itemSpends = new Map<string, number>()
        for (const li of inv.lineItems) {
          const itemName = li.inventoryItem?.name || li.description || 'Unknown'
          itemSpends.set(itemName, (itemSpends.get(itemName) || 0) + Number(li.totalCost))
        }

        vendorMap.set(key, {
          vendorId: inv.vendorId,
          vendorName: inv.vendor.name,
          invoiceCount: 1,
          totalSpend: amount,
          itemSpends,
          lastInvoiceDate: inv.invoiceDate,
          invoiceAmounts: [amount],
        })
      }
    }

    const vendors = Array.from(vendorMap.values()).map(v => {
      // Top 3 items by spend
      const topItems = Array.from(v.itemSpends.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name)

      return {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        invoiceCount: v.invoiceCount,
        totalSpend: v.totalSpend,
        topItems,
        lastInvoiceDate: v.lastInvoiceDate,
        avgInvoiceAmount: v.invoiceAmounts.length > 0
          ? v.totalSpend / v.invoiceAmounts.length
          : 0,
      }
    }).sort((a, b) => b.totalSpend - a.totalSpend)

    const totalSpend = vendors.reduce((s, v) => s + v.totalSpend, 0)
    const invoiceCount = vendors.reduce((s, v) => s + v.invoiceCount, 0)

    return NextResponse.json({
      data: {
        vendors,
        totalSpend,
        invoiceCount,
        dateRange: { start: range.start, end: range.end },
      },
    })
  } catch (error) {
    console.error('Failed to generate vendor spend report:', error)
    return NextResponse.json({ error: 'Failed to generate vendor spend report' }, { status: 500 })
  }
})

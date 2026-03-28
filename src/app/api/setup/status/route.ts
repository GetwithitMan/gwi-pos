import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Run all checks in parallel
    const [location, categoryCount, menuItemCount, employeeCount, tableCount, printerCount, readerCount] =
      await Promise.all([
        db.location.findUnique({
          where: { id: locationId },
          select: { name: true, address: true },
        }),
        db.category.count({
          where: { locationId, deletedAt: null },
        }),
        db.menuItem.count({
          where: { locationId, deletedAt: null },
        }),
        db.employee.count({
          where: { locationId, deletedAt: null },
        }),
        db.table.count({
          where: { locationId, deletedAt: null },
        }),
        db.printer.count({
          where: { locationId, deletedAt: null },
        }),
        db.paymentReader.count({
          where: { locationId, deletedAt: null },
        }),
      ])

    const businessInfo = !!(location?.name && location?.address)
    const menuBasics = categoryCount >= 1 && menuItemCount >= 1
    const employees = employeeCount >= 2
    const floorPlan = tableCount >= 1
    const printers = printerCount >= 1
    const payments = readerCount >= 1

    const steps = [businessInfo, menuBasics, employees, floorPlan, printers, payments]
    const completedCount = steps.filter(Boolean).length

    return ok({
        businessInfo,
        menuBasics,
        employees,
        floorPlan,
        printers,
        payments,
        completedCount,
        totalSteps: 6,
      })
  } catch (error) {
    console.error('Failed to check setup status:', error)
    return err('Failed to check setup status', 500)
  }
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET /api/inventory/prep-items - List prep items for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    const prepItems = await db.prepItem.findMany({
      where: {
        locationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        outputUnit: true,
        batchYield: true,
        batchUnit: true,
        shelfLifeHours: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    })

    return ok(prepItems.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        outputUnit: item.outputUnit,
        outputQuantity: item.batchYield ? Number(item.batchYield) : null,
        shelfLifeHours: item.shelfLifeHours,
        isActive: item.isActive,
      })))
  } catch (error) {
    console.error('Error fetching prep items:', error)
    return err('Failed to fetch prep items', 500)
  }
})

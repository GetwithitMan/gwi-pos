import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

export const dynamic = 'force-dynamic'

/**
 * GET /api/modifiers/spirit-groups
 * Returns shared/global spirit modifier groups (menuItemId IS NULL).
 * These apply to all cocktails as upsell options.
 */
export const GET = withVenue(async (req: NextRequest) => {
  const locationId = await getLocationId()
  if (!locationId) {
    return NextResponse.json({ error: 'No location found' }, { status: 400 })
  }

  const groups = await db.modifierGroup.findMany({
    where: {
      locationId,
      menuItemId: null,
      isSpiritGroup: true,
      deletedAt: null,
    },
    include: {
      modifiers: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          linkedBottleProduct: {
            select: { id: true, name: true, tier: true, pourCost: true },
          },
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  return NextResponse.json({ data: groups })
})

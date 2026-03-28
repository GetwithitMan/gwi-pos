import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitToLocation } from '@/lib/socket-server'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'

const log = createChildLogger('liquor.categories')

/**
 * GET /api/liquor/categories
 * List all spirit categories for the location
 */
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const isActive = searchParams.get('isActive')
    const includeBottles = searchParams.get('includeBottles') === 'true'

    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const categories = await db.spiritCategory.findMany({
      where: {
        locationId,
        ...(isActive !== null && { isActive: isActive === 'true' }),
      },
      include: {
        _count: {
          select: {
            bottleProducts: true,
            spiritModifierGroups: true,
          },
        },
        ...(includeBottles && {
          bottleProducts: {
            where: { isActive: true },
            orderBy: [
              { tier: 'asc' },
              { name: 'asc' },
            ],
            select: {
              id: true,
              name: true,
              brand: true,
              displayName: true,
              tier: true,
              pourCost: true,
              isActive: true,
            },
          },
        }),
      },
      orderBy: { sortOrder: 'asc' },
    })

    return ok(categories.map((category) => ({
        id: category.id,
        name: category.name,
        categoryType: category.categoryType,
        displayName: category.displayName,
        description: category.description,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        bottleCount: category._count.bottleProducts,
        modifierGroupCount: category._count.spiritModifierGroups,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
        ...((category as any).bottleProducts && {
          bottleProducts: (category as any).bottleProducts.map((b: any) => ({
            ...b,
            pourCost: b.pourCost ? Number(b.pourCost) : null,
          })),
        }),
      })))
  } catch (error) {
    console.error('Failed to fetch spirit categories:', error)
    return err('Failed to fetch spirit categories', 500)
  }
}))

/**
 * POST /api/liquor/categories
 * Create a new spirit category
 */
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description, categoryType } = body

    if (!name?.trim()) {
      return err('Name is required')
    }

    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const auth = await requirePermission(body.employeeId || null, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Get max sort order
    const maxSortOrder = await db.spiritCategory.aggregate({
      where: { locationId },
      _max: { sortOrder: true },
    })

    const category = await db.spiritCategory.create({
      data: {
        locationId,
        name: name.trim(),
        categoryType: categoryType || 'spirit',
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void emitToLocation(locationId, 'menu:updated', { trigger: 'liquor-category' }).catch(err => log.warn({ err }, 'socket emit failed'))
    void notifyDataChanged({ locationId, domain: 'liquor', action: 'created', entityId: category.id })
    void pushUpstream()

    return ok({
      id: category.id,
      name: category.name,
      categoryType: category.categoryType,
      displayName: category.displayName,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      bottleCount: 0,
      modifierGroupCount: 0,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    })
  } catch (error) {
    console.error('Failed to create spirit category:', error)
    return err('Failed to create spirit category', 500)
  }
}))

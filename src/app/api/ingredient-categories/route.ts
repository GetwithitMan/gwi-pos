import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { err, ok, unauthorized } from '@/lib/api-response'

// GET /api/ingredient-categories - List all categories for location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return err('locationId is required')
    }

    const actor = await getActorFromRequest(request)
    if (!actor.employeeId) {
      return unauthorized('Authentication required')
    }
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MENU_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    const categories = await db.ingredientCategory.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        _count: {
          select: {
            ingredients: {
              where: { deletedAt: null, isActive: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return ok(categories.map(cat => ({
        ...cat,
        ingredientCount: cat._count.ingredients,
        _count: undefined,
      })))
  } catch (error) {
    console.error('Error fetching ingredient categories:', error)
    return err('Failed to fetch ingredient categories', 500)
  }
})

// POST /api/ingredient-categories - Create a new category
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      icon,
      color,
      sortOrder,
      needsVerification,
    } = body

    if (!locationId || !name) {
      return err('locationId and name are required')
    }

    const actor = await getActorFromRequest(request)
    if (!actor.employeeId) {
      return unauthorized('Authentication required')
    }
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Check for duplicate name
    const existing = await db.ingredientCategory.findFirst({
      where: { locationId, name, deletedAt: null },
    })
    if (existing) {
      return err('A category with this name already exists', 409)
    }

    // Auto-assign the next code number (IMMUTABLE after creation)
    const maxCode = await db.ingredientCategory.aggregate({
      where: { locationId },
      _max: { code: true },
    })
    const nextCode = (maxCode._max.code ?? 0) + 1

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined) {
      const maxSort = await db.ingredientCategory.aggregate({
        where: { locationId },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? -1) + 1
    }

    const category = await db.ingredientCategory.create({
      data: {
        locationId,
        code: nextCode,
        name,
        description,
        icon,
        color,
        sortOrder: finalSortOrder,
        needsVerification: needsVerification ?? false,
      },
    })

    void notifyDataChanged({ locationId, domain: 'inventory', action: 'created', entityId: category.id })
    void pushUpstream()

    try {
      const { emitToLocation } = await import('@/lib/socket-server')
      void emitToLocation(locationId, 'inventory:changed', { action: 'category_created', entityId: category.id })
    } catch {}

    return ok({
        ...category,
        ingredientCount: 0,
      })
  } catch (error) {
    console.error('Error creating ingredient category:', error)
    return err('Failed to create ingredient category', 500)
  }
})

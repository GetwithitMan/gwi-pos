import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'

// GET all pricing option groups + nested options for a menu item
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: menuItemId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const groups = await db.pricingOptionGroup.findMany({
      where: {
        locationId,
        menuItemId,
        deletedAt: null,
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        options: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({
      data: {
        groups: groups.map((group) => ({
          id: group.id,
          menuItemId: group.menuItemId,
          name: group.name,
          sortOrder: group.sortOrder,
          isRequired: group.isRequired,
          showAsQuickPick: group.showAsQuickPick,
          options: group.options.map((opt) => ({
            id: opt.id,
            groupId: opt.groupId,
            label: opt.label,
            price: opt.price != null ? Number(opt.price) : null,
            priceCC: opt.priceCC != null ? Number(opt.priceCC) : null,
            sortOrder: opt.sortOrder,
            isDefault: opt.isDefault,
            showOnPos: opt.showOnPos,
            color: opt.color,
          })),
        })),
      },
    })
  } catch (error) {
    console.error('Failed to fetch pricing option groups:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pricing option groups' },
      { status: 500 }
    )
  }
})

// POST create a new pricing option group (optionally with inline options)
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const { name, sortOrder, isRequired, showAsQuickPick, options } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify menu item exists and belongs to this location
    const menuItem = await db.menuItem.findFirst({
      where: { id: menuItemId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Get max sort order for this menu item's groups
    const maxSort = await db.pricingOptionGroup.aggregate({
      where: { locationId, menuItemId, deletedAt: null },
      _max: { sortOrder: true },
    })

    const group = await db.pricingOptionGroup.create({
      data: {
        locationId,
        menuItemId,
        name: name.trim(),
        sortOrder: sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        isRequired: isRequired ?? false,
        showAsQuickPick: showAsQuickPick ?? false,
        options: options?.length
          ? {
              create: options.map(
                (
                  opt: {
                    label: string
                    price?: number | null
                    priceCC?: number | null
                    sortOrder?: number
                    isDefault?: boolean
                    showOnPos?: boolean
                    color?: string | null
                  },
                  index: number
                ) => ({
                  locationId,
                  label: opt.label,
                  price: opt.price ?? null,
                  priceCC: opt.priceCC ?? null,
                  sortOrder: opt.sortOrder ?? index,
                  isDefault: opt.isDefault ?? false,
                  showOnPos: opt.showOnPos ?? false,
                  color: opt.color ?? null,
                })
              ),
            }
          : undefined,
      },
      include: {
        options: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    // Invalidate menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      menuItemId,
    }).catch(() => {})

    return NextResponse.json({
      data: {
        group: {
          id: group.id,
          menuItemId: group.menuItemId,
          name: group.name,
          sortOrder: group.sortOrder,
          isRequired: group.isRequired,
          showAsQuickPick: group.showAsQuickPick,
          options: group.options.map((opt) => ({
            id: opt.id,
            groupId: opt.groupId,
            label: opt.label,
            price: opt.price != null ? Number(opt.price) : null,
            priceCC: opt.priceCC != null ? Number(opt.priceCC) : null,
            sortOrder: opt.sortOrder,
            isDefault: opt.isDefault,
            showOnPos: opt.showOnPos,
            color: opt.color,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Failed to create pricing option group:', error)
    return NextResponse.json(
      { error: 'Failed to create pricing option group' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_MENU_RESTORE_POINT_SETTINGS } from '@/lib/settings'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/menu/snapshots — List available menu snapshots
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const snapshots: any[] = await db.$queryRawUnsafe(`
      SELECT id, label, "createdByName", "itemCount", "categoryCount", "createdAt"
      FROM "MenuSnapshot"
      WHERE "locationId" = $1
      ORDER BY "createdAt" DESC
    `, locationId)

    return NextResponse.json({ data: snapshots })
  } catch (error) {
    console.error('[MenuSnapshots] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 })
  }
})

/**
 * POST /api/menu/snapshots — Create a new menu snapshot
 * Permission: manager level (manage_menu)
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const restoreConfig = settings.menuRestorePoints ?? DEFAULT_MENU_RESTORE_POINT_SETTINGS

    if (!restoreConfig.enabled) {
      return NextResponse.json({ error: 'Menu restore points are not enabled' }, { status: 400 })
    }

    // Auth check — manager level
    const actor = await getActorFromRequest(request)
    let employeeName = 'System'
    let employeeId: string | null = null

    if (actor.employeeId && actor.locationId) {
      const authResult = await requirePermission(actor.employeeId, actor.locationId, 'manage_menu')
      if (!authResult.authorized) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status })
      }
      employeeName = authResult.employee.displayName || `${authResult.employee.firstName} ${authResult.employee.lastName}`
      employeeId = authResult.employee.id
    }

    const body = await request.json().catch(() => ({}))
    const label = body.label?.trim() || null

    // Capture current menu state
    const snapshotData = await captureMenuSnapshot(locationId)

    // Enforce max snapshots — delete oldest when exceeded
    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count FROM "MenuSnapshot" WHERE "locationId" = $1
    `, locationId)
    const existingCount = countResult[0]?.count ?? 0

    if (existingCount >= restoreConfig.maxSnapshots) {
      const deleteCount = existingCount - restoreConfig.maxSnapshots + 1
      await db.$queryRawUnsafe(`
        DELETE FROM "MenuSnapshot"
        WHERE id IN (
          SELECT id FROM "MenuSnapshot"
          WHERE "locationId" = $1
          ORDER BY "createdAt" ASC
          LIMIT $2
        )
      `, locationId, deleteCount)
    }

    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "MenuSnapshot" ("locationId", label, "createdById", "createdByName", "itemCount", "categoryCount", data)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING id, label, "createdByName", "itemCount", "categoryCount", "createdAt"
    `,
      locationId,
      label,
      employeeId,
      employeeName,
      snapshotData.items.length,
      snapshotData.categories.length,
      JSON.stringify(snapshotData)
    )

    return NextResponse.json({ data: inserted[0] }, { status: 201 })
  } catch (error) {
    console.error('[MenuSnapshots] POST error:', error)
    return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 })
  }
})

/**
 * Capture the current menu state for a location.
 * Returns all categories, menu items, modifier groups, and modifiers.
 */
export async function captureMenuSnapshot(locationId: string) {
  const [categories, items, modifierGroups, modifiers] = await Promise.all([
    db.category.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        color: true,
        categoryType: true,
        categoryShow: true,
        isActive: true,
        sortOrder: true,
        showOnline: true,
        printerIds: true,
      },
    }),
    db.menuItem.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true,
        categoryId: true,
        name: true,
        description: true,
        price: true,
        priceCC: true,
        isActive: true,
        isAvailable: true,
        sortOrder: true,
        itemType: true,
        showOnline: true,
        onlinePrice: true,
        pourSizes: true,
        defaultPourSize: true,
        applyPourToModifiers: true,
        soldByWeight: true,
        weightUnit: true,
        pricePerWeightUnit: true,
        commissionType: true,
        commissionValue: true,
        timedPricing: true,
        minimumMinutes: true,
        printerIds: true,
        backupPrinterIds: true,
        comboPrintMode: true,
        isFeaturedCfd: true,
        availableFrom: true,
        availableTo: true,
        availableDays: true,
        availableFromDate: true,
        availableUntilDate: true,
        taxRate: true,
        isTaxExempt: true,
      },
    }),
    db.modifierGroup.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        menuItemId: true,
        minSelections: true,
        maxSelections: true,
        isRequired: true,
        allowStacking: true,
        sortOrder: true,
        isSpiritGroup: true,
        showOnline: true,
      },
    }),
    db.modifier.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        price: true,
        modifierGroupId: true,
        isActive: true,
        sortOrder: true,
        spiritTier: true,
        linkedMenuItemId: true,
        linkedBottleProductId: true,
      },
    }),
  ])

  return {
    categories,
    items: items.map(i => ({
      ...i,
      price: i.price ? Number(i.price) : null,
      priceCC: i.priceCC ? Number(i.priceCC) : null,
      onlinePrice: i.onlinePrice ? Number(i.onlinePrice) : null,
      pricePerWeightUnit: i.pricePerWeightUnit ? Number(i.pricePerWeightUnit) : null,
      commissionValue: i.commissionValue ? Number(i.commissionValue) : null,
      taxRate: i.taxRate ? Number(i.taxRate) : null,
    })),
    modifierGroups,
    modifiers: modifiers.map(m => ({
      ...m,
      price: m.price ? Number(m.price) : null,
    })),
    capturedAt: new Date().toISOString(),
  }
}

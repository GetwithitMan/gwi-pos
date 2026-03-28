import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'
const log = createChildLogger('menu-snapshots')

export const dynamic = 'force-dynamic'

/**
 * GET /api/menu/snapshots/[id] — View snapshot details + diff from current
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT id, label, "createdByName", "itemCount", "categoryCount", data, "createdAt"
      FROM "MenuSnapshot"
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    if (!rows.length) {
      return notFound('Snapshot not found')
    }

    const snapshot = rows[0]

    // Size guard: reject snapshots > 10MB to prevent OOM
    const dataStr = typeof snapshot.data === 'string' ? snapshot.data : JSON.stringify(snapshot.data)
    if (dataStr.length > 10_000_000) {
      return err('Snapshot too large. Contact support.', 413)
    }

    const snapshotData = typeof snapshot.data === 'string' ? JSON.parse(snapshot.data) : snapshot.data

    // Calculate diff from current menu
    const currentItemCount = await db.menuItem.count({
      where: { locationId, deletedAt: null },
    })
    const currentCategoryCount = await db.category.count({
      where: { locationId, deletedAt: null },
    })

    const diff = {
      currentItemCount,
      currentCategoryCount,
      snapshotItemCount: snapshot.itemCount,
      snapshotCategoryCount: snapshot.categoryCount,
      itemDelta: currentItemCount - snapshot.itemCount,
      categoryDelta: currentCategoryCount - snapshot.categoryCount,
    }

    return ok({
        id: snapshot.id,
        label: snapshot.label,
        createdByName: snapshot.createdByName,
        itemCount: snapshot.itemCount,
        categoryCount: snapshot.categoryCount,
        createdAt: snapshot.createdAt,
        diff,
        // Include full data for preview
        categories: snapshotData.categories || [],
        items: snapshotData.items || [],
        modifierGroups: snapshotData.modifierGroups || [],
        modifiers: snapshotData.modifiers || [],
      })
  } catch (error) {
    console.error('[MenuSnapshots] GET [id] error:', error)
    return err('Failed to fetch snapshot', 500)
  }
})

/**
 * POST /api/menu/snapshots/[id] — Restore from snapshot
 * Permission: admin/owner level (manage_menu + manage_settings)
 *
 * Strategy: Update existing records to match snapshot values rather than delete+recreate
 * to preserve historical OrderItem references.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check — admin level (destructive operation)
    const actor = await getActorFromRequest(request)
    if (!actor.employeeId || !actor.locationId) {
      return unauthorized('Authentication required')
    }

    const authResult = await requirePermission(actor.employeeId, actor.locationId, 'manage_menu')
    if (!authResult.authorized) {
      return err(authResult.error, authResult.status)
    }

    // Fetch snapshot
    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT data FROM "MenuSnapshot"
      WHERE id = $1 AND "locationId" = $2
    `, id, locationId)

    if (!rows.length) {
      return notFound('Snapshot not found')
    }

    const snapshotData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data

    // Restore in a transaction
    await db.$transaction(async (tx) => {
      const snapshotCategoryIds = new Set((snapshotData.categories || []).map((c: any) => c.id))
      const snapshotItemIds = new Set((snapshotData.items || []).map((i: any) => i.id))
      const snapshotModGroupIds = new Set((snapshotData.modifierGroups || []).map((mg: any) => mg.id))
      const snapshotModIds = new Set((snapshotData.modifiers || []).map((m: any) => m.id))

      // 1. Soft-delete categories NOT in the snapshot
      await tx.category.updateMany({
        where: {
          locationId,
          deletedAt: null,
          id: { notIn: Array.from(snapshotCategoryIds) as string[] },
        },
        data: { deletedAt: new Date() },
      })

      // 2. Upsert categories from snapshot
      for (const cat of snapshotData.categories || []) {
        await tx.category.upsert({
          where: { id: cat.id },
          update: {
            name: cat.name,
            color: cat.color,
            categoryType: cat.categoryType,
            categoryShow: cat.categoryShow,
            isActive: cat.isActive,
            sortOrder: cat.sortOrder,
            showOnline: cat.showOnline ?? false,
            printerIds: cat.printerIds ?? [],
            deletedAt: null,
          },
          create: {
            id: cat.id,
            locationId,
            name: cat.name,
            color: cat.color,
            categoryType: cat.categoryType,
            categoryShow: cat.categoryShow,
            isActive: cat.isActive,
            sortOrder: cat.sortOrder,
            showOnline: cat.showOnline ?? false,
            printerIds: cat.printerIds ?? [],
          },
        })
      }

      // 3. Soft-delete menu items NOT in the snapshot
      await tx.menuItem.updateMany({
        where: {
          locationId,
          deletedAt: null,
          id: { notIn: Array.from(snapshotItemIds) as string[] },
        },
        data: { deletedAt: new Date() },
      })

      // 4. Upsert menu items from snapshot
      for (const item of snapshotData.items || []) {
        await tx.menuItem.upsert({
          where: { id: item.id },
          update: {
            categoryId: item.categoryId,
            name: item.name,
            description: item.description,
            price: item.price,
            priceCC: item.priceCC,
            isActive: item.isActive,
            isAvailable: item.isAvailable ?? true,
            sortOrder: item.sortOrder,
            itemType: item.itemType,
            showOnline: item.showOnline ?? false,
            onlinePrice: item.onlinePrice,
            pourSizes: item.pourSizes,
            defaultPourSize: item.defaultPourSize,
            applyPourToModifiers: item.applyPourToModifiers ?? false,
            soldByWeight: item.soldByWeight ?? false,
            weightUnit: item.weightUnit,
            pricePerWeightUnit: item.pricePerWeightUnit,
            commissionType: item.commissionType,
            commissionValue: item.commissionValue,
            timedPricing: item.timedPricing,
            minimumMinutes: item.minimumMinutes,
            printerIds: item.printerIds ?? [],
            backupPrinterIds: item.backupPrinterIds ?? [],
            comboPrintMode: item.comboPrintMode,
            isFeaturedCfd: item.isFeaturedCfd ?? false,
            taxRate: item.taxRate,
            isTaxExempt: item.isTaxExempt ?? false,
            deletedAt: null,
          },
          create: {
            id: item.id,
            locationId,
            categoryId: item.categoryId,
            name: item.name,
            description: item.description,
            price: item.price ?? 0,
            priceCC: item.priceCC,
            isActive: item.isActive ?? true,
            isAvailable: item.isAvailable ?? true,
            sortOrder: item.sortOrder ?? 0,
            itemType: item.itemType ?? 'standard',
            showOnline: item.showOnline ?? false,
            onlinePrice: item.onlinePrice,
            pourSizes: item.pourSizes,
            defaultPourSize: item.defaultPourSize,
            applyPourToModifiers: item.applyPourToModifiers ?? false,
            soldByWeight: item.soldByWeight ?? false,
            weightUnit: item.weightUnit,
            pricePerWeightUnit: item.pricePerWeightUnit,
            commissionType: item.commissionType,
            commissionValue: item.commissionValue,
            timedPricing: item.timedPricing,
            minimumMinutes: item.minimumMinutes,
            printerIds: item.printerIds ?? [],
            backupPrinterIds: item.backupPrinterIds ?? [],
            comboPrintMode: item.comboPrintMode,
            isFeaturedCfd: item.isFeaturedCfd ?? false,
            taxRate: item.taxRate,
            isTaxExempt: item.isTaxExempt ?? false,
          },
        })
      }

      // 5. Soft-delete modifier groups NOT in the snapshot
      await tx.modifierGroup.updateMany({
        where: {
          locationId,
          deletedAt: null,
          id: { notIn: Array.from(snapshotModGroupIds) as string[] },
        },
        data: { deletedAt: new Date() },
      })

      // 6. Upsert modifier groups from snapshot
      for (const mg of snapshotData.modifierGroups || []) {
        await tx.modifierGroup.upsert({
          where: { id: mg.id },
          update: {
            name: mg.name,
            menuItemId: mg.menuItemId,
            minSelections: mg.minSelections,
            maxSelections: mg.maxSelections,
            isRequired: mg.isRequired ?? false,
            allowStacking: mg.allowStacking ?? false,
            sortOrder: mg.sortOrder ?? 0,
            isSpiritGroup: mg.isSpiritGroup ?? false,
            showOnline: mg.showOnline ?? false,
            deletedAt: null,
          },
          create: {
            id: mg.id,
            locationId,
            name: mg.name,
            menuItemId: mg.menuItemId,
            minSelections: mg.minSelections ?? 0,
            maxSelections: mg.maxSelections ?? 0,
            isRequired: mg.isRequired ?? false,
            allowStacking: mg.allowStacking ?? false,
            sortOrder: mg.sortOrder ?? 0,
            isSpiritGroup: mg.isSpiritGroup ?? false,
            showOnline: mg.showOnline ?? false,
          },
        })
      }

      // 7. Soft-delete modifiers NOT in the snapshot
      await tx.modifier.updateMany({
        where: {
          locationId,
          deletedAt: null,
          id: { notIn: Array.from(snapshotModIds) as string[] },
        },
        data: { deletedAt: new Date() },
      })

      // 8. Upsert modifiers from snapshot
      for (const mod of snapshotData.modifiers || []) {
        await tx.modifier.upsert({
          where: { id: mod.id },
          update: {
            name: mod.name,
            price: mod.price ?? 0,
            modifierGroupId: mod.modifierGroupId,
            isActive: mod.isActive ?? true,
            sortOrder: mod.sortOrder ?? 0,
            spiritTier: mod.spiritTier,
            linkedMenuItemId: mod.linkedMenuItemId,
            linkedBottleProductId: mod.linkedBottleProductId,
            deletedAt: null,
          },
          create: {
            id: mod.id,
            locationId,
            name: mod.name,
            price: mod.price ?? 0,
            modifierGroupId: mod.modifierGroupId,
            isActive: mod.isActive ?? true,
            sortOrder: mod.sortOrder ?? 0,
            spiritTier: mod.spiritTier,
            linkedMenuItemId: mod.linkedMenuItemId,
            linkedBottleProductId: mod.linkedBottleProductId,
          },
        })
      }
    })

    // Invalidate menu cache
    try {
      invalidateMenuCache(locationId)
    } catch { /* non-critical */ }

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, { action: 'updated' }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    const employeeName = authResult.employee.displayName || `${authResult.employee.firstName} ${authResult.employee.lastName}`

    return ok({
      success: true,
      message: `Menu restored from snapshot by ${employeeName}. ${snapshotData.categories?.length || 0} categories and ${snapshotData.items?.length || 0} items restored.`,
    })
  } catch (error) {
    console.error('[MenuSnapshots] POST restore error:', error)
    return err('Failed to restore from snapshot', 500)
  }
})

/**
 * DELETE /api/menu/snapshots/[id] — Delete a snapshot
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    if (actor.employeeId && actor.locationId) {
      const authResult = await requirePermission(actor.employeeId, actor.locationId, 'manage_menu')
      if (!authResult.authorized) {
        return err(authResult.error, authResult.status)
      }
    }

    const result = await db.$queryRawUnsafe(`
      DELETE FROM "MenuSnapshot"
      WHERE id = $1 AND "locationId" = $2
      RETURNING id
    `, id, locationId)

    if (!Array.isArray(result) || result.length === 0) {
      return notFound('Snapshot not found')
    }

    return ok({ success: true })
  } catch (error) {
    console.error('[MenuSnapshots] DELETE error:', error)
    return err('Failed to delete snapshot', 500)
  }
})

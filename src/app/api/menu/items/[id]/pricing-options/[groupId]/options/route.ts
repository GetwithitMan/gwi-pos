import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('menu.items.id.pricing-options.groupId.options')

// POST add a new option to a group
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id: menuItemId, groupId } = await params
    const body = await request.json()
    const { label, price, priceCC, sortOrder, isDefault, showOnPos, color } = body

    if (!label?.trim()) {
      return err('Label is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Verify group belongs to this item and location
    const group = await db.pricingOptionGroup.findFirst({
      where: { id: groupId, menuItemId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!group) {
      return notFound('Pricing option group not found')
    }

    // Remove any soft-deleted option with the same label (unique constraint includes deleted)
    await db.pricingOption.deleteMany({
      where: { groupId, label: label.trim(), deletedAt: { not: null } },
    })

    // If isDefault=true, unset any existing default in this group
    if (isDefault) {
      await db.pricingOption.updateMany({
        where: { groupId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      })
    }

    // Get max sort order if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const maxSort = await db.pricingOption.aggregate({
        where: { groupId, deletedAt: null },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? 0) + 1
    }

    const option = await db.pricingOption.create({
      data: {
        locationId,
        groupId,
        label: label.trim(),
        price: price ?? null,
        priceCC: priceCC ?? null,
        sortOrder: finalSortOrder,
        isDefault: isDefault ?? false,
        showOnPos: showOnPos ?? false,
        color: color ?? null,
      },
    })

    // Invalidate menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      menuItemId,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in menu.items.id.pricing-options.groupId.options'))

    void notifyDataChanged({ locationId, domain: 'pricing', action: 'created', entityId: option.id })
    void pushUpstream()

    return ok({
        option: {
          id: option.id,
          groupId: option.groupId,
          label: option.label,
          price: option.price != null ? Number(option.price) : null,
          priceCC: option.priceCC != null ? Number(option.priceCC) : null,
          sortOrder: option.sortOrder,
          isDefault: option.isDefault,
          showOnPos: option.showOnPos,
          color: option.color,
        },
      })
  } catch (error) {
    console.error('Failed to create pricing option:', error)
    return err('Failed to create pricing option', 500)
  }
}))

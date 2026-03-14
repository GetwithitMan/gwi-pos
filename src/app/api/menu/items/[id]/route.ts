import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { dispatchMenuItemChanged, dispatchMenuStockChanged, dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { computeIsOrderableOnline } from '@/lib/online-availability'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const item = await db.menuItem.findFirst({
      where: { id, deletedAt: null, locationId },
      include: {
        category: {
          select: { id: true, name: true, categoryType: true },
        },
        ownedModifierGroups: {
          where: { deletedAt: null },
          select: { id: true },
        },
        pricingOptionGroups: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            options: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: { id: true, label: true, price: true, priceCC: true, sortOrder: true, isDefault: true, color: true },
            },
          },
        },
      },
    })

    if (!item) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    // Check if this is a pizza item based on category type OR item type
    const isPizzaItem = item.itemType === 'pizza' || item.category?.categoryType === 'pizza'

    return NextResponse.json({ data: {
      item: {
        id: item.id,
        categoryId: item.categoryId,
        categoryName: item.category?.name,
        categoryType: item.category?.categoryType,
        name: item.name,
        displayName: item.displayName,
        price: Number(item.price),
        priceCC: item.priceCC ? Number(item.priceCC) : null,
        onlinePrice: item.onlinePrice !== null ? Number(item.onlinePrice) : null,
        cost: item.cost ? Number(item.cost) : null,
        description: item.description,
        sku: item.sku,
        isActive: item.isActive,
        isAvailable: item.isAvailable,
        showOnPOS: item.showOnPOS,
        showOnline: item.showOnline,
        itemType: item.itemType,
        isPizza: isPizzaItem,
        hasModifiers: item.ownedModifierGroups.length > 0 || isPizzaItem,
        modifierGroups: item.ownedModifierGroups.map(mg => ({ modifierGroupId: mg.id })),
        // Tax
        taxRate: item.taxRate ? Number(item.taxRate) : null,
        isTaxExempt: item.isTaxExempt,
        // Kitchen
        prepTime: item.prepTime,
        courseNumber: item.courseNumber,
        prepStationId: item.prepStationId,
        // Inventory
        trackInventory: item.trackInventory,
        lowStockAlert: item.lowStockAlert,
        // Commission
        commissionType: item.commissionType,
        commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
        // Availability schedule
        availableFrom: item.availableFrom,
        availableTo: item.availableTo,
        availableDays: item.availableDays,
        // Seasonal date-based availability
        availableFromDate: item.availableFromDate?.toISOString() ?? null,
        availableUntilDate: item.availableUntilDate?.toISOString() ?? null,
        // Happy Hour
        happyHourEnabled: item.happyHourEnabled,
        happyHourDiscount: item.happyHourDiscount,
        happyHourStart: item.happyHourStart,
        happyHourEnd: item.happyHourEnd,
        happyHourDays: item.happyHourDays,
        // Entertainment/timed rental fields
        entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
        blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
        timedPricing: item.itemType === 'timed_rental' ? item.timedPricing : null,
        // Overtime pricing
        overtimeEnabled: (item as any).overtimeEnabled ?? false,
        overtimeMode: (item as any).overtimeMode ?? null,
        overtimeMultiplier: (item as any).overtimeMultiplier ? Number((item as any).overtimeMultiplier) : null,
        overtimePerMinuteRate: (item as any).overtimePerMinuteRate ? Number((item as any).overtimePerMinuteRate) : null,
        overtimeFlatFee: (item as any).overtimeFlatFee ? Number((item as any).overtimeFlatFee) : null,
        overtimeGraceMinutes: (item as any).overtimeGraceMinutes ?? null,
        pourSizes: item.pourSizes,
        defaultPourSize: item.defaultPourSize,
        imageUrl: item.imageUrl,
        // Weight-Based Selling
        soldByWeight: item.soldByWeight,
        weightUnit: item.weightUnit,
        pricePerWeightUnit: item.pricePerWeightUnit ? Number(item.pricePerWeightUnit) : null,
        // Allergen tracking
        allergens: item.allergens || [],
        // Age verification
        isAgeRestricted: item.isAgeRestricted ?? false,
        // Force-open modifier modal
        alwaysOpenModifiers: (item as any).alwaysOpenModifiers ?? false,
        // Tip-exempt
        tipExempt: (item as any).tipExempt ?? false,
        // Nutritional info (optional — fields may not exist on schema yet)
        calories: (item as any).calories ?? null,
        caloriesFromFat: (item as any).caloriesFromFat ?? null,
        protein: (item as any).protein != null ? Number((item as any).protein) : null,
        carbs: (item as any).carbs != null ? Number((item as any).carbs) : null,
        fat: (item as any).fat != null ? Number((item as any).fat) : null,
        fiber: (item as any).fiber != null ? Number((item as any).fiber) : null,
        sodium: (item as any).sodium != null ? Number((item as any).sodium) : null,
        allergenNotes: (item as any).allergenNotes ?? null,
        // Pricing option groups (size/variant pricing)
        pricingOptionGroups: (item as any).pricingOptionGroups?.map((group: any) => ({
          id: group.id,
          name: group.name,
          sortOrder: group.sortOrder,
          isRequired: group.isRequired,
          showAsQuickPick: group.showAsQuickPick,
          options: group.options.map((opt: any) => ({
            id: opt.id,
            label: opt.label,
            price: opt.price !== null ? Number(opt.price) : null,
            priceCC: opt.priceCC !== null ? Number(opt.priceCC) : null,
            sortOrder: opt.sortOrder,
            isDefault: opt.isDefault,
            showOnPos: opt.showOnPos ?? false,
            color: opt.color,
          })),
        })) || [],
        hasPricingOptions: ((item as any).pricingOptionGroups?.length || 0) > 0,
      },
    } })
  } catch (error) {
    console.error('Failed to get item:', error)
    return NextResponse.json(
      { error: 'Failed to get item' },
      { status: 500 }
    )
  }
})

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      displayName,
      price,
      priceCC,
      cost,
      description,
      sku,
      imageUrl,
      isActive,
      isAvailable,
      showOnPOS,
      showOnline,
      onlinePrice,
      sortOrder,
      deletedAt,
      // Tax
      taxRate,
      isTaxExempt,
      // Kitchen
      prepTime,
      courseNumber,
      prepStationId,
      // Inventory
      trackInventory,
      lowStockAlert,
      // Commission
      commissionType,
      commissionValue,
      // Availability schedule
      availableFrom,
      availableTo,
      availableDays,
      // Seasonal date-based availability
      availableFromDate,
      availableUntilDate,
      // Happy Hour
      happyHourEnabled,
      happyHourDiscount,
      happyHourStart,
      happyHourEnd,
      happyHourDays,
      // Pour size options
      pourSizes,
      defaultPourSize,
      applyPourToModifiers,
      // Printer routing (arrays)
      printerIds,
      backupPrinterIds,
      // Combo print mode
      comboPrintMode,
      // Linked bottle product (direct bottle linking)
      linkedBottleProductId,
      linkedPourSizeOz,
      // Weight-Based Selling
      soldByWeight,
      weightUnit,
      pricePerWeightUnit,
      // Entertainment / timed rental fields
      timedPricing,
      ratePerMinute,
      minimumCharge,
      incrementMinutes,
      graceMinutes,
      blockTimeMinutes,
      entertainmentStatus,
      // Overtime pricing for block-time entertainment
      overtimeEnabled,
      overtimeMode,
      overtimeMultiplier,
      overtimePerMinuteRate,
      overtimeFlatFee,
      overtimeGraceMinutes,
      // Allergen tracking
      allergens,
      // Age verification
      isAgeRestricted,
      // Force-open modifier modal
      alwaysOpenModifiers,
      // Tip-exempt
      tipExempt,
      // Category reassignment (drag-drop between categories)
      categoryId,
      // Nutritional info (optional — schema fields may not exist yet)
      calories,
      caloriesFromFat,
      protein,
      carbs,
      fat,
      fiber,
      sodium,
      allergenNotes,
    } = body

    // Get old item to detect stock changes (fetch availability fields for computeIsOrderableOnline)
    const oldItem = await db.menuItem.findUnique({
      where: { id },
      select: {
        isAvailable: true,
        locationId: true,
        showOnline: true,
        availableFrom: true,
        availableTo: true,
        availableDays: true,
        currentStock: true,
        trackInventory: true,
        lowStockAlert: true,
      }
    })

    const item = await db.menuItem.update({
      where: { id },
      data: {
        ...(categoryId !== undefined && categoryId !== null && { categoryId }),
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(price !== undefined && { price }),
        ...(priceCC !== undefined && { priceCC: priceCC || null }),
        ...(cost !== undefined && { cost: cost ?? null }),
        ...(description !== undefined && { description }),
        ...(sku !== undefined && { sku: sku || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
        ...(isActive !== undefined && { isActive }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(showOnPOS !== undefined && { showOnPOS }),
        ...(showOnline !== undefined && { showOnline }),
        ...(onlinePrice !== undefined && { onlinePrice: onlinePrice !== null ? new Prisma.Decimal(onlinePrice) : null }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(deletedAt !== undefined && { deletedAt: deletedAt ? new Date(deletedAt) : null }),
        // Tax
        ...(taxRate !== undefined && { taxRate: taxRate ?? null }),
        ...(isTaxExempt !== undefined && { isTaxExempt }),
        // Kitchen
        ...(prepTime !== undefined && { prepTime: prepTime ?? null }),
        ...(courseNumber !== undefined && { courseNumber: courseNumber ?? null }),
        ...(prepStationId !== undefined && { prepStationId: prepStationId || null }),
        // Inventory
        ...(trackInventory !== undefined && { trackInventory }),
        ...(lowStockAlert !== undefined && { lowStockAlert: lowStockAlert ?? null }),
        // Commission
        ...(commissionType !== undefined && { commissionType: commissionType || null }),
        ...(commissionValue !== undefined && { commissionValue: commissionValue ?? null }),
        // Availability
        ...(availableFrom !== undefined && { availableFrom: availableFrom || null }),
        ...(availableTo !== undefined && { availableTo: availableTo || null }),
        ...(availableDays !== undefined && { availableDays: availableDays || null }),
        // Seasonal date-based availability
        ...(availableFromDate !== undefined && { availableFromDate: availableFromDate ? new Date(availableFromDate) : null }),
        ...(availableUntilDate !== undefined && { availableUntilDate: availableUntilDate ? new Date(availableUntilDate) : null }),
        // Happy Hour
        ...(happyHourEnabled !== undefined && { happyHourEnabled }),
        ...(happyHourDiscount !== undefined && { happyHourDiscount: happyHourDiscount ?? null }),
        ...(happyHourStart !== undefined && { happyHourStart: happyHourStart || null }),
        ...(happyHourEnd !== undefined && { happyHourEnd: happyHourEnd || null }),
        ...(happyHourDays !== undefined && { happyHourDays: happyHourDays || null }),
        // Pour size options
        ...(pourSizes !== undefined && { pourSizes: pourSizes || null }),
        ...(defaultPourSize !== undefined && { defaultPourSize: defaultPourSize || null }),
        ...(applyPourToModifiers !== undefined && { applyPourToModifiers }),
        // Printer routing - arrays of printer IDs
        ...(printerIds !== undefined && {
          printerIds: printerIds && printerIds.length > 0 ? printerIds : null
        }),
        ...(backupPrinterIds !== undefined && {
          backupPrinterIds: backupPrinterIds && backupPrinterIds.length > 0 ? backupPrinterIds : null
        }),
        // Combo print mode
        ...(comboPrintMode !== undefined && { comboPrintMode: comboPrintMode || null }),
        // Linked bottle product
        ...(linkedBottleProductId !== undefined && { linkedBottleProductId: linkedBottleProductId || null }),
        ...(linkedPourSizeOz !== undefined && { linkedPourSizeOz: linkedPourSizeOz !== null ? new Prisma.Decimal(linkedPourSizeOz) : null }),
        // Weight-Based Selling
        ...(soldByWeight !== undefined && { soldByWeight }),
        ...(weightUnit !== undefined && { weightUnit: weightUnit || null }),
        ...(pricePerWeightUnit !== undefined && { pricePerWeightUnit: pricePerWeightUnit !== null ? new Prisma.Decimal(pricePerWeightUnit) : null }),
        // Entertainment / timed rental fields
        ...(timedPricing !== undefined && { timedPricing: timedPricing || Prisma.DbNull }),
        ...(ratePerMinute !== undefined && { ratePerMinute: ratePerMinute !== null ? new Prisma.Decimal(ratePerMinute) : null }),
        ...(minimumCharge !== undefined && { minimumCharge: minimumCharge !== null ? new Prisma.Decimal(minimumCharge) : null }),
        ...(incrementMinutes !== undefined && { incrementMinutes: incrementMinutes ?? null }),
        ...(graceMinutes !== undefined && { graceMinutes: graceMinutes ?? null }),
        ...(blockTimeMinutes !== undefined && { blockTimeMinutes: blockTimeMinutes ?? null }),
        ...(entertainmentStatus !== undefined && { entertainmentStatus: entertainmentStatus || null }),
        // Overtime pricing for block-time entertainment
        ...(overtimeEnabled !== undefined && { overtimeEnabled }),
        ...(overtimeMode !== undefined && { overtimeMode: overtimeMode || null }),
        ...(overtimeMultiplier !== undefined && { overtimeMultiplier: overtimeMultiplier ?? null }),
        ...(overtimePerMinuteRate !== undefined && { overtimePerMinuteRate: overtimePerMinuteRate ?? null }),
        ...(overtimeFlatFee !== undefined && { overtimeFlatFee: overtimeFlatFee ?? null }),
        ...(overtimeGraceMinutes !== undefined && { overtimeGraceMinutes: overtimeGraceMinutes ?? null }),
        // Allergen tracking
        ...(allergens !== undefined && { allergens: Array.isArray(allergens) ? allergens : [] }),
        // Age verification
        ...(isAgeRestricted !== undefined && { isAgeRestricted }),
        // Force-open modifier modal
        ...(alwaysOpenModifiers !== undefined && { alwaysOpenModifiers }),
        // Tip-exempt
        ...(tipExempt !== undefined && { tipExempt }),
        // Nutritional info — columns not yet in schema, skip to avoid Prisma validation error
      }
    })

    // Invalidate server-side menu cache
    invalidateMenuCache(item.locationId)

    // Fire-and-forget socket dispatch for real-time menu updates
    void dispatchMenuUpdate(item.locationId, { action: 'updated' }).catch(() => {})

    // Dispatch socket events for real-time updates
    const action = deletedAt ? 'deleted' : (item.deletedAt === null && deletedAt === undefined) ? 'updated' : 'restored'

    // Dispatch item changed event
    dispatchMenuItemChanged(item.locationId, {
      itemId: item.id,
      action,
      changes: {
        name: item.name,
        price: Number(item.price),
        isActive: item.isActive,
        isAvailable: item.isAvailable,
      }
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch menu item changed event:', err)
    })

    // If stock status changed (isAvailable), dispatch stock change event
    if (oldItem && isAvailable !== undefined && oldItem.isAvailable !== isAvailable) {
      const stockStatus = isAvailable ? 'in_stock' : 'out_of_stock'
      dispatchMenuStockChanged(item.locationId, {
        itemId: item.id,
        stockStatus,
        isOrderableOnline: computeIsOrderableOnline({
          showOnline: item.showOnline,
          isAvailable: item.isAvailable,
          availableFrom: item.availableFrom,
          availableTo: item.availableTo,
          availableDays: item.availableDays,
          currentStock: item.currentStock,
          trackInventory: item.trackInventory,
          lowStockAlert: item.lowStockAlert,
        }),
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch stock changed event:', err)
      })
    }

    // Notify cloud → NUC sync for real-time updates
    void notifyDataChanged({ locationId: item.locationId, domain: 'menu', action: 'updated', entityId: item.id })

    return NextResponse.json({ data: {
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      price: Number(item.price),
      priceCC: item.priceCC ? Number(item.priceCC) : null,
      onlinePrice: item.onlinePrice !== null ? Number(item.onlinePrice) : null,
      description: item.description,
      isActive: item.isActive,
      isAvailable: item.isAvailable,
      commissionType: item.commissionType,
      commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
      availableFrom: item.availableFrom,
      availableTo: item.availableTo,
      availableDays: item.availableDays,
      pourSizes: item.pourSizes,
      defaultPourSize: item.defaultPourSize,
      applyPourToModifiers: item.applyPourToModifiers,
      printerIds: item.printerIds,
      backupPrinterIds: item.backupPrinterIds,
      comboPrintMode: item.comboPrintMode,
    } })
  } catch (error) {
    console.error('Failed to update item:', error)
    return NextResponse.json(
      { error: 'Failed to update item' },
      { status: 500 }
    )
  }
})

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get item info before deletion for socket dispatch
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const item = await db.menuItem.findFirst({
      where: { id, locationId },
      select: { locationId: true }
    })

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    await db.menuItem.update({ where: { id }, data: { deletedAt: new Date() } })

    // Invalidate server-side menu cache
    invalidateMenuCache(item.locationId)

    // Fire-and-forget socket dispatch for real-time menu updates
    void dispatchMenuUpdate(item.locationId, { action: 'deleted' }).catch(() => {})

    // Dispatch socket event for real-time update
    if (item) {
      dispatchMenuItemChanged(item.locationId, {
        itemId: id,
        action: 'deleted',
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch menu item deleted event:', err)
      })

      // Notify cloud → NUC sync for real-time updates
      void notifyDataChanged({ locationId: item.locationId, domain: 'menu', action: 'deleted', entityId: id })
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete item:', error)
    return NextResponse.json(
      { error: 'Failed to delete item' },
      { status: 500 }
    )
  }
})

// PATCH partial update (e.g. toggling isFeaturedCfd)
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const allowedFields: Record<string, true> = {
      isFeaturedCfd: true,
      entertainmentStatus: true,
    }
    const data: Record<string, unknown> = {}
    for (const key of Object.keys(body)) {
      if (allowedFields[key]) {
        data[key] = body[key]
      }
    }

    // When resetting entertainmentStatus to 'available', also clear linked order fields
    if (data.entertainmentStatus === 'available') {
      data.currentOrderId = null
      data.currentOrderItemId = null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const item = await db.menuItem.update({
      where: { id },
      data,
      select: { id: true, name: true, isFeaturedCfd: true, entertainmentStatus: true },
    })

    return NextResponse.json({ data: { item } })
  } catch (error) {
    console.error('Failed to patch menu item:', error)
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
})

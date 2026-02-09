import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, mergeWithDefaults, LocationSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// Category types that map to liquor/food tax-inclusive flags
const LIQUOR_CATEGORY_TYPES = ['liquor', 'drinks']
const FOOD_CATEGORY_TYPES = ['food', 'pizza', 'combos']

// GET location settings
export async function GET() {
  try {
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 404 }
      )
    }

    const settings = parseSettings(location.settings)

    // Derive taxInclusiveLiquor/taxInclusiveFood from TaxRule records
    const [taxRules, categories] = await Promise.all([
      db.taxRule.findMany({
        where: { locationId: location.id, isActive: true, isInclusive: true, deletedAt: null },
        select: { appliesTo: true, categoryIds: true },
      }),
      db.category.findMany({
        where: { locationId: location.id, deletedAt: null },
        select: { id: true, categoryType: true },
      }),
    ])

    // Check if any inclusive rule covers liquor or food categories
    let taxInclusiveLiquor = false
    let taxInclusiveFood = false

    for (const rule of taxRules) {
      if (rule.appliesTo === 'all') {
        // An "all items" inclusive rule makes everything inclusive
        taxInclusiveLiquor = true
        taxInclusiveFood = true
        break
      }
      if (rule.appliesTo === 'category' && rule.categoryIds) {
        const ruleCategories = rule.categoryIds as string[]
        for (const cat of categories) {
          if (ruleCategories.includes(cat.id)) {
            if (cat.categoryType && LIQUOR_CATEGORY_TYPES.includes(cat.categoryType)) {
              taxInclusiveLiquor = true
            }
            if (cat.categoryType && FOOD_CATEGORY_TYPES.includes(cat.categoryType)) {
              taxInclusiveFood = true
            }
          }
        }
      }
    }

    // Inject derived tax-inclusive flags into settings
    settings.tax = {
      ...settings.tax,
      taxInclusiveLiquor,
      taxInclusiveFood,
    }

    return NextResponse.json({
      locationId: location.id,
      locationName: location.name,
      settings,
    })
  } catch (error) {
    console.error('Failed to fetch settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

// PUT update location settings
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { settings, employeeId } = body as { settings: Partial<LocationSettings>; employeeId?: string }

    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 404 }
      )
    }

    // Auth: editing settings requires admin.manage_settings
    if (employeeId) {
      const auth = await requirePermission(employeeId, location.id, PERMISSIONS.ADMIN)
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
    }

    // Validate dual pricing: cashDiscountPercent must be 0-10%
    if (settings.dualPricing?.cashDiscountPercent !== undefined) {
      const pct = settings.dualPricing.cashDiscountPercent
      if (pct < 0 || pct > 10) {
        return NextResponse.json(
          { error: 'cashDiscountPercent must be between 0 and 10' },
          { status: 400 }
        )
      }
    }

    // Get current settings and merge with updates
    const currentSettings = parseSettings(location.settings)
    const updatedSettings = mergeWithDefaults({
      ...currentSettings,
      ...settings,
      // Deep merge for nested objects
      tax: { ...currentSettings.tax, ...(settings.tax || {}) },
      dualPricing: { ...currentSettings.dualPricing, ...(settings.dualPricing || {}) },
      priceRounding: { ...currentSettings.priceRounding, ...(settings.priceRounding || {}) },
      tips: { ...currentSettings.tips, ...(settings.tips || {}) },
      tipShares: { ...currentSettings.tipShares, ...(settings.tipShares || {}) },
      receipts: { ...currentSettings.receipts, ...(settings.receipts || {}) },
      loyalty: { ...currentSettings.loyalty, ...(settings.loyalty || {}) },
      barTabs: { ...currentSettings.barTabs, ...(settings.barTabs || {}) },
    })

    // Update location
    await db.location.update({
      where: { id: location.id },
      data: {
        settings: updatedSettings as object,
      },
    })

    return NextResponse.json({
      locationId: location.id,
      settings: updatedSettings,
    })
  } catch (error) {
    console.error('Failed to update settings:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}

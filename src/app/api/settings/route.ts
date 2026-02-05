import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, mergeWithDefaults, LocationSettings } from '@/lib/settings'

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
    const { settings } = body as { settings: Partial<LocationSettings> }

    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 404 }
      )
    }

    // Get current settings and merge with updates
    const currentSettings = parseSettings(location.settings)
    const updatedSettings = mergeWithDefaults({
      ...currentSettings,
      ...settings,
      // Deep merge for nested objects
      tax: { ...currentSettings.tax, ...(settings.tax || {}) },
      dualPricing: { ...currentSettings.dualPricing, ...(settings.dualPricing || {}) },
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

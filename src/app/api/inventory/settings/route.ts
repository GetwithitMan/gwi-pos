import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

const DEFAULT_SETTINGS = {
  // Tracking mode
  trackingMode: 'usage_only',  // 'usage_only' = just track what goes out, 'full_tracking' = incoming + outgoing
  deductionTiming: 'on_send',  // 'on_send' = deduct when sent to kitchen, 'on_pay' = deduct when paid

  // Prep stock settings
  trackPrepStock: true,        // Track prep item stock levels
  deductPrepOnSend: true,      // Deduct prep stock when sent to kitchen
  restorePrepOnVoid: true,     // Restore prep stock when voided (if not made)

  // Count settings
  defaultCountFrequency: 'weekly',
  requireManagerReview: true,
  varianceAlertPct: 5,
  costChangeAlertPct: 10,
  defaultPourSizeOz: 1.5,
  exportEnabled: false,
  // Modifier instruction multipliers (industry standard defaults)
  multiplierLite: 0.5,   // "Lite" = 50% of standard amount
  multiplierExtra: 2.0,  // "Extra" = 200% of standard amount
  multiplierTriple: 3.0, // "Triple" = 300% of standard amount
}

// GET - Get inventory settings for location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const settings = await db.inventorySettings.findUnique({
      where: { locationId },
    })

    if (!settings) {
      // Return defaults if no settings exist
      return NextResponse.json({ data: {
        settings: {
          id: null,
          locationId,
          ...DEFAULT_SETTINGS,
          targetFoodCostPct: null,
          targetLiquorCostPct: null,
          countReminderDay: null,
          countReminderTime: null,
          exportTarget: null,
          exportApiKey: null,
          createdAt: null,
          updatedAt: null,
        },
        isDefault: true,
      } })
    }

    return NextResponse.json({ data: {
      settings: {
        ...settings,
        // Tracking mode
        trackingMode: settings.trackingMode || DEFAULT_SETTINGS.trackingMode,
        deductionTiming: settings.deductionTiming || DEFAULT_SETTINGS.deductionTiming,
        // Prep stock
        trackPrepStock: settings.trackPrepStock ?? DEFAULT_SETTINGS.trackPrepStock,
        deductPrepOnSend: settings.deductPrepOnSend ?? DEFAULT_SETTINGS.deductPrepOnSend,
        restorePrepOnVoid: settings.restorePrepOnVoid ?? DEFAULT_SETTINGS.restorePrepOnVoid,
        // Decimal fields
        varianceAlertPct: settings.varianceAlertPct
          ? Number(settings.varianceAlertPct)
          : DEFAULT_SETTINGS.varianceAlertPct,
        costChangeAlertPct: settings.costChangeAlertPct
          ? Number(settings.costChangeAlertPct)
          : DEFAULT_SETTINGS.costChangeAlertPct,
        defaultPourSizeOz: settings.defaultPourSizeOz
          ? Number(settings.defaultPourSizeOz)
          : DEFAULT_SETTINGS.defaultPourSizeOz,
        targetFoodCostPct: settings.targetFoodCostPct
          ? Number(settings.targetFoodCostPct)
          : null,
        targetLiquorCostPct: settings.targetLiquorCostPct
          ? Number(settings.targetLiquorCostPct)
          : null,
        // Modifier instruction multipliers
        multiplierLite: settings.multiplierLite
          ? Number(settings.multiplierLite)
          : DEFAULT_SETTINGS.multiplierLite,
        multiplierExtra: settings.multiplierExtra
          ? Number(settings.multiplierExtra)
          : DEFAULT_SETTINGS.multiplierExtra,
        multiplierTriple: settings.multiplierTriple
          ? Number(settings.multiplierTriple)
          : DEFAULT_SETTINGS.multiplierTriple,
      },
      isDefault: false,
    } })
  } catch (error) {
    console.error('Get inventory settings error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
})

// POST - Create or update inventory settings
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, ...settingsData } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {}
    const allowedFields = [
      // Tracking mode
      'trackingMode',
      'deductionTiming',
      // Prep stock
      'trackPrepStock',
      'deductPrepOnSend',
      'restorePrepOnVoid',
      // Count settings
      'defaultCountFrequency',
      'countReminderDay',
      'countReminderTime',
      'requireManagerReview',
      'exportEnabled',
      'exportTarget',
      'exportApiKey',
    ]

    for (const field of allowedFields) {
      if (settingsData[field] !== undefined) {
        updateData[field] = settingsData[field]
      }
    }

    const decimalFields = [
      'varianceAlertPct',
      'costChangeAlertPct',
      'defaultPourSizeOz',
      'targetFoodCostPct',
      'targetLiquorCostPct',
      'multiplierLite',
      'multiplierExtra',
      'multiplierTriple',
    ]
    for (const field of decimalFields) {
      if (settingsData[field] !== undefined) {
        updateData[field] = settingsData[field] === null ? null : Number(settingsData[field])
      }
    }

    // Upsert settings
    const settings = await db.inventorySettings.upsert({
      where: { locationId },
      create: {
        locationId,
        // Tracking mode
        trackingMode: DEFAULT_SETTINGS.trackingMode,
        deductionTiming: DEFAULT_SETTINGS.deductionTiming,
        // Prep stock
        trackPrepStock: DEFAULT_SETTINGS.trackPrepStock,
        deductPrepOnSend: DEFAULT_SETTINGS.deductPrepOnSend,
        restorePrepOnVoid: DEFAULT_SETTINGS.restorePrepOnVoid,
        // Count settings
        defaultCountFrequency: DEFAULT_SETTINGS.defaultCountFrequency,
        requireManagerReview: DEFAULT_SETTINGS.requireManagerReview,
        varianceAlertPct: DEFAULT_SETTINGS.varianceAlertPct,
        costChangeAlertPct: DEFAULT_SETTINGS.costChangeAlertPct,
        defaultPourSizeOz: DEFAULT_SETTINGS.defaultPourSizeOz,
        exportEnabled: DEFAULT_SETTINGS.exportEnabled,
        multiplierLite: DEFAULT_SETTINGS.multiplierLite,
        multiplierExtra: DEFAULT_SETTINGS.multiplierExtra,
        multiplierTriple: DEFAULT_SETTINGS.multiplierTriple,
        ...updateData,
      },
      update: updateData,
    })

    return NextResponse.json({ data: {
      settings: {
        ...settings,
        varianceAlertPct: settings.varianceAlertPct
          ? Number(settings.varianceAlertPct)
          : null,
        costChangeAlertPct: settings.costChangeAlertPct
          ? Number(settings.costChangeAlertPct)
          : null,
        defaultPourSizeOz: settings.defaultPourSizeOz
          ? Number(settings.defaultPourSizeOz)
          : null,
        targetFoodCostPct: settings.targetFoodCostPct
          ? Number(settings.targetFoodCostPct)
          : null,
        targetLiquorCostPct: settings.targetLiquorCostPct
          ? Number(settings.targetLiquorCostPct)
          : null,
        // Modifier instruction multipliers
        multiplierLite: settings.multiplierLite
          ? Number(settings.multiplierLite)
          : DEFAULT_SETTINGS.multiplierLite,
        multiplierExtra: settings.multiplierExtra
          ? Number(settings.multiplierExtra)
          : DEFAULT_SETTINGS.multiplierExtra,
        multiplierTriple: settings.multiplierTriple
          ? Number(settings.multiplierTriple)
          : DEFAULT_SETTINGS.multiplierTriple,
      },
    } })
  } catch (error) {
    console.error('Save inventory settings error:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
})

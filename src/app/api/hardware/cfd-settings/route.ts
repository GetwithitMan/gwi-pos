import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET CFD settings for a location
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const locationId = request.nextUrl.searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    const found = await db.cfdSettings.findFirst({ where: { locationId, deletedAt: null } })

    if (!found) {
      const defaultSettings = {
        id: null,
        locationId,
        tipMode: 'pre_tap',
        tipStyle: 'percent',
        tipOptions: '18,20,22,25',
        tipShowNoTip: true,
        signatureEnabled: true,
        signatureThresholdCents: 2500,
        receiptEmailEnabled: true,
        receiptSmsEnabled: true,
        receiptPrintEnabled: true,
        receiptTimeoutSeconds: 30,
        tabMode: 'token_only',
        tabPreAuthAmountCents: 100,
        idlePromoEnabled: false,
        idleWelcomeText: 'Welcome!',
      }
      return ok({ settings: defaultSettings })
    }

    return ok({ settings: found })
  } catch (error) {
    console.error('Failed to fetch CFD settings:', error)
    return err('Failed to fetch CFD settings', 500)
  }
}))

// PUT upsert CFD settings for a location
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      locationId,
      employeeId: bodyEmployeeId,
      tipMode,
      tipStyle,
      tipOptions,
      tipShowNoTip,
      signatureEnabled,
      signatureThresholdCents,
      receiptEmailEnabled,
      receiptSmsEnabled,
      receiptPrintEnabled,
      receiptTimeoutSeconds,
      tabMode,
      tabPreAuthAmountCents,
      idlePromoEnabled,
      idleWelcomeText,
    } = body

    if (!locationId) {
      return err('locationId is required')
    }

    // Auth check — require settings.hardware permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Validate tipMode if provided
    if (tipMode !== undefined && !['pre_tap', 'post_auth'].includes(tipMode)) {
      return err('tipMode must be one of: pre_tap, post_auth')
    }

    // Validate tipStyle if provided
    if (tipStyle !== undefined && !['percent', 'dollar'].includes(tipStyle)) {
      return err('tipStyle must be one of: percent, dollar')
    }

    // Validate tabMode if provided
    if (tabMode !== undefined && !['token_only', 'pre_auth', 'both'].includes(tabMode)) {
      return err('tabMode must be one of: token_only, pre_auth, both')
    }

    // Validate signatureThresholdCents if provided
    if (signatureThresholdCents !== undefined && signatureThresholdCents < 0) {
      return err('signatureThresholdCents must be >= 0')
    }

    // Validate receiptTimeoutSeconds if provided
    if (
      receiptTimeoutSeconds !== undefined &&
      (receiptTimeoutSeconds < 5 || receiptTimeoutSeconds > 300)
    ) {
      return err('receiptTimeoutSeconds must be between 5 and 300')
    }

    // Validate tabPreAuthAmountCents if provided
    if (tabPreAuthAmountCents !== undefined && tabPreAuthAmountCents < 0) {
      return err('tabPreAuthAmountCents must be >= 0')
    }

    // Build update data with only provided fields
    const data = {
      ...(tipMode !== undefined && { tipMode }),
      ...(tipStyle !== undefined && { tipStyle }),
      ...(tipOptions !== undefined && { tipOptions }),
      ...(tipShowNoTip !== undefined && { tipShowNoTip }),
      ...(signatureEnabled !== undefined && { signatureEnabled }),
      ...(signatureThresholdCents !== undefined && { signatureThresholdCents }),
      ...(receiptEmailEnabled !== undefined && { receiptEmailEnabled }),
      ...(receiptSmsEnabled !== undefined && { receiptSmsEnabled }),
      ...(receiptPrintEnabled !== undefined && { receiptPrintEnabled }),
      ...(receiptTimeoutSeconds !== undefined && { receiptTimeoutSeconds }),
      ...(tabMode !== undefined && { tabMode }),
      ...(tabPreAuthAmountCents !== undefined && { tabPreAuthAmountCents }),
      ...(idlePromoEnabled !== undefined && { idlePromoEnabled }),
      ...(idleWelcomeText !== undefined && { idleWelcomeText }),
    }

    const settings = await db.cfdSettings.upsert({
      where: { locationId },
      create: {
        locationId,
        ...data,
      },
      update: data,
    })

    void notifyDataChanged({ locationId, domain: 'cfd', action: 'updated', entityId: settings.id })
    void pushUpstream()

    return ok({ settings })
  } catch (error) {
    console.error('Failed to update CFD settings:', error)
    return err('Failed to update CFD settings', 500)
  }
}))

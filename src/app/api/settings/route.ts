import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, mergeWithDefaults, LocationSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitToLocation } from '@/lib/socket-server'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { invalidatePaymentSettings } from '@/lib/payment-settings-cache'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest } from '@/lib/api-auth'

// Category types that map to liquor/food tax-inclusive flags
const LIQUOR_CATEGORY_TYPES = ['liquor', 'drinks']
const FOOD_CATEGORY_TYPES = ['food', 'pizza', 'combos']

// ─── P1.2: SSRF guardrail for hotelPms.baseUrl ────────────────────────────────

function validatePmsBaseUrl(url: string): string | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return 'baseUrl must be a valid URL' }
  if (parsed.protocol !== 'https:') return 'baseUrl must use HTTPS'
  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    /^\[?::1\]?$/.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^192\.168\./.test(host)
  ) {
    return 'baseUrl must not point to a private or internal address'
  }
  return null
}

// GET location settings
export const GET = withVenue(async function GET() {
  try {
    // NOTE: This DB call fetches `name` which the location cache doesn't store.
    // Settings are already read from cache below via getLocationSettings().
    const location = await db.location.findFirst({ select: { id: true, name: true, updatedAt: true } })
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 404 }
      )
    }

    const settings = parseSettings(await getLocationSettings(location.id))

    // Derive taxInclusiveLiquor/taxInclusiveFood from TaxRule records
    // Also compute the effective non-inclusive tax rate by summing all active non-inclusive rules
    const [allTaxRules, categories] = await Promise.all([
      db.taxRule.findMany({
        where: { locationId: location.id, isActive: true, deletedAt: null },
        select: { appliesTo: true, categoryIds: true, isInclusive: true, rate: true },
      }),
      db.category.findMany({
        where: { locationId: location.id, deletedAt: null },
        select: { id: true, categoryType: true },
      }),
    ])

    const inclusiveTaxRules = allTaxRules.filter(r => r.isInclusive)
    const nonInclusiveTaxRules = allTaxRules.filter(r => !r.isInclusive)

    // Sum all non-inclusive rates (stored as decimals, e.g. 0.07 for 7%)
    const effectiveTaxRate = nonInclusiveTaxRules.reduce((sum, r) => sum + Number(r.rate), 0)

    // Check if any inclusive rule covers liquor or food categories
    let taxInclusiveLiquor = false
    let taxInclusiveFood = false

    for (const rule of inclusiveTaxRules) {
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

    // Inject derived tax flags + effective rate from TaxRule records
    // effectiveTaxRate is a decimal fraction (0.10 = 10%); defaultRate is stored as percent (10.0)
    settings.tax = {
      ...settings.tax,
      taxInclusiveLiquor,
      taxInclusiveFood,
      ...(effectiveTaxRate > 0 ? { defaultRate: effectiveTaxRate * 100 } : {}),
    }

    // P0.1: Never expose PMS or integration secrets to browser.
    // Strip secrets and replace with boolean "has*" flags so UI can show "✓ Configured"
    const responseSettings = settings as unknown as Record<string, unknown>
    if (responseSettings.hotelPms && typeof responseSettings.hotelPms === 'object') {
      const pms = responseSettings.hotelPms as Record<string, unknown>
      responseSettings.hotelPms = {
        ...pms,
        hasClientSecret: Boolean(pms.clientSecret),
        hasAppKey: Boolean(pms.appKey),
        clientSecret: '',
        appKey: '',
      }
    }
    if (responseSettings.marginEdge && typeof responseSettings.marginEdge === 'object') {
      const me = responseSettings.marginEdge as Record<string, unknown>
      responseSettings.marginEdge = {
        ...me,
        hasApiKey: Boolean(me.apiKey),
        apiKey: '',
      }
    }
    if (responseSettings.sevenShifts && typeof responseSettings.sevenShifts === 'object') {
      const ss = responseSettings.sevenShifts as Record<string, unknown>
      responseSettings.sevenShifts = {
        ...ss,
        hasClientSecret: Boolean(ss.clientSecret),
        hasWebhookSecret: Boolean(ss.webhookSecret),
        clientSecret: '',
        webhookSecret: '',
        accessToken: undefined,
        accessTokenExpiresAt: undefined,
      }
    }

    return NextResponse.json({ data: {
      locationId: location.id,
      locationName: location.name,
      settingsUpdatedAt: location.updatedAt?.toISOString() ?? null,
      settings: responseSettings,
    } })
  } catch (error) {
    console.error('Failed to fetch settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
})

// PUT update location settings
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { settings, employeeId: bodyEmployeeId } = body as { settings: Partial<LocationSettings>; employeeId?: string }

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 })
    }

    const location = await db.location.findFirst({ select: { id: true } })
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 404 }
      )
    }

    // H16: Prefer session-based employeeId over body-supplied value
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || bodyEmployeeId

    // Auth: editing settings requires settings.edit permission (or admin/all)
    const auth = await requirePermission(employeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // P1.2: SSRF guardrail — validate baseUrl before saving
    if (settings.hotelPms?.baseUrl) {
      const ssrfError = validatePmsBaseUrl(settings.hotelPms.baseUrl)
      if (ssrfError) {
        return NextResponse.json({ error: `Invalid Oracle PMS base URL: ${ssrfError}` }, { status: 400 })
      }
    }

    // Validate pricingRules array if provided
    if (settings.pricingRules !== undefined) {
      if (!Array.isArray(settings.pricingRules)) {
        return NextResponse.json({ error: 'pricingRules must be an array' }, { status: 400 })
      }
      if (settings.pricingRules.length > 500) {
        return NextResponse.json({ error: 'Maximum 500 pricing rules allowed' }, { status: 400 })
      }
      for (const rule of settings.pricingRules) {
        if (!rule || typeof rule !== 'object') {
          return NextResponse.json({ error: 'Invalid pricing rule entry' }, { status: 400 })
        }
        // Sanitize string fields — strip HTML tags
        if (typeof rule.name === 'string') rule.name = rule.name.replace(/<[^>]*>/g, '')
        if (typeof rule.badgeText === 'string') rule.badgeText = rule.badgeText.replace(/<[^>]*>/g, '')
        if (typeof rule.description === 'string') rule.description = rule.description.replace(/<[^>]*>/g, '')
        // Guard against NaN/Infinity in numeric fields
        if (typeof rule.adjustmentValue === 'number' && !isFinite(rule.adjustmentValue)) {
          return NextResponse.json({ error: `Pricing rule "${rule.name}" has invalid adjustment value` }, { status: 400 })
        }
        if (typeof rule.priority === 'number' && !isFinite(rule.priority)) {
          rule.priority = 10 // Fallback to default
        }
      }
    }

    // Validate dual pricing: cashDiscountPercent must be a finite number 0-100
    if (settings.dualPricing?.cashDiscountPercent !== undefined) {
      const pct = settings.dualPricing.cashDiscountPercent
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        return NextResponse.json(
          { error: 'Cash discount percent must be between 0 and 100' },
          { status: 400 }
        )
      }
    }

    // Validate dual pricing: creditMarkupPercent compliance cap
    if (
      (settings.pricingProgram?.model === 'dual_price' || settings.pricingProgram?.model === 'dual_price_pan_debit') &&
      settings.pricingProgram?.creditMarkupPercent !== undefined
    ) {
      const markup = settings.pricingProgram.creditMarkupPercent
      if (markup > 10) {
        return NextResponse.json(
          { error: 'Credit markup exceeds maximum allowed (10%)' },
          { status: 400 }
        )
      }
      if (markup > 4) {
        console.warn(
          `[settings] Dual pricing creditMarkupPercent=${markup}% exceeds 4% advisory threshold for location ${location.id}. ` +
          'High markups may draw scrutiny from card networks.'
        )
      }
    }

    // Validate surcharge pricing program: state legality + card network cap
    if (settings.pricingProgram?.model === 'surcharge' && settings.pricingProgram.enabled) {
      const { validateSurchargeCompliance } = await import('@/lib/pricing')
      const compliance = validateSurchargeCompliance(
        settings.pricingProgram.surchargePercent ?? 0,
        settings.pricingProgram.venueState
      )
      if (!compliance.valid) {
        return NextResponse.json(
          { error: compliance.errors.join(' ') },
          { status: 400 }
        )
      }
    }

    // Get current settings and deep-merge with updates
    // mergeWithDefaults() handles all nested objects including tipBank.tipGuide,
    // happyHour.schedules, and receiptDisplay sub-sections
    const currentSettings = parseSettings(await getLocationSettings(location.id))
    const updatedSettings = mergeWithDefaults({
      ...currentSettings,
      ...settings,
      // Deep merge for nested objects to prevent sibling field loss
      tax: { ...currentSettings.tax, ...(settings.tax || {}) },
      dualPricing: { ...currentSettings.dualPricing, ...(settings.dualPricing || {}) },
      priceRounding: { ...currentSettings.priceRounding, ...(settings.priceRounding || {}) },
      tips: { ...currentSettings.tips, ...(settings.tips || {}) },
      tipShares: { ...currentSettings.tipShares, ...(settings.tipShares || {}) },
      tipBank: { ...currentSettings.tipBank, ...(settings.tipBank || {}) },
      receipts: { ...currentSettings.receipts, ...(settings.receipts || {}) },
      payments: { ...currentSettings.payments, ...(settings.payments || {}) },
      loyalty: { ...currentSettings.loyalty, ...(settings.loyalty || {}) },
      happyHour: { ...currentSettings.happyHour, ...(settings.happyHour || {}) },
      barTabs: { ...currentSettings.barTabs, ...(settings.barTabs || {}) },
      clockOut: { ...currentSettings.clockOut, ...(settings.clockOut || {}) },
      businessDay: { ...currentSettings.businessDay, ...(settings.businessDay || {}) },
      posDisplay: { ...currentSettings.posDisplay, ...(settings.posDisplay || {}) },
      receiptDisplay: { ...currentSettings.receiptDisplay, ...(settings.receiptDisplay || {}) },
      hotelPms: settings.hotelPms !== undefined
        ? { ...(currentSettings.hotelPms ?? {}), ...settings.hotelPms }
        : currentSettings.hotelPms,
      loginMessages: settings.loginMessages !== undefined
        ? settings.loginMessages
        : currentSettings.loginMessages,
      training: settings.training !== undefined
        ? { ...(currentSettings.training ?? {}), ...settings.training }
        : currentSettings.training,
      accounting: settings.accounting !== undefined
        ? { ...(currentSettings.accounting ?? {}), ...settings.accounting, glMapping: { ...(currentSettings.accounting?.glMapping ?? {}), ...(settings.accounting?.glMapping ?? {}) } }
        : currentSettings.accounting,
      payrollExport: settings.payrollExport !== undefined
        ? { ...(currentSettings.payrollExport ?? {}), ...settings.payrollExport }
        : currentSettings.payrollExport,
      catering: settings.catering !== undefined
        ? { ...(currentSettings.catering ?? {}), ...settings.catering }
        : currentSettings.catering,
      entertainment: settings.entertainment !== undefined
        ? { ...(currentSettings.entertainment ?? {}), ...settings.entertainment }
        : currentSettings.entertainment,
      pricingRules: settings.pricingRules !== undefined
        ? settings.pricingRules
        : (currentSettings.pricingRules ?? []),
    })

    // P0.1: Preserve existing secrets — never overwrite with empty values.
    // The browser never receives these fields (GET strips them), so an empty
    // incoming value means "don't change the secret", not "clear it".
    let finalSettings = updatedSettings
    if (settings.hotelPms !== undefined && finalSettings.hotelPms) {
      const existingPms = currentSettings.hotelPms
      finalSettings = {
        ...finalSettings,
        hotelPms: {
          ...finalSettings.hotelPms,
          clientSecret: settings.hotelPms.clientSecret?.trim()
            ? settings.hotelPms.clientSecret
            : (existingPms?.clientSecret ?? ''),
          appKey: settings.hotelPms.appKey?.trim()
            ? settings.hotelPms.appKey
            : (existingPms?.appKey ?? ''),
        },
      }
    }

    // Update location
    await db.location.update({
      where: { id: location.id },
      data: {
        settings: finalSettings as object,
      },
    })

    // Invalidate settings caches after update
    invalidateLocationCache(location.id)
    invalidatePaymentSettings(location.id)

    // When cashDiscountPercent changes (or dual pricing is toggled on), recompute priceCC for all
    // menu items so card prices stay in sync without requiring manual item-by-item saves.
    const newPct = finalSettings.dualPricing?.cashDiscountPercent ?? 0
    const oldPct = currentSettings.dualPricing?.cashDiscountPercent ?? 0
    const dualNowEnabled = finalSettings.dualPricing?.enabled === true
    if (dualNowEnabled && newPct > 0 && newPct !== oldPct) {
      const multiplier = 1 + newPct / 100
      const items = await db.menuItem.findMany({
        where: { locationId: location.id, deletedAt: null, price: { gt: 0 } },
        select: { id: true, price: true },
      })
      await Promise.all(items.map(item =>
        db.menuItem.update({
          where: { id: item.id },
          data: { priceCC: Math.round(Number(item.price) * multiplier * 100) / 100 },
        })
      ))
    }

    // Notify cloud → NUC sync (cache-invalidate emits minimal payload)
    void notifyDataChanged({ locationId: location.id, domain: 'settings', action: 'updated' })

    // Emit full settings to terminals so Android can pick up changes (e.g. idleLockMinutes)
    void emitToLocation(location.id, 'settings:updated', { settings: finalSettings })

    // Emit CFD display settings to customer-facing displays so they update in real time
    if (finalSettings.cfdDisplay) {
      void emitToLocation(location.id, 'cfd:settings-updated', { cfdDisplay: finalSettings.cfdDisplay })
    }

    // P0.1: Strip secrets from response — same as GET handler.
    // The browser must never receive raw secrets in the PUT response either.
    const responseSettings = { ...finalSettings } as unknown as Record<string, unknown>
    if (responseSettings.hotelPms && typeof responseSettings.hotelPms === 'object') {
      const pms = responseSettings.hotelPms as Record<string, unknown>
      responseSettings.hotelPms = {
        ...pms,
        hasClientSecret: Boolean(pms.clientSecret),
        hasAppKey: Boolean(pms.appKey),
        clientSecret: '',
        appKey: '',
      }
    }
    if (responseSettings.marginEdge && typeof responseSettings.marginEdge === 'object') {
      const me = responseSettings.marginEdge as Record<string, unknown>
      responseSettings.marginEdge = {
        ...me,
        hasApiKey: Boolean(me.apiKey),
        apiKey: '',
      }
    }
    if (responseSettings.sevenShifts && typeof responseSettings.sevenShifts === 'object') {
      const ss = responseSettings.sevenShifts as Record<string, unknown>
      responseSettings.sevenShifts = {
        ...ss,
        hasClientSecret: Boolean(ss.clientSecret),
        hasWebhookSecret: Boolean(ss.webhookSecret),
        clientSecret: '',
        webhookSecret: '',
        accessToken: undefined,
        accessTokenExpiresAt: undefined,
      }
    }

    return NextResponse.json({ data: {
      locationId: location.id,
      settings: responseSettings,
    } })
  } catch (error) {
    console.error('Failed to update settings:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
})

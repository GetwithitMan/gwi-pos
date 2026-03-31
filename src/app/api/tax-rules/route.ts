import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { syncTaxRateToSettings } from '@/lib/api/tax-utils'
import { invalidateTaxCache } from '@/lib/tax-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { dispatchSettingsUpdated } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('tax-rules')

// GET - List tax rules
export const GET = withVenue(withAuth('SETTINGS_TAX', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID required')
    }

    const taxRules = await prisma.taxRule.findMany({
      where: { locationId },
      orderBy: { priority: 'asc' },
    })

    return ok({
      taxRules: taxRules.map(r => ({
        id: r.id,
        name: r.name,
        rate: Number(r.rate),
        ratePercent: Number(r.rate) * 100,
        appliesTo: r.appliesTo,
        categoryIds: r.categoryIds,
        itemIds: r.itemIds,
        isInclusive: r.isInclusive,
        priority: r.priority,
        isCompounded: r.isCompounded,
        isActive: r.isActive,
      })),
    })
  } catch (error) {
    console.error('Tax rules error:', error)
    return err('Failed to fetch tax rules', 500)
  }
}))

// POST - Create tax rule
export const POST = withVenue(withAuth('SETTINGS_TAX', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      rate,
      appliesTo,
      categoryIds,
      itemIds,
      isInclusive,
      priority,
      isCompounded,
    } = body

    if (!locationId || !name || rate === undefined) {
      return err('Location ID, name, and rate required')
    }

    const taxRule = await prisma.taxRule.create({
      data: {
        locationId,
        name,
        rate: rate / 100, // Convert percent to decimal
        appliesTo: appliesTo || 'all',
        categoryIds: categoryIds || null,
        itemIds: itemIds || null,
        isInclusive: isInclusive ?? false,
        priority: priority ?? 0,
        isCompounded: isCompounded ?? false,
      },
    })

    await syncTaxRateToSettings(locationId)
    invalidateTaxCache(locationId)

    // Emit settings:updated so all terminals refresh tax configuration
    void dispatchSettingsUpdated(locationId, { changedKeys: ['tax'] }).catch(err => log.warn({ err }, 'Background task failed'))

    void notifyDataChanged({ locationId, domain: 'tax', action: 'created', entityId: taxRule.id })
    void pushUpstream()

    return ok({
      taxRule: {
        id: taxRule.id,
        name: taxRule.name,
        rate: Number(taxRule.rate),
        ratePercent: Number(taxRule.rate) * 100,
        appliesTo: taxRule.appliesTo,
        isActive: taxRule.isActive,
      },
    })
  } catch (error) {
    console.error('Create tax rule error:', error)
    return err('Failed to create tax rule', 500)
  }
}))

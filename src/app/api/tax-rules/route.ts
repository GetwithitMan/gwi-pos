import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { syncTaxRateToSettings } from '@/lib/api/tax-utils'
import { invalidateTaxCache } from '@/lib/tax-cache'
import { emitToLocation } from '@/lib/socket-server'

// GET - List tax rules
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    // Auth check — require settings.tax permission
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_TAX)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const taxRules = await prisma.taxRule.findMany({
      where: { locationId },
      orderBy: { priority: 'asc' },
    })

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Tax rules error:', error)
    return NextResponse.json({ error: 'Failed to fetch tax rules' }, { status: 500 })
  }
})

// POST - Create tax rule
export const POST = withVenue(async function POST(request: NextRequest) {
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
      requestingEmployeeId,
    } = body

    // Auth check — require settings.tax permission
    const authCheck = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_TAX)
    if (!authCheck.authorized) return NextResponse.json({ error: authCheck.error }, { status: authCheck.status })

    if (!locationId || !name || rate === undefined) {
      return NextResponse.json({ error: 'Location ID, name, and rate required' }, { status: 400 })
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
    void emitToLocation(locationId, 'settings:updated', { trigger: 'tax-rule-created', taxRuleId: taxRule.id }).catch(console.error)

    return NextResponse.json({ data: {
      taxRule: {
        id: taxRule.id,
        name: taxRule.name,
        rate: Number(taxRule.rate),
        ratePercent: Number(taxRule.rate) * 100,
        appliesTo: taxRule.appliesTo,
        isActive: taxRule.isActive,
      },
    } })
  } catch (error) {
    console.error('Create tax rule error:', error)
    return NextResponse.json({ error: 'Failed to create tax rule' }, { status: 500 })
  }
})

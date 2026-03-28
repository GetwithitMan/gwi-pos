import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// GET - List all discount rules for a location
// No auth required — POS terminals need discount list for order screen
export const GET = withVenue(async function GET(
  request: NextRequest,
) {
  try {
    const searchParams = request.nextUrl.searchParams
    const activeOnly = searchParams.get('activeOnly') === 'true'
    const manualOnly = searchParams.get('manualOnly') === 'true'
    const employeeOnly = searchParams.get('employeeOnly') === 'true'

    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }

    const where: {
      locationId: string
      isActive?: boolean
      isAutomatic?: boolean
      isEmployeeDiscount?: boolean
    } = { locationId }

    if (activeOnly) {
      where.isActive = true
    }

    if (manualOnly) {
      where.isAutomatic = false
    }

    if (employeeOnly) {
      where.isEmployeeDiscount = true
    }

    const discounts = await db.discountRule.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { name: 'asc' },
      ],
    })

    return ok({
      discounts: discounts.map(d => ({
        id: d.id,
        name: d.name,
        displayText: d.displayText,
        description: d.description,
        discountType: d.discountType,
        discountConfig: d.discountConfig,
        triggerConfig: d.triggerConfig,
        scheduleConfig: d.scheduleConfig,
        priority: d.priority,
        isStackable: d.isStackable,
        requiresApproval: d.requiresApproval,
        maxPerOrder: d.maxPerOrder,
        isActive: d.isActive,
        isAutomatic: d.isAutomatic,
        isEmployeeDiscount: d.isEmployeeDiscount,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch discounts:', error)
    return err('Failed to fetch discounts', 500)
  }
})

// POST - Create a new discount rule
// Auth: session-verified employee with SETTINGS_MENU permission
export const POST = withVenue(withAuth('SETTINGS_MENU', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const body = await request.json()
    const {
      name,
      displayText,
      description,
      discountType,
      discountConfig,
      triggerConfig,
      scheduleConfig,
      priority,
      isStackable,
      requiresApproval,
      maxPerOrder,
      isActive,
      isAutomatic,
      isEmployeeDiscount,
    } = body as {
      name: string
      displayText: string
      description?: string
      discountType: string
      discountConfig: {
        type: 'percent' | 'fixed'
        value: number
        maxAmount?: number
      }
      triggerConfig?: object
      scheduleConfig?: object
      priority?: number
      isStackable?: boolean
      requiresApproval?: boolean
      maxPerOrder?: number
      isActive?: boolean
      isAutomatic?: boolean
      isEmployeeDiscount?: boolean
    }

    // Use verified locationId from session
    const locationId = ctx.auth.locationId

    if (!name || !displayText || !discountType || !discountConfig) {
      return err('Missing required fields')
    }

    const discount = await db.discountRule.create({
      data: {
        locationId,
        name,
        displayText,
        description: description || null,
        discountType,
        discountConfig,
        triggerConfig: triggerConfig || {},
        scheduleConfig: scheduleConfig || Prisma.JsonNull,
        priority: priority || 0,
        isStackable: isStackable ?? true,
        requiresApproval: requiresApproval ?? false,
        maxPerOrder: maxPerOrder || null,
        isActive: isActive ?? true,
        isAutomatic: isAutomatic ?? false,
        isEmployeeDiscount: isEmployeeDiscount ?? false,
      },
    })

    void notifyDataChanged({ locationId, domain: 'discounts', action: 'created', entityId: discount.id })
    void pushUpstream()

    return ok({
      id: discount.id,
      name: discount.name,
      displayText: discount.displayText,
      discountType: discount.discountType,
      discountConfig: discount.discountConfig,
      isActive: discount.isActive,
    })
  } catch (error) {
    console.error('Failed to create discount:', error)
    return err('Failed to create discount', 500)
  }
}))

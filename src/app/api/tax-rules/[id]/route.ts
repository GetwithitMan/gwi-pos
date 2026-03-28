import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { syncTaxRateToSettings } from '@/lib/api/tax-utils'
import { invalidateTaxCache } from '@/lib/tax-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { dispatchSettingsUpdated } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('tax-rules')

// GET - Get a single tax rule
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const taxRule = await prisma.taxRule.findUnique({ where: { id } })

    if (!taxRule) {
      return notFound('Tax rule not found')
    }

    return ok({
      taxRule: {
        id: taxRule.id,
        name: taxRule.name,
        rate: Number(taxRule.rate),
        ratePercent: Number(taxRule.rate) * 100,
        appliesTo: taxRule.appliesTo,
        categoryIds: taxRule.categoryIds,
        itemIds: taxRule.itemIds,
        isInclusive: taxRule.isInclusive,
        priority: taxRule.priority,
        isCompounded: taxRule.isCompounded,
        isActive: taxRule.isActive,
      },
    })
  } catch (error) {
    console.error('Failed to fetch tax rule:', error)
    return err('Failed to fetch tax rule', 500)
  }
})

// PUT - Update a tax rule
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await prisma.taxRule.findUnique({ where: { id } })
    if (!existing) {
      return notFound('Tax rule not found')
    }

    // Require settings.tax permission — modifying tax rules is a sensitive operation
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const authResult = await requirePermission(resolvedEmployeeId, existing.locationId, PERMISSIONS.SETTINGS_TAX)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

    const taxRule = await prisma.taxRule.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.rate !== undefined && { rate: body.rate / 100 }),
        ...(body.appliesTo !== undefined && { appliesTo: body.appliesTo }),
        ...(body.categoryIds !== undefined && { categoryIds: body.categoryIds }),
        ...(body.itemIds !== undefined && { itemIds: body.itemIds }),
        ...(body.isInclusive !== undefined && { isInclusive: body.isInclusive }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.isCompounded !== undefined && { isCompounded: body.isCompounded }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    })

    await syncTaxRateToSettings(existing.locationId)
    invalidateTaxCache(existing.locationId)

    // Emit settings:updated so all terminals refresh tax configuration
    void dispatchSettingsUpdated(existing.locationId, { changedKeys: ['tax'] }).catch(err => log.warn({ err }, 'Background task failed'))

    void notifyDataChanged({ locationId: existing.locationId, domain: 'tax', action: 'updated', entityId: taxRule.id })
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
    console.error('Failed to update tax rule:', error)
    return err('Failed to update tax rule', 500)
  }
})

// DELETE - Delete a tax rule
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const taxRule = await prisma.taxRule.findUnique({ where: { id } })
    if (!taxRule) {
      return notFound('Tax rule not found')
    }

    // Require settings.tax permission — deleting tax rules is a sensitive operation
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? null
    const authResult = await requirePermission(resolvedEmployeeId, taxRule.locationId, PERMISSIONS.SETTINGS_TAX)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

    await prisma.taxRule.update({ where: { id }, data: { deletedAt: new Date() } })
    await syncTaxRateToSettings(taxRule.locationId)
    invalidateTaxCache(taxRule.locationId)

    // Emit settings:updated so all terminals refresh tax configuration
    void dispatchSettingsUpdated(taxRule.locationId, { changedKeys: ['tax'] }).catch(err => log.warn({ err }, 'Background task failed'))

    void notifyDataChanged({ locationId: taxRule.locationId, domain: 'tax', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete tax rule:', error)
    return err('Failed to delete tax rule', 500)
  }
})

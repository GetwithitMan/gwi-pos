/**
 * Tip Group Template [id] API (Skill 285)
 *
 * GET    - Get single template
 * PUT    - Update template
 * DELETE - Soft delete template
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET: Single template ────────────────────────────────────────────────────

export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const locationId = request.nextUrl.searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Auth check
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_MANAGE_RULES
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const template = await db.tipGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!template) {
      return notFound('Template not found')
    }

    return ok({
        id: template.id,
        locationId: template.locationId,
        name: template.name,
        allowedRoleIds: template.allowedRoleIds as string[],
        defaultSplitMode: template.defaultSplitMode,
        active: template.active,
        sortOrder: template.sortOrder,
      })
  } catch (error) {
    console.error('Failed to get tip group template:', error)
    return err('Failed to get tip group template', 500)
  }
}))

// ─── PUT: Update template ────────────────────────────────────────────────────

export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const { locationId, name, allowedRoleIds, defaultSplitMode, active, sortOrder } = body as {
      locationId: string
      name?: string
      allowedRoleIds?: string[]
      defaultSplitMode?: string
      active?: boolean
      sortOrder?: number
    }

    if (!locationId) {
      return err('locationId is required')
    }

    // Auth check
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_MANAGE_RULES
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const existing = await db.tipGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Template not found')
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (allowedRoleIds !== undefined) updateData.allowedRoleIds = allowedRoleIds
    if (defaultSplitMode !== undefined) updateData.defaultSplitMode = defaultSplitMode
    if (active !== undefined) updateData.active = active
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder

    const template = await db.tipGroupTemplate.update({
      where: { id },
      data: { ...updateData, lastMutatedBy: 'cloud' },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroupTemplate', locationId, id, 'UPDATE')
    } catch (caughtErr) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    return ok({
        id: template.id,
        locationId: template.locationId,
        name: template.name,
        allowedRoleIds: template.allowedRoleIds as string[],
        defaultSplitMode: template.defaultSplitMode,
        active: template.active,
        sortOrder: template.sortOrder,
      })
  } catch (error) {
    console.error('Failed to update tip group template:', error)
    return err('Failed to update tip group template', 500)
  }
}))

// ─── DELETE: Soft delete template ────────────────────────────────────────────

export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const locationId = request.nextUrl.searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Auth check
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_MANAGE_RULES
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const existing = await db.tipGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return notFound('Template not found')
    }

    await db.tipGroupTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: 'cloud' },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroupTemplate', locationId, id, 'DELETE')
    } catch (caughtErr) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete tip group template:', error)
    return err('Failed to delete tip group template', 500)
  }
}))

/**
 * Tip Group Templates API (Skill 285)
 *
 * GET  - List all templates for a location
 * POST - Create a new template
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { TipGroupSplitMode } from '@/generated/prisma/client'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { created, err, ok } from '@/lib/api-response'

// ─── GET: List templates ─────────────────────────────────────────────────────

export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

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

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }
    if (!includeInactive) {
      where.active = true
    }

    const templates = await db.tipGroupTemplate.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    })

    return ok(templates.map(t => ({
        id: t.id,
        locationId: t.locationId,
        name: t.name,
        allowedRoleIds: t.allowedRoleIds as string[],
        defaultSplitMode: t.defaultSplitMode,
        active: t.active,
        sortOrder: t.sortOrder,
      })))
  } catch (error) {
    console.error('Failed to list tip group templates:', error)
    return err('Failed to list tip group templates', 500)
  }
}))

// ─── POST: Create template ───────────────────────────────────────────────────

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, allowedRoleIds, defaultSplitMode, active } = body as {
      locationId: string
      name: string
      allowedRoleIds?: string[]
      defaultSplitMode?: string
      active?: boolean
    }

    if (!locationId || !name?.trim()) {
      return err('locationId and name are required')
    }

    if (allowedRoleIds !== undefined && !Array.isArray(allowedRoleIds)) {
      return err('allowedRoleIds must be an array')
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

    // Get next sort order
    const maxSort = await db.tipGroupTemplate.aggregate({
      where: { locationId, deletedAt: null },
      _max: { sortOrder: true },
    })
    const nextSort = (maxSort._max.sortOrder ?? -1) + 1

    const template = await db.tipGroupTemplate.create({
      data: {
        locationId,
        name: name.trim(),
        allowedRoleIds: allowedRoleIds ?? [],
        defaultSplitMode: (defaultSplitMode ?? 'equal') as TipGroupSplitMode,
        active: active ?? true,
        sortOrder: nextSort,
        lastMutatedBy: 'cloud',
      },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('TipGroupTemplate', locationId, template.id, 'INSERT')
    } catch (caughtErr) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    return created({
        id: template.id,
        locationId: template.locationId,
        name: template.name,
        allowedRoleIds: template.allowedRoleIds as string[],
        defaultSplitMode: template.defaultSplitMode,
        active: template.active,
        sortOrder: template.sortOrder,
      })
  } catch (error) {
    console.error('Failed to create tip group template:', error)
    return err('Failed to create tip group template', 500)
  }
}))

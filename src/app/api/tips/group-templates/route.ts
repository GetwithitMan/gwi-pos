/**
 * Tip Group Templates API (Skill 285)
 *
 * GET  - List all templates for a location
 * POST - Create a new template
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TipGroupSplitMode } from '@prisma/client'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// ─── GET: List templates ─────────────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Auth check
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_MANAGE_RULES
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
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

    return NextResponse.json({
      data: templates.map(t => ({
        id: t.id,
        locationId: t.locationId,
        name: t.name,
        allowedRoleIds: t.allowedRoleIds as string[],
        defaultSplitMode: t.defaultSplitMode,
        active: t.active,
        sortOrder: t.sortOrder,
      })),
    })
  } catch (error) {
    console.error('Failed to list tip group templates:', error)
    return NextResponse.json(
      { error: 'Failed to list tip group templates' },
      { status: 500 }
    )
  }
})

// ─── POST: Create template ───────────────────────────────────────────────────

export const POST = withVenue(async function POST(request: NextRequest) {
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
      return NextResponse.json(
        { error: 'locationId and name are required' },
        { status: 400 }
      )
    }

    if (allowedRoleIds !== undefined && !Array.isArray(allowedRoleIds)) {
      return NextResponse.json(
        { error: 'allowedRoleIds must be an array' },
        { status: 400 }
      )
    }

    // Auth check
    const requestingEmployeeId = request.headers.get('x-employee-id')
    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_MANAGE_RULES
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      )
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
      },
    })

    return NextResponse.json({
      data: {
        id: template.id,
        locationId: template.locationId,
        name: template.name,
        allowedRoleIds: template.allowedRoleIds as string[],
        defaultSplitMode: template.defaultSplitMode,
        active: template.active,
        sortOrder: template.sortOrder,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Failed to create tip group template:', error)
    return NextResponse.json(
      { error: 'Failed to create tip group template' },
      { status: 500 }
    )
  }
})

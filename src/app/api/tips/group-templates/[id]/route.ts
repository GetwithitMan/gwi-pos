/**
 * Tip Group Template [id] API (Skill 285)
 *
 * GET    - Get single template
 * PUT    - Update template
 * DELETE - Soft delete template
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET: Single template ────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const locationId = request.nextUrl.searchParams.get('locationId')

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

    const template = await db.tipGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

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
    })
  } catch (error) {
    console.error('Failed to get tip group template:', error)
    return NextResponse.json(
      { error: 'Failed to get tip group template' },
      { status: 500 }
    )
  }
}

// ─── PUT: Update template ────────────────────────────────────────────────────

export async function PUT(request: NextRequest, context: RouteContext) {
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

    const existing = await db.tipGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (allowedRoleIds !== undefined) updateData.allowedRoleIds = allowedRoleIds
    if (defaultSplitMode !== undefined) updateData.defaultSplitMode = defaultSplitMode
    if (active !== undefined) updateData.active = active
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder

    const template = await db.tipGroupTemplate.update({
      where: { id },
      data: updateData,
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
    })
  } catch (error) {
    console.error('Failed to update tip group template:', error)
    return NextResponse.json(
      { error: 'Failed to update tip group template' },
      { status: 500 }
    )
  }
}

// ─── DELETE: Soft delete template ────────────────────────────────────────────

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const locationId = request.nextUrl.searchParams.get('locationId')

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

    const existing = await db.tipGroupTemplate.findFirst({
      where: { id, locationId, deletedAt: null },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    await db.tipGroupTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete tip group template:', error)
    return NextResponse.json(
      { error: 'Failed to delete tip group template' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/berg/plu-mappings/[id] — get a single PLU mapping
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const mapping = await db.bergPluMapping.findFirst({
      where: { id, locationId },
    })

    if (!mapping) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
    }

    return NextResponse.json({ mapping })
  } catch (err) {
    console.error('[berg/plu-mappings/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to load mapping' }, { status: 500 })
  }
})

// PUT /api/berg/plu-mappings/[id] — update a PLU mapping
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, deviceId, description, bottleProductId, inventoryItemId, menuItemId, pourSizeOzOverride, modifierRule, trailerRule, isActive } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const requestingEmployeeId = body.requestingEmployeeId || body.employeeId || ''
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const existing = await db.bergPluMapping.findFirst({ where: { id, locationId } })
    if (!existing) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (description !== undefined) updateData.description = description
    if (bottleProductId !== undefined) updateData.bottleProductId = bottleProductId || null
    if (inventoryItemId !== undefined) updateData.inventoryItemId = inventoryItemId || null
    if (menuItemId !== undefined) updateData.menuItemId = menuItemId || null
    if (pourSizeOzOverride !== undefined) updateData.pourSizeOzOverride = pourSizeOzOverride ? String(pourSizeOzOverride) : null
    if (modifierRule !== undefined) updateData.modifierRule = modifierRule || null
    if (trailerRule !== undefined) updateData.trailerRule = trailerRule || null
    if (isActive !== undefined) updateData.isActive = Boolean(isActive)
    if (deviceId !== undefined) {
      updateData.deviceId = deviceId || null
      updateData.mappingScopeKey = deviceId ? `device:${deviceId}` : `location:${locationId}`
    }

    const mapping = await db.bergPluMapping.update({ where: { id }, data: updateData })
    return NextResponse.json({ mapping })
  } catch (err) {
    console.error('[berg/plu-mappings/[id] PUT]', err)
    return NextResponse.json({ error: 'Failed to update mapping' }, { status: 500 })
  }
})

// DELETE /api/berg/plu-mappings/[id] — delete a PLU mapping
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const existing = await db.bergPluMapping.findFirst({ where: { id, locationId } })
    if (!existing) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
    }

    await db.bergPluMapping.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[berg/plu-mappings/[id] DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete mapping' }, { status: 500 })
  }
})

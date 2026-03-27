import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest, clearPermissionCache } from '@/lib/api-auth'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('employees-permission-overrides')

// GET - List all permission overrides for an employee
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    // Auth check — require staff.manage_roles to view overrides
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const overrides = await db.employeePermissionOverride.findMany({
      where: { employeeId, locationId },
      orderBy: { permissionKey: 'asc' },
    })

    return NextResponse.json({ data: overrides })
  } catch (error) {
    console.error('Failed to fetch permission overrides:', error)
    return NextResponse.json({ error: 'Failed to fetch permission overrides' }, { status: 500 })
  }
})

// POST - Add or update a permission override
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const body = await request.json()
    const { permissionKey, allowed, reason } = body as {
      permissionKey?: string
      allowed?: boolean
      reason?: string
    }

    const locationId = body.locationId || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    // Validate required fields
    if (!permissionKey || typeof permissionKey !== 'string') {
      return NextResponse.json({ error: 'permissionKey is required and must be a string' }, { status: 400 })
    }
    if (typeof allowed !== 'boolean') {
      return NextResponse.json({ error: 'allowed is required and must be a boolean' }, { status: 400 })
    }

    // Sanitize permissionKey — must be a dotted key, no HTML
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(permissionKey)) {
      return NextResponse.json({ error: 'Invalid permission key format' }, { status: 400 })
    }

    // Auth check — require staff.manage_roles
    const actor = await getActorFromRequest(request)
    const resolvedActorId = actor.employeeId ?? body.requestingEmployeeId
    const auth = await requirePermission(resolvedActorId, locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Verify employee exists and belongs to this location
    const employee = await db.employee.findFirst({
      where: { id: employeeId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Upsert override (unique on employeeId + permissionKey)
    const override = await db.employeePermissionOverride.upsert({
      where: {
        employeeId_permissionKey: { employeeId, permissionKey },
      },
      create: {
        locationId,
        employeeId,
        permissionKey,
        allowed,
        reason: reason || null,
        setBy: auth.employee.id,
      },
      update: {
        allowed,
        reason: reason || null,
        setBy: auth.employee.id,
      },
    })

    pushUpstream()

    // Audit log: track permission override changes
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: resolvedActorId || 'unknown',
        action: allowed ? 'permission_override_granted' : 'permission_override_denied',
        entityType: 'employee',
        entityId: employeeId,
        details: { permissionKey, allowed, reason: reason || null },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))
    clearPermissionCache(employeeId)

    // Notify cross-terminal — permission override changed, so terminals must re-evaluate cached permissions
    void emitToLocation(locationId, 'employees:changed', { action: 'updated', employeeId, permissionsChanged: true }).catch(err => log.warn({ err }, 'socket emit failed'))
    void emitToLocation(locationId, 'employee:updated', { action: 'updated', employeeId, permissionsChanged: true }).catch(err => log.warn({ err }, 'socket emit failed'))

    return NextResponse.json({ data: override })
  } catch (error) {
    console.error('Failed to set permission override:', error)
    return NextResponse.json({ error: 'Failed to set permission override' }, { status: 500 })
  }
})

// DELETE - Remove a permission override
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const { searchParams } = new URL(request.url)
    const permissionKey = searchParams.get('permissionKey')
    const locationId = searchParams.get('locationId') || await getLocationId()

    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }
    if (!permissionKey) {
      return NextResponse.json({ error: 'permissionKey query parameter is required' }, { status: 400 })
    }

    // Auth check — require staff.manage_roles
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Hard delete: EmployeePermissionOverride has no deletedAt column
    try {
      await db.employeePermissionOverride.delete({
        where: {
          employeeId_permissionKey: { employeeId, permissionKey },
        },
      })
    } catch {
      // Record not found — treat as success (idempotent delete)
    }

    pushUpstream()

    // Audit log: track permission override removal
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: actor.employeeId || 'unknown',
        action: 'permission_override_removed',
        entityType: 'employee',
        entityId: employeeId,
        details: { permissionKey },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))
    clearPermissionCache(employeeId)

    // Notify cross-terminal — permission override removed, so terminals must re-evaluate cached permissions
    void emitToLocation(locationId, 'employees:changed', { action: 'updated', employeeId, permissionsChanged: true }).catch(err => log.warn({ err }, 'socket emit failed'))
    void emitToLocation(locationId, 'employee:updated', { action: 'updated', employeeId, permissionsChanged: true }).catch(err => log.warn({ err }, 'socket emit failed'))

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete permission override:', error)
    return NextResponse.json({ error: 'Failed to delete permission override' }, { status: 500 })
  }
})

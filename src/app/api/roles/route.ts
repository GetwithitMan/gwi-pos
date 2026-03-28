import { NextRequest } from 'next/server'
import { CashHandlingMode } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { withVenue } from '@/lib/with-venue'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { requirePermission } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, ok } from '@/lib/api-response'

// roleType/accessLevel: UX display metadata only — never used for authorization

// Helper to safely get permissions as an array
function getPermissionsArray(permissions: unknown): string[] {
  if (Array.isArray(permissions)) {
    return permissions
  }
  return []
}

// GET - List all roles for a location
// No auth check on read — role names/permissions are needed by employee dropdowns,
// tip settings, and other admin pages. Write operations (POST) require STAFF_MANAGE_ROLES.
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const roles = await db.role.findMany({
      where: { locationId },
      include: {
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Only expose the full permission catalog to users with STAFF_MANAGE_ROLES
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    let includePermissionCatalog = false
    if (requestingEmployeeId) {
      const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.STAFF_MANAGE_ROLES)
      includePermissionCatalog = auth.authorized
    }

    const responseData: Record<string, unknown> = {
      roles: roles.map(role => ({
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        roleType: role.roleType ?? 'FOH',
        accessLevel: role.accessLevel ?? 'STAFF',
        isTipped: role.isTipped,
        tipWeight: Number(role.tipWeight),
        cashHandlingMode: role.cashHandlingMode,
        trackLaborCost: role.trackLaborCost,
        employeeCount: role._count.employees,
        createdAt: role.createdAt.toISOString(),
      })),
    }

    // Include available permissions only for authorized role managers
    if (includePermissionCatalog) {
      responseData.availablePermissions = Object.entries(PERMISSIONS).map(([key, value]) => ({
        key,
        value,
        category: value.split('.')[0],
      }))
    }

    return ok(responseData)
  } catch (error) {
    console.error('Failed to fetch roles:', error)
    return err('Failed to fetch roles', 500)
  }
})

// POST - Create a new role
// Auth: session-verified employee with STAFF_MANAGE_ROLES permission
export const POST = withVenue(withAuth('STAFF_MANAGE_ROLES', async function POST(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const body = await request.json()
    const { name, permissions, cashHandlingMode, trackLaborCost, isTipped, tipWeight, roleType, accessLevel } = body as {
      name: string
      permissions: string[]
      cashHandlingMode?: string
      trackLaborCost?: boolean
      isTipped?: boolean
      tipWeight?: number
      roleType?: string
      accessLevel?: string
    }

    // Use verified locationId from session — ignore client-supplied locationId
    const locationId = ctx.auth.locationId

    if (!name) {
      return err('Role name is required')
    }

    // Check for duplicate role name
    const existing = await db.role.findFirst({
      where: {
        locationId,
        name: { equals: name },
      },
    })

    if (existing) {
      return err('A role with this name already exists', 409)
    }

    const role = await db.role.create({
      data: {
        locationId,
        name,
        permissions: permissions || [],
        ...(roleType ? { roleType } : {}),
        ...(accessLevel ? { accessLevel } : {}),
        ...(cashHandlingMode !== undefined ? { cashHandlingMode: cashHandlingMode as CashHandlingMode } : {}),
        ...(trackLaborCost !== undefined ? { trackLaborCost } : {}),
        ...(isTipped !== undefined ? { isTipped } : {}),
        ...(tipWeight !== undefined ? { tipWeight: Number(tipWeight) } : {}),
      },
    })

    void notifyDataChanged({ locationId, domain: 'roles', action: 'created', entityId: role.id })
    void pushUpstream()

    return ok({
      id: role.id,
      name: role.name,
      permissions: getPermissionsArray(role.permissions),
      roleType: role.roleType ?? 'FOH',
      accessLevel: role.accessLevel ?? 'STAFF',
      isTipped: role.isTipped,
      tipWeight: Number(role.tipWeight),
      cashHandlingMode: role.cashHandlingMode,
      trackLaborCost: role.trackLaborCost,
      createdAt: role.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create role:', error)
    return err('Failed to create role', 500)
  }
}))

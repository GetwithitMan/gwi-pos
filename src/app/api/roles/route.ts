import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'

// Helper to safely get permissions as an array
function getPermissionsArray(permissions: unknown): string[] {
  if (Array.isArray(permissions)) {
    return permissions
  }
  if (typeof permissions === 'string') {
    try {
      const parsed = JSON.parse(permissions)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

// GET - List all roles for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
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

    return NextResponse.json({
      roles: roles.map(role => ({
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        isTipped: role.isTipped,
        cashHandlingMode: role.cashHandlingMode,
        trackLaborCost: role.trackLaborCost,
        employeeCount: role._count.employees,
        createdAt: role.createdAt.toISOString(),
      })),
      // Include available permissions for UI
      availablePermissions: Object.entries(PERMISSIONS).map(([key, value]) => ({
        key,
        value,
        category: value.split('.')[0],
      })),
    })
  } catch (error) {
    console.error('Failed to fetch roles:', error)
    return NextResponse.json(
      { error: 'Failed to fetch roles' },
      { status: 500 }
    )
  }
}

// POST - Create a new role
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, permissions, cashHandlingMode, trackLaborCost, isTipped } = body as {
      locationId: string
      name: string
      permissions: string[]
      cashHandlingMode?: string
      trackLaborCost?: boolean
      isTipped?: boolean
    }

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate role name
    const existing = await db.role.findFirst({
      where: {
        locationId,
        name: { equals: name },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'A role with this name already exists' },
        { status: 409 }
      )
    }

    const role = await db.role.create({
      data: {
        locationId,
        name,
        permissions: permissions || [],
        ...(cashHandlingMode !== undefined ? { cashHandlingMode } : {}),
        ...(trackLaborCost !== undefined ? { trackLaborCost } : {}),
        ...(isTipped !== undefined ? { isTipped } : {}),
      },
    })

    return NextResponse.json({
      id: role.id,
      name: role.name,
      permissions: getPermissionsArray(role.permissions),
      isTipped: role.isTipped,
      cashHandlingMode: role.cashHandlingMode,
      trackLaborCost: role.trackLaborCost,
      createdAt: role.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create role:', error)
    return NextResponse.json(
      { error: 'Failed to create role' },
      { status: 500 }
    )
  }
}

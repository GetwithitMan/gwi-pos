import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

// GET - Get a single role by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const role = await db.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    })

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      role: {
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        employeeCount: role._count.employees,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch role:', error)
    return NextResponse.json(
      { error: 'Failed to fetch role' },
      { status: 500 }
    )
  }
}

// PUT - Update a role
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, permissions } = body as {
      name?: string
      permissions?: string[]
    }

    // Check role exists
    const existing = await db.role.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await db.role.findFirst({
        where: {
          locationId: existing.locationId,
          name: { equals: name },
          NOT: { id },
        },
      })

      if (duplicate) {
        return NextResponse.json(
          { error: 'A role with this name already exists' },
          { status: 409 }
        )
      }
    }

    const role = await db.role.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(permissions !== undefined && { permissions }),
      },
    })

    return NextResponse.json({
      role: {
        id: role.id,
        name: role.name,
        permissions: getPermissionsArray(role.permissions),
        updatedAt: role.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to update role:', error)
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    )
  }
}

// DELETE - Delete a role
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check role exists and get employee count
    const role = await db.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    })

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      )
    }

    // Prevent deletion if employees are assigned
    if (role._count.employees > 0) {
      return NextResponse.json(
        { error: `Cannot delete role with ${role._count.employees} assigned employee(s). Reassign them first.` },
        { status: 409 }
      )
    }

    await db.role.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete role:', error)
    return NextResponse.json(
      { error: 'Failed to delete role' },
      { status: 500 }
    )
  }
}

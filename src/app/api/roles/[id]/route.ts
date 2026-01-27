import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get role details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const role = await db.role.findUnique({
      where: { id },
      include: {
        employees: {
          where: { isActive: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
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
      id: role.id,
      name: role.name,
      permissions: role.permissions as string[],
      employees: role.employees.map(emp => ({
        id: emp.id,
        name: emp.displayName || `${emp.firstName} ${emp.lastName}`,
      })),
      createdAt: role.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to fetch role:', error)
    return NextResponse.json(
      { error: 'Failed to fetch role' },
      { status: 500 }
    )
  }
}

// PUT - Update role
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
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
        },
      })

      if (duplicate) {
        return NextResponse.json(
          { error: 'A role with this name already exists' },
          { status: 409 }
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (permissions !== undefined) updateData.permissions = permissions

    const role = await db.role.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { employees: true },
        },
      },
    })

    return NextResponse.json({
      id: role.id,
      name: role.name,
      permissions: role.permissions as string[],
      employeeCount: role._count.employees,
      updatedAt: role.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to update role:', error)
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    )
  }
}

// DELETE - Delete role
export async function DELETE(
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

    // Don't allow deleting role with active employees
    if (role._count.employees > 0) {
      return NextResponse.json(
        { error: `Cannot delete role with ${role._count.employees} assigned employee(s). Reassign them first.` },
        { status: 400 }
      )
    }

    await db.role.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete role:', error)
    return NextResponse.json(
      { error: 'Failed to delete role' },
      { status: 500 }
    )
  }
}

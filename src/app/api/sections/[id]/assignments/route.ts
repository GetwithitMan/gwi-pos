import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

// GET - List active assignments for this section
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sectionId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const assignments = await db.sectionAssignment.findMany({
      where: { sectionId, locationId, unassignedAt: null, deletedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { assignedAt: 'asc' },
    })

    return NextResponse.json({
      data: {
        assignments: assignments.map(a => ({
          id: a.id,
          employeeId: a.employee.id,
          employeeName: a.employee.displayName || `${a.employee.firstName} ${a.employee.lastName}`,
          roleName: a.employee.role.name,
          assignedAt: a.assignedAt,
        })),
      },
    })
  } catch (error) {
    console.error('[sections/[id]/assignments] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 })
  }
})

// POST - Assign an employee to this section
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sectionId } = await params
    const body = await request.json()
    const { locationId, employeeId, requestingEmployeeId } = body

    if (!locationId || !employeeId) {
      return NextResponse.json(
        { error: 'locationId and employeeId are required' },
        { status: 400 }
      )
    }

    const authEmployeeId = request.headers.get('x-employee-id') || requestingEmployeeId
    const auth = await requirePermission(authEmployeeId, locationId, PERMISSIONS.TABLES_FLOOR_PLAN)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, locationId, deletedAt: null },
      select: { id: true, name: true },
    })

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const employee = await db.employee.findFirst({
      where: { id: employeeId, locationId, isActive: true, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        role: { select: { id: true, name: true } },
      },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found or inactive' }, { status: 404 })
    }

    const existing = await db.sectionAssignment.findFirst({
      where: { sectionId, employeeId, locationId, unassignedAt: null, deletedAt: null },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Employee is already assigned to this section' },
        { status: 409 }
      )
    }

    const assignment = await db.sectionAssignment.create({
      data: {
        locationId,
        sectionId,
        employeeId,
      },
    })

    dispatchFloorPlanUpdate(locationId, { async: true })
    void notifyDataChanged({ locationId, domain: 'floorplan', action: 'updated', entityId: sectionId })

    return NextResponse.json({
      data: {
        assignment: {
          id: assignment.id,
          employeeId: employee.id,
          employeeName: employee.displayName || `${employee.firstName} ${employee.lastName}`,
          roleName: employee.role.name,
          assignedAt: assignment.assignedAt,
        },
      },
    })
  } catch (error) {
    console.error('[sections/[id]/assignments] POST error:', error)
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 })
  }
}))

// DELETE - Unassign an employee from this section (soft unassign)
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sectionId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = request.headers.get('x-employee-id') || searchParams.get('requestingEmployeeId')

    if (!locationId || !employeeId) {
      return NextResponse.json(
        { error: 'locationId and employeeId are required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.TABLES_FLOOR_PLAN)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, locationId, deletedAt: null },
      select: { id: true },
    })

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const assignment = await db.sectionAssignment.findFirst({
      where: { sectionId, employeeId, locationId, unassignedAt: null, deletedAt: null },
    })

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    await db.sectionAssignment.update({
      where: { id: assignment.id },
      data: { unassignedAt: new Date() },
    })

    dispatchFloorPlanUpdate(locationId, { async: true })
    void notifyDataChanged({ locationId, domain: 'floorplan', action: 'updated', entityId: sectionId })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[sections/[id]/assignments] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove assignment' }, { status: 500 })
  }
}))

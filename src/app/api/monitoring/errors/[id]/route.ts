/**
 * Error Detail & Resolution API
 *
 * GET /api/monitoring/errors/[id] - Get full error details
 * PUT /api/monitoring/errors/[id] - Update error (resolve, add notes, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================
// GET - Get Error Details
// ============================================

export const GET = withVenue(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const error = await db.errorLog.findUnique({
      where: { id },
      include: {
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    if (!error) {
      return NextResponse.json(
        { error: 'Error log not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: {
      success: true,
      error: {
        ...error,
        employee: error.employee ? {
          id: error.employee.id,
          name: error.employee.displayName || `${error.employee.firstName} ${error.employee.lastName}`,
        } : null,
      },
    } })

  } catch (error) {
    console.error('[Monitoring API] Failed to fetch error details:', error)

    return NextResponse.json(
      { error: 'Failed to fetch error details' },
      { status: 500 }
    )
  }
})

// ============================================
// PUT - Update Error
// ============================================

export const PUT = withVenue(async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    // Validate status if provided
    if (body.status) {
      const validStatuses = ['NEW', 'INVESTIGATING', 'RESOLVED', 'IGNORED']
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Build update data
    const updateData: any = {}

    if (body.status) {
      updateData.status = body.status

      // Auto-set resolvedAt when marking as RESOLVED
      if (body.status === 'RESOLVED' && !body.resolvedAt) {
        updateData.resolvedAt = new Date()
      }
    }

    if (body.resolution !== undefined) updateData.resolution = body.resolution
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.resolvedAt !== undefined) updateData.resolvedAt = body.resolvedAt ? new Date(body.resolvedAt) : null

    // Update error
    const updatedError = await db.errorLog.update({
      where: { id },
      data: updateData,
      include: {
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    return NextResponse.json({ data: {
      success: true,
      error: {
        ...updatedError,
        employee: updatedError.employee ? {
          id: updatedError.employee.id,
          name: updatedError.employee.displayName || `${updatedError.employee.firstName} ${updatedError.employee.lastName}`,
        } : null,
      },
    } })

  } catch (error) {
    console.error('[Monitoring API] Failed to update error:', error)

    return NextResponse.json(
      { error: 'Failed to update error' },
      { status: 500 }
    )
  }
})

// ============================================
// DELETE - Delete Error (Soft Delete)
// ============================================

export const DELETE = withVenue(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Soft delete (set deletedAt)
    await db.errorLog.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: {
      success: true,
      message: 'Error log deleted',
    } })

  } catch (error) {
    console.error('[Monitoring API] Failed to delete error:', error)

    return NextResponse.json(
      { error: 'Failed to delete error' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get a single order type
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const orderType = await db.orderType.findUnique({
      where: { id },
    })

    if (!orderType) {
      return NextResponse.json(
        { error: 'Order type not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ orderType })
  } catch (error) {
    console.error('Failed to fetch order type:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order type' },
      { status: 500 }
    )
  }
}

// PUT - Update an order type
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Find existing order type
    const existing = await db.orderType.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Order type not found' },
        { status: 404 }
      )
    }

    // System types have limited editability
    if (existing.isSystem) {
      // Only allow editing certain fields for system types
      const allowedSystemFields = [
        'name',
        'color',
        'icon',
        'sortOrder',
        'isActive',
        'kdsConfig',
        'printConfig',
      ]
      const updates: Record<string, unknown> = {}
      for (const field of allowedSystemFields) {
        if (body[field] !== undefined) {
          updates[field] = body[field]
        }
      }

      const orderType = await db.orderType.update({
        where: { id },
        data: updates,
      })

      return NextResponse.json({ orderType })
    }

    // For custom types, allow full editing except isSystem and slug
    const {
      name,
      description,
      color,
      icon,
      sortOrder,
      isActive,
      requiredFields,
      optionalFields,
      fieldDefinitions,
      workflowRules,
      kdsConfig,
      printConfig,
    } = body

    const orderType = await db.orderType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        ...(requiredFields !== undefined && { requiredFields }),
        ...(optionalFields !== undefined && { optionalFields }),
        ...(fieldDefinitions !== undefined && { fieldDefinitions }),
        ...(workflowRules !== undefined && { workflowRules }),
        ...(kdsConfig !== undefined && { kdsConfig }),
        ...(printConfig !== undefined && { printConfig }),
      },
    })

    return NextResponse.json({ orderType })
  } catch (error) {
    console.error('Failed to update order type:', error)
    return NextResponse.json(
      { error: 'Failed to update order type' },
      { status: 500 }
    )
  }
}

// DELETE - Delete an order type (soft delete via isActive=false for system types)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.orderType.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Order type not found' },
        { status: 404 }
      )
    }

    // System types can only be deactivated, not deleted
    if (existing.isSystem) {
      const orderType = await db.orderType.update({
        where: { id },
        data: { isActive: false },
      })
      return NextResponse.json({
        message: 'System order type deactivated',
        orderType,
      })
    }

    // Check if any orders use this type
    const ordersUsingType = await db.order.count({
      where: { orderTypeId: id },
    })

    if (ordersUsingType > 0) {
      // Soft delete if orders exist
      const orderType = await db.orderType.update({
        where: { id },
        data: { isActive: false },
      })
      return NextResponse.json({
        message: 'Order type deactivated (orders exist using this type)',
        orderType,
      })
    }

    // Hard delete if no orders use this type
    await db.orderType.delete({
      where: { id },
    })

    return NextResponse.json({
      message: 'Order type deleted',
      deleted: true,
    })
  } catch (error) {
    console.error('Failed to delete order type:', error)
    return NextResponse.json(
      { error: 'Failed to delete order type' },
      { status: 500 }
    )
  }
}

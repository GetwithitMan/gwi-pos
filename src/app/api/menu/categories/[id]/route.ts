import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, color, categoryType, categoryShow, printerIds } = body

    const category = await db.category.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(color && { color }),
        ...(categoryType && { categoryType }),
        ...(categoryShow && { categoryShow }),
        // Allow setting printerIds to null to clear it (empty array also becomes null)
        ...(printerIds !== undefined && {
          printerIds: printerIds && printerIds.length > 0 ? printerIds : null
        }),
      }
    })

    return NextResponse.json({
      id: category.id,
      name: category.name,
      color: category.color,
      categoryType: category.categoryType,
      categoryShow: category.categoryShow,
      isActive: category.isActive,
      printerIds: category.printerIds
    })
  } catch (error) {
    console.error('Failed to update category:', error)
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if category has items
    const itemCount = await db.menuItem.count({
      where: { categoryId: id }
    })

    if (itemCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category with items. Move or delete items first.' },
        { status: 400 }
      )
    }

    await db.category.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete category:', error)
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    )
  }
}

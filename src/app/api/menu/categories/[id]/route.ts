import { NextRequest, NextResponse } from 'next/server'
// import { db } from '@/lib/db'

// Shared in-memory store
let demoCategories = [
  { id: 'cat-1', name: 'Appetizers', color: '#ef4444', isActive: true },
  { id: 'cat-2', name: 'Entrees', color: '#3b82f6', isActive: true },
  { id: 'cat-3', name: 'Drinks', color: '#22c55e', isActive: true },
  { id: 'cat-4', name: 'Desserts', color: '#a855f7', isActive: true },
]

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, color } = body

    // Database version:
    // const category = await db.category.update({
    //   where: { id },
    //   data: { name, color }
    // })
    // return NextResponse.json(category)

    // Demo mode
    const index = demoCategories.findIndex(c => c.id === id)
    if (index === -1) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    demoCategories[index] = {
      ...demoCategories[index],
      name: name || demoCategories[index].name,
      color: color || demoCategories[index].color,
    }

    return NextResponse.json(demoCategories[index])
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

    // Database version:
    // await db.category.delete({ where: { id } })
    // return NextResponse.json({ success: true })

    // Demo mode
    const index = demoCategories.findIndex(c => c.id === id)
    if (index === -1) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    demoCategories.splice(index, 1)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete category:', error)
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    )
  }
}

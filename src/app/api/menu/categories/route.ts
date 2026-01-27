import { NextRequest, NextResponse } from 'next/server'
// import { db } from '@/lib/db'

// In-memory store for demo mode
let demoCategories = [
  { id: 'cat-1', name: 'Appetizers', color: '#ef4444', isActive: true },
  { id: 'cat-2', name: 'Entrees', color: '#3b82f6', isActive: true },
  { id: 'cat-3', name: 'Drinks', color: '#22c55e', isActive: true },
  { id: 'cat-4', name: 'Desserts', color: '#a855f7', isActive: true },
]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, color } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Database version:
    // const category = await db.category.create({
    //   data: {
    //     locationId: 'demo-location-1', // Get from auth
    //     name,
    //     color: color || '#3b82f6',
    //   }
    // })
    // return NextResponse.json(category)

    // Demo mode
    const newCategory = {
      id: `cat-${Date.now()}`,
      name,
      color: color || '#3b82f6',
      isActive: true,
    }
    demoCategories.push(newCategory)

    return NextResponse.json(newCategory)
  } catch (error) {
    console.error('Failed to create category:', error)
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    )
  }
}

export { demoCategories }

import { NextRequest, NextResponse } from 'next/server'
// import { db } from '@/lib/db'

// In-memory store for demo mode
let demoItems = [
  { id: 'item-1', categoryId: 'cat-1', name: 'Buffalo Wings', price: 12.99, description: 'Crispy wings tossed in buffalo sauce', isActive: true, isAvailable: true },
  { id: 'item-2', categoryId: 'cat-1', name: 'Loaded Nachos', price: 10.99, description: 'Tortilla chips with all the fixings', isActive: true, isAvailable: true },
  { id: 'item-3', categoryId: 'cat-1', name: 'Mozzarella Sticks', price: 8.99, description: 'Served with marinara sauce', isActive: true, isAvailable: true },
  { id: 'item-4', categoryId: 'cat-1', name: 'Spinach Dip', price: 9.99, description: 'Creamy spinach artichoke dip', isActive: true, isAvailable: false },
  { id: 'item-5', categoryId: 'cat-2', name: 'Classic Burger', price: 14.99, description: '8oz beef patty with lettuce, tomato, onion', isActive: true, isAvailable: true },
  { id: 'item-6', categoryId: 'cat-2', name: 'Grilled Salmon', price: 22.99, description: 'Atlantic salmon with seasonal vegetables', isActive: true, isAvailable: true },
  { id: 'item-7', categoryId: 'cat-2', name: 'Ribeye Steak', price: 28.99, description: '12oz ribeye cooked to order', isActive: true, isAvailable: true },
  { id: 'item-8', categoryId: 'cat-3', name: 'Draft Beer', price: 5.99, description: 'Selection of local craft beers', isActive: true, isAvailable: true },
  { id: 'item-9', categoryId: 'cat-3', name: 'House Wine', price: 7.99, description: 'Red or white', isActive: true, isAvailable: true },
  { id: 'item-10', categoryId: 'cat-3', name: 'Margarita', price: 9.99, description: 'Classic lime margarita', isActive: true, isAvailable: true },
  { id: 'item-11', categoryId: 'cat-3', name: 'Soft Drink', price: 2.99, description: 'Coke, Sprite, or Dr Pepper', isActive: true, isAvailable: true },
  { id: 'item-12', categoryId: 'cat-4', name: 'Chocolate Cake', price: 7.99, description: 'Rich chocolate layer cake', isActive: true, isAvailable: true },
  { id: 'item-13', categoryId: 'cat-4', name: 'Cheesecake', price: 8.99, description: 'New York style cheesecake', isActive: true, isAvailable: true },
]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, price, description, categoryId } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    if (price === undefined || price < 0) {
      return NextResponse.json(
        { error: 'Valid price is required' },
        { status: 400 }
      )
    }

    // Database version:
    // const item = await db.menuItem.create({
    //   data: {
    //     locationId: 'demo-location-1',
    //     categoryId,
    //     name,
    //     price,
    //     description,
    //   }
    // })
    // return NextResponse.json(item)

    // Demo mode
    const newItem = {
      id: `item-${Date.now()}`,
      categoryId,
      name,
      price,
      description,
      isActive: true,
      isAvailable: true,
    }
    demoItems.push(newItem)

    return NextResponse.json(newItem)
  } catch (error) {
    console.error('Failed to create item:', error)
    return NextResponse.json(
      { error: 'Failed to create item' },
      { status: 500 }
    )
  }
}

export { demoItems }

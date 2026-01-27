import { NextRequest, NextResponse } from 'next/server'
// import { db } from '@/lib/db'

// Shared in-memory store
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, price, description, isAvailable } = body

    // Database version:
    // const item = await db.menuItem.update({
    //   where: { id },
    //   data: {
    //     name,
    //     price,
    //     description,
    //     isAvailable
    //   }
    // })
    // return NextResponse.json(item)

    // Demo mode
    const index = demoItems.findIndex(i => i.id === id)
    if (index === -1) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    demoItems[index] = {
      ...demoItems[index],
      name: name !== undefined ? name : demoItems[index].name,
      price: price !== undefined ? price : demoItems[index].price,
      description: description !== undefined ? description : demoItems[index].description,
      isAvailable: isAvailable !== undefined ? isAvailable : demoItems[index].isAvailable,
    }

    return NextResponse.json(demoItems[index])
  } catch (error) {
    console.error('Failed to update item:', error)
    return NextResponse.json(
      { error: 'Failed to update item' },
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
    // await db.menuItem.delete({ where: { id } })
    // return NextResponse.json({ success: true })

    // Demo mode
    const index = demoItems.findIndex(i => i.id === id)
    if (index === -1) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    demoItems.splice(index, 1)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete item:', error)
    return NextResponse.json(
      { error: 'Failed to delete item' },
      { status: 500 }
    )
  }
}

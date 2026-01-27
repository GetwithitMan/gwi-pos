import { NextResponse } from 'next/server'
// import { db } from '@/lib/db'

// Demo data (used when database is not connected)
const DEMO_CATEGORIES = [
  { id: 'cat-1', name: 'Appetizers', color: '#ef4444', itemCount: 4, isActive: true },
  { id: 'cat-2', name: 'Entrees', color: '#3b82f6', itemCount: 3, isActive: true },
  { id: 'cat-3', name: 'Drinks', color: '#22c55e', itemCount: 4, isActive: true },
  { id: 'cat-4', name: 'Desserts', color: '#a855f7', itemCount: 2, isActive: true },
]

const DEMO_ITEMS = [
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

// In-memory store for demo mode
let demoCategories = [...DEMO_CATEGORIES]
let demoItems = [...DEMO_ITEMS]

export async function GET() {
  try {
    // Try database first
    // const categories = await db.category.findMany({
    //   where: { isActive: true },
    //   orderBy: { sortOrder: 'asc' },
    //   include: { _count: { select: { menuItems: true } } }
    // })
    // const items = await db.menuItem.findMany({
    //   where: { isActive: true },
    //   orderBy: { sortOrder: 'asc' }
    // })
    // return NextResponse.json({
    //   categories: categories.map(c => ({
    //     ...c,
    //     itemCount: c._count.menuItems
    //   })),
    //   items
    // })

    // Demo mode - return in-memory data
    const categoriesWithCounts = demoCategories.map(cat => ({
      ...cat,
      itemCount: demoItems.filter(item => item.categoryId === cat.id).length
    }))

    return NextResponse.json({
      categories: categoriesWithCounts,
      items: demoItems
    })
  } catch (error) {
    console.error('Failed to fetch menu:', error)
    return NextResponse.json(
      { error: 'Failed to fetch menu' },
      { status: 500 }
    )
  }
}

// Export demo data modifiers for other routes
export { demoCategories, demoItems }

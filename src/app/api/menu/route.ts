import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const categories = await db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { menuItems: true } } }
    })

    const items = await db.menuItem.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        modifierGroups: {
          include: {
            modifierGroup: {
              select: { id: true, name: true }
            }
          }
        }
      }
    })

    return NextResponse.json({
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        isActive: c.isActive,
        itemCount: c._count.menuItems
      })),
      items: items.map(item => ({
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        price: Number(item.price),
        description: item.description,
        isActive: item.isActive,
        isAvailable: item.isAvailable,
        commissionType: item.commissionType,
        commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
        modifierGroupCount: item.modifierGroups.length,
        modifierGroups: item.modifierGroups.map(mg => ({
          id: mg.modifierGroup.id,
          name: mg.modifierGroup.name
        }))
      }))
    })
  } catch (error) {
    console.error('Failed to fetch menu:', error)
    return NextResponse.json(
      { error: 'Failed to fetch menu' },
      { status: 500 }
    )
  }
}

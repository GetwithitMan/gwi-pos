import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

async function authenticateTerminal(request: NextRequest): Promise<{ terminal: { id: string; locationId: string; name: string }; error?: never } | { terminal?: never; error: NextResponse }> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return { error: NextResponse.json({ error: 'Authorization required' }, { status: 401 }) }
  }
  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { id: true, locationId: true, name: true },
  })
  if (!terminal) {
    return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
  }
  return { terminal }
}

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const { searchParams } = new URL(request.url)
  const sinceParam = searchParams.get('since')
  if (!sinceParam) {
    return NextResponse.json({ error: 'since parameter required' }, { status: 400 })
  }
  const since = new Date(Number(sinceParam))
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid since timestamp' }, { status: 400 })
  }

  const [menuItems, categories, employees, tables, orderTypes, orders] = await Promise.all([
    db.menuItem.findMany({ where: { locationId, updatedAt: { gt: since } }, include: { ownedModifierGroups: { include: { modifiers: true } } } }),
    db.category.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.employee.findMany({ where: { locationId, updatedAt: { gt: since } }, include: { role: { select: { id: true, name: true, permissions: true } } } }),
    db.table.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.orderType.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.order.findMany({ where: { locationId, updatedAt: { gt: since } }, include: { items: { include: { modifiers: true } } } }),
  ])

  // Convert Decimal fields to numbers for Android clients
  const mappedMenuItems = menuItems.map(item => ({
    ...item,
    price: item.price != null ? Number(item.price) : null,
    cost: item.cost != null ? Number(item.cost) : null,
    pricePerWeightUnit: item.pricePerWeightUnit != null ? Number(item.pricePerWeightUnit) : null,
  }))

  const mappedOrders = orders.map(order => ({
    ...order,
    subtotal: order.subtotal != null ? Number(order.subtotal) : null,
    taxTotal: order.taxTotal != null ? Number(order.taxTotal) : null,
    total: order.total != null ? Number(order.total) : null,
    items: order.items.map(item => ({
      ...item,
      price: item.price != null ? Number(item.price) : null,
      weight: item.weight != null ? Number(item.weight) : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      grossWeight: item.grossWeight != null ? Number(item.grossWeight) : null,
      tareWeight: item.tareWeight != null ? Number(item.tareWeight) : null,
    })),
  }))

  return NextResponse.json({
    data: { menuItems: mappedMenuItems, categories, employees, tables, orderTypes, orders: mappedOrders, syncVersion: Date.now() },
  })
})

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

  return NextResponse.json({
    data: { menuItems, categories, employees, tables, orderTypes, orders, syncVersion: Date.now() },
  })
})

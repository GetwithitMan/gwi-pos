import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'

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

export const POST = withVenue(async function POST(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const body = await request.json()
  const { orders = [] } = body

  const synced = { orders: [] as Array<{ offlineId: string; serverId: string }> }
  const errors = [] as Array<{ offlineId: string; error: string }>

  for (const orderData of orders) {
    try {
      if (!orderData.offlineId) {
        errors.push({ offlineId: 'unknown', error: 'offlineId is required' })
        continue
      }

      // Idempotent: check if already synced
      const existing = await db.order.findFirst({ where: { offlineId: orderData.offlineId } })
      if (existing) {
        synced.orders.push({ offlineId: orderData.offlineId, serverId: existing.id })
        continue
      }

      // Create order inside transaction with row-locked orderNumber
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const tomorrow = new Date(today.getTime() + 86400000)

      const created = await db.$transaction(async (tx) => {
        const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
          `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
          locationId, today, tomorrow
        )
        const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

        return tx.order.create({
          data: {
            locationId,
            orderNumber,
            employeeId: orderData.employeeId,
            status: orderData.status || 'open',
            orderTypeId: orderData.orderTypeId || null,
            tableId: orderData.tableId || null,
            notes: orderData.notes || null,
            subtotal: orderData.subtotal || 0,
            taxTotal: orderData.tax || 0,
            total: orderData.total || 0,
            offlineId: orderData.offlineId,
            offlineLocalId: orderData.offlineLocalId || null,
            offlineTimestamp: orderData.offlineTimestamp ? new Date(orderData.offlineTimestamp) : null,
            offlineTerminalId: orderData.offlineTerminalId || null,
            items: orderData.items ? {
              create: orderData.items.map((item: any) => ({
                locationId,
                menuItemId: item.menuItemId,
                name: item.name,
                quantity: item.quantity || 1,
                price: item.price || 0,
                notes: item.notes || null,
                modifiers: item.modifiers ? {
                  create: item.modifiers.map((mod: any) => ({
                    locationId,
                    modifierId: mod.modifierId,
                    name: mod.name,
                    price: mod.price || 0,
                    quantity: mod.quantity || 1,
                  })),
                } : undefined,
              })),
            } : undefined,
          },
        })
      })

      synced.orders.push({ offlineId: orderData.offlineId, serverId: created.id })

      // Fire-and-forget socket notification
      void emitToLocation(locationId, 'orders:list-changed', { orderId: created.id }).catch(console.error)
    } catch (err) {
      errors.push({ offlineId: orderData.offlineId, error: String(err) })
    }
  }

  return NextResponse.json({ data: { synced, errors } })
})

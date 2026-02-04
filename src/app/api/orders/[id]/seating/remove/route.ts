import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { removeAtSeatNumber } = await req.json()
  const { id: orderId } = await params

  try {
    return await db.$transaction(async (tx) => {
      // 1. Lock the order row
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      // 2. Delete items assigned to the seat being removed
      await tx.orderItem.deleteMany({
        where: { orderId, seatNumber: removeAtSeatNumber },
      })

      // 3. Shift all items ABOVE the removed seat DOWN by 1
      // We sort ASCENDING to fill the gap sequentially
      const itemsToShift = await tx.orderItem.findMany({
        where: { orderId, seatNumber: { gt: removeAtSeatNumber } },
        orderBy: { seatNumber: 'asc' },
      })

      for (const item of itemsToShift) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { seatNumber: item.seatNumber! - 1 },
        })
      }

      // 4. Update Order Metadata
      await tx.order.update({
        where: { id: orderId },
        data: {
          extraSeatCount: { decrement: 1 },
          seatVersion: { increment: 1 },
        },
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    console.error('[seating/remove] Shift-down failed:', error)
    return NextResponse.json({ error: 'SHIFT_DOWN_FAILED' }, { status: 500 })
  }
}

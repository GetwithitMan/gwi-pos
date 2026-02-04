// src/app/api/tables/seats/reflow/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  distributeSeatsOnPerimeter,
  getGroupBoundingBox,
  type TableRect,
} from '@/lib/table-geometry'

interface ReflowSeatsBody {
  locationId: string
  /** Physical group or virtual group: all tables that share one perimeter */
  tableIds: string[]
  /** Optional: override seat count; if omitted, keep current seat count */
  seatCount?: number
}

/**
 * POST /api/tables/seats/reflow
 *
 * Rebuilds seat positions for a set of tables that form one logical group:
 * - Uses true perimeter of all tables (L/T/U/2×2)
 * - Distributes seats evenly around perimeter
 * - Sorts clockwise and labels seats 1..N
 *
 * Used by:
 * - Add/remove seat in admin
 * - Virtual group capacity changes
 * - Manual "fix seats" actions
 */
export async function POST(request: NextRequest) {
  let body: ReflowSeatsBody
  try {
    body = (await request.json()) as ReflowSeatsBody
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid JSON in request body', details: String(err) },
      { status: 400 }
    )
  }

  const { locationId, tableIds, seatCount } = body

  if (!locationId || !tableIds || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'locationId and tableIds[] are required' },
      { status: 400 }
    )
  }

  try {
    // 1) Load tables + seats
    const tables = await db.table.findMany({
      where: {
        id: { in: tableIds },
        locationId,
        deletedAt: null,
      },
      select: {
        id: true,
        posX: true,
        posY: true,
        width: true,
        height: true,
      },
    })

    if (tables.length === 0) {
      return NextResponse.json(
        { error: 'No tables found for given IDs' },
        { status: 404 }
      )
    }

    const seats = await db.seat.findMany({
      where: {
        tableId: { in: tableIds },
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ tableId: 'asc' }, { seatNumber: 'asc' }],
    })

    const targetSeatCount = seatCount ?? seats.length

    if (targetSeatCount <= 0) {
      // No seats desired: mark existing seats inactive
      await db.seat.updateMany({
        where: { tableId: { in: tableIds }, isActive: true, deletedAt: null },
        data: { isActive: false },
      })

      return NextResponse.json({
        data: {
          seats: [],
          message: 'All seats removed for group',
        },
      })
    }

    // 2) Build TableRect array for perimeter
    const groupRects: TableRect[] = tables.map(t => ({
      id: t.id,
      posX: t.posX,
      posY: t.posY,
      width: t.width,
      height: t.height,
      combinedWithId: null,
      combinedTableIds: null,
    }))

    const perimeterPositions = distributeSeatsOnPerimeter(groupRects, targetSeatCount)
    if (perimeterPositions.length === 0) {
      return NextResponse.json(
        { error: 'Unable to compute perimeter positions for seats' },
        { status: 500 }
      )
    }

    const bounds = getGroupBoundingBox(groupRects)
    const centerX = bounds ? bounds.minX + bounds.width / 2 : 0
    const centerY = bounds ? bounds.minY + bounds.height / 2 : 0

    // 3) Ensure we have exactly targetSeatCount seats
    //    - If fewer: create new ones on the first tableId
    //    - If more: keep first N by seatNumber, mark rest inactive
    const firstTableId = tables[0].id

    if (seats.length < targetSeatCount) {
      const toCreate = targetSeatCount - seats.length
      const created = await db.$transaction(async tx => {
        const createdSeats = []
        for (let i = 0; i < toCreate; i++) {
          const seat = await tx.seat.create({
            data: {
              locationId,
              tableId: firstTableId,
              label: '',
              seatNumber: seats.length + i + 1,
              relativeX: 0,
              relativeY: 0,
              angle: 0,
              isActive: true,
            },
          })
          createdSeats.push(seat)
        }
        return createdSeats
      })
      seats.push(...created)
    } else if (seats.length > targetSeatCount) {
      const toDeactivate = seats.slice(targetSeatCount)
      const idsToDeactivate = toDeactivate.map(s => s.id)
      await db.seat.updateMany({
        where: { id: { in: idsToDeactivate } },
        data: { isActive: false },
      })
    }

    const activeSeats = seats.slice(0, targetSeatCount)

    // 4) Map each perimeter point to a seat, compute relative positions & inward angle
    const tableMap = new Map<
      string,
      { posX: number; posY: number; width: number; height: number }
    >()
    tables.forEach(t => {
      tableMap.set(t.id, {
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
      })
    })

    // Assign perimeter positions in order; then sort clockwise and relabel
    const seatsWithWorld: {
      seat: (typeof activeSeats)[number]
      worldX: number
      worldY: number
      angle: number
    }[] = []

    for (let i = 0; i < activeSeats.length; i++) {
      const seat = activeSeats[i]
      const pos = perimeterPositions[i]
      const worldX = pos.x
      const worldY = pos.y

      const dx = worldX - centerX
      const dy = worldY - centerY
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI
      angle = (angle + 450) % 360 // top=0, clockwise

      seatsWithWorld.push({ seat, worldX, worldY, angle })
    }

    seatsWithWorld.sort((a, b) => a.angle - b.angle)

    // 5) Persist updates
    await db.$transaction(async tx => {
      for (let i = 0; i < seatsWithWorld.length; i++) {
        const { seat, worldX, worldY } = seatsWithWorld[i]

        // Simple strategy: attach all new/extra seats to firstTableId
        const tableId = tableIds.includes(seat.tableId) ? seat.tableId : firstTableId
        const tablePos = tableMap.get(tableId)
        if (!tablePos) continue

        const tableCenterX = tablePos.posX + tablePos.width / 2
        const tableCenterY = tablePos.posY + tablePos.height / 2

        const relativeX = Math.round(worldX - tableCenterX)
        const relativeY = Math.round(worldY - tableCenterY)

        const angleToCenter =
          (Math.atan2(centerY - worldY, centerX - worldX) * 180) / Math.PI
        const newAngle = Math.round(angleToCenter)

        await tx.seat.update({
          where: { id: seat.id },
          data: {
            tableId,
            relativeX,
            relativeY,
            angle: newAngle,
            label: String(i + 1),
            seatNumber: i + 1,
            isActive: true,
          },
        })
      }
    })

    const updatedSeats = await db.seat.findMany({
      where: {
        tableId: { in: tableIds },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        tableId: true,
        label: true,
        seatNumber: true,
        relativeX: true,
        relativeY: true,
        angle: true,
      },
      orderBy: { seatNumber: 'asc' },
    })

    return NextResponse.json({
      data: {
        seats: updatedSeats,
        message: `Seats reflowed for ${tableIds.length} table(s) to ${targetSeatCount} seat(s)`,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const stack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        error: 'Failed to reflow seats',
        details: msg,
        stack,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

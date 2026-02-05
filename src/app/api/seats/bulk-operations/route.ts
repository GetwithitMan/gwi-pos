import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { distributeSeatsOnPerimeter, getGroupBoundingBox, type TableRect } from '@/lib/table-geometry'
import { calculateVirtualSeatNumbers, type TableWithSeats } from '@/lib/virtual-group-seats'

/**
 * POST /api/seats/bulk-operations?action=xxx
 *
 * Handles bulk seat operations to eliminate direct seat manipulation from Tables API.
 *
 * Actions:
 * - reposition-for-combine: Renumber seats around perimeter when tables are combined
 * - restore-original: Restore seats to their original positions (for split/uncombine)
 * - recalculate-labels: Recalculate seat labels in clockwise order for combined group
 * - apply-virtual-labels: Apply virtual group labels ("T1-3" format)
 * - restore-labels: Restore original labels (undo virtual labeling)
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    if (!action) {
      return NextResponse.json(
        { error: 'action query parameter is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { locationId } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    switch (action) {
      case 'reposition-for-combine':
        return await handleRepositionForCombine(body)
      case 'restore-original':
        return await handleRestoreOriginal(body)
      case 'recalculate-labels':
        return await handleRecalculateLabels(body)
      case 'apply-virtual-labels':
        return await handleApplyVirtualLabels(body)
      case 'restore-labels':
        return await handleRestoreLabels(body)
      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('[Seats Bulk Operations] Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Bulk operation failed', details: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * Action: reposition-for-combine
 *
 * Renumber seats around the perimeter when tables are combined.
 * Uses distributeSeatsOnPerimeter() for optimal seat positioning.
 */
async function handleRepositionForCombine(body: {
  locationId: string
  combinedTableIds: string[]
  tablePositions: Array<{ id: string; posX: number; posY: number; width: number; height: number }>
}) {
  const { locationId, combinedTableIds, tablePositions } = body

  if (!combinedTableIds || !Array.isArray(combinedTableIds) || combinedTableIds.length === 0) {
    return NextResponse.json(
      { error: 'combinedTableIds array is required' },
      { status: 400 }
    )
  }

  if (!tablePositions || !Array.isArray(tablePositions)) {
    return NextResponse.json(
      { error: 'tablePositions array is required' },
      { status: 400 }
    )
  }

  const result = await db.$transaction(async (tx) => {
    // Fetch all seats for the combined tables
    const allSeats = await tx.seat.findMany({
      where: {
        tableId: { in: combinedTableIds },
        locationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ tableId: 'asc' }, { seatNumber: 'asc' }],
    })

    if (allSeats.length === 0) {
      return { updatedCount: 0, seats: [] }
    }

    // Save original positions before repositioning
    for (const seat of allSeats) {
      if (seat.originalRelativeX === null && seat.originalRelativeY === null) {
        await tx.seat.update({
          where: { id: seat.id },
          data: {
            originalRelativeX: seat.relativeX,
            originalRelativeY: seat.relativeY,
            originalAngle: seat.angle,
          },
        })
      }
    }

    // Build table rectangles for geometry calculations
    const tableRects: TableRect[] = tablePositions.map((t) => ({
      id: t.id,
      posX: t.posX,
      posY: t.posY,
      width: t.width,
      height: t.height,
      combinedWithId: null,
      combinedTableIds: null,
    }))

    // Calculate perimeter positions for all seats
    const perimeterPositions = distributeSeatsOnPerimeter(tableRects, allSeats.length)

    // Get bounding box for center calculation
    const bounds = getGroupBoundingBox(tableRects)
    if (!bounds) {
      throw new Error('Failed to calculate group bounding box')
    }

    const centerX = bounds.minX + bounds.width / 2
    const centerY = bounds.minY + bounds.height / 2

    // Create table position map for relative coordinate calculation
    const tablePosMap = new Map(
      tablePositions.map((t) => [t.id, { posX: t.posX, posY: t.posY, width: t.width, height: t.height }])
    )

    // Calculate angles from center and sort clockwise
    const seatsWithAngles = allSeats
      .map((seat) => {
        const tablePos = tablePosMap.get(seat.tableId)
        if (!tablePos) return null

        const tableCenterX = tablePos.posX + tablePos.width / 2
        const tableCenterY = tablePos.posY + tablePos.height / 2
        const absX = tableCenterX + seat.relativeX
        const absY = tableCenterY + seat.relativeY

        const dx = absX - centerX
        const dy = absY - centerY
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI
        angle = (angle + 450) % 360 // top=0, clockwise

        return { seat, angle }
      })
      .filter(Boolean) as Array<{ seat: typeof allSeats[number]; angle: number }>

    seatsWithAngles.sort((a, b) => a.angle - b.angle)

    // Update each seat with new position and label
    for (let i = 0; i < seatsWithAngles.length; i++) {
      const { seat } = seatsWithAngles[i]
      const newPos = perimeterPositions[i]
      if (!newPos) continue

      const tablePos = tablePosMap.get(seat.tableId)
      if (!tablePos) continue

      const tableCenterX = tablePos.posX + tablePos.width / 2
      const tableCenterY = tablePos.posY + tablePos.height / 2

      const newRelativeX = Math.round(newPos.x - tableCenterX)
      const newRelativeY = Math.round(newPos.y - tableCenterY)

      const angleToCenter = (Math.atan2(centerY - newPos.y, centerX - newPos.x) * 180) / Math.PI
      const newAngle = Math.round(angleToCenter)

      await tx.seat.update({
        where: { id: seat.id },
        data: {
          relativeX: newRelativeX,
          relativeY: newRelativeY,
          angle: newAngle,
          label: String(i + 1),
        },
      })
    }

    return {
      updatedCount: seatsWithAngles.length,
      seats: seatsWithAngles.map((s, i) => ({
        id: s.seat.id,
        tableId: s.seat.tableId,
        label: String(i + 1),
      })),
    }
  })

  // Notify POS terminals of floor plan update
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      action: 'reposition-for-combine',
      updatedCount: result.updatedCount,
      seats: result.seats,
      message: `Repositioned ${result.updatedCount} seats around perimeter`,
    },
  })
}

/**
 * Action: restore-original
 *
 * Restore seats to their original positions (for split/uncombine).
 * Restores from originalRelativeX, originalRelativeY, originalAngle.
 */
async function handleRestoreOriginal(body: {
  locationId: string
  tableIds: string[]
}) {
  const { locationId, tableIds } = body

  if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'tableIds array is required' },
      { status: 400 }
    )
  }

  const result = await db.$transaction(async (tx) => {
    // Fetch all seats for the tables
    const seats = await tx.seat.findMany({
      where: {
        tableId: { in: tableIds },
        locationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ tableId: 'asc' }, { seatNumber: 'asc' }],
    })

    let restoredCount = 0

    // Restore each seat to its original position
    for (const seat of seats) {
      // Only restore if original positions were saved
      if (seat.originalRelativeX !== null || seat.originalRelativeY !== null) {
        await tx.seat.update({
          where: { id: seat.id },
          data: {
            relativeX: seat.originalRelativeX ?? seat.relativeX,
            relativeY: seat.originalRelativeY ?? seat.relativeY,
            angle: seat.originalAngle ?? seat.angle,
            originalRelativeX: null,
            originalRelativeY: null,
            originalAngle: null,
            label: String(seat.seatNumber),
          },
        })
        restoredCount++
      }
    }

    return { restoredCount, totalSeats: seats.length }
  })

  // Notify POS terminals of floor plan update
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      action: 'restore-original',
      restoredCount: result.restoredCount,
      totalSeats: result.totalSeats,
      message: `Restored ${result.restoredCount} of ${result.totalSeats} seats to original positions`,
    },
  })
}

/**
 * Action: recalculate-labels
 *
 * Recalculate seat labels in clockwise order for remaining combined group.
 * Used when a table is removed from a group and labels need to be renumbered.
 */
async function handleRecalculateLabels(body: {
  locationId: string
  tableIds: string[]
  tablePositions: Array<{ id: string; posX: number; posY: number; width: number; height: number }>
}) {
  const { locationId, tableIds, tablePositions } = body

  if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'tableIds array is required' },
      { status: 400 }
    )
  }

  if (!tablePositions || !Array.isArray(tablePositions)) {
    return NextResponse.json(
      { error: 'tablePositions array is required' },
      { status: 400 }
    )
  }

  const result = await db.$transaction(async (tx) => {
    // Fetch all seats for the tables
    const seats = await tx.seat.findMany({
      where: {
        tableId: { in: tableIds },
        locationId,
        isActive: true,
        deletedAt: null,
      },
    })

    if (seats.length === 0) {
      return { updatedCount: 0 }
    }

    // Calculate combined bounding box
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    const tablePosMap = new Map(
      tablePositions.map((t) => [
        t.id,
        { posX: t.posX, posY: t.posY, width: t.width, height: t.height },
      ])
    )

    for (const t of tablePositions) {
      minX = Math.min(minX, t.posX)
      minY = Math.min(minY, t.posY)
      maxX = Math.max(maxX, t.posX + t.width)
      maxY = Math.max(maxY, t.posY + t.height)
    }

    const combinedCenterX = (minX + maxX) / 2
    const combinedCenterY = (minY + maxY) / 2

    // Sort seats by clockwise position
    const seatsWithAngles = seats
      .map((seat) => {
        const tablePos = tablePosMap.get(seat.tableId)
        if (!tablePos) return null

        const tableCenterX = tablePos.posX + tablePos.width / 2
        const tableCenterY = tablePos.posY + tablePos.height / 2
        const absoluteX = tableCenterX + seat.relativeX
        const absoluteY = tableCenterY + seat.relativeY

        const dx = absoluteX - combinedCenterX
        const dy = absoluteY - combinedCenterY
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI
        angle = (angle + 135 + 360) % 360

        return { seat, clockwiseAngle: angle }
      })
      .filter(Boolean) as Array<{ seat: typeof seats[number]; clockwiseAngle: number }>

    seatsWithAngles.sort((a, b) => a.clockwiseAngle - b.clockwiseAngle)

    // Update labels based on new clockwise order
    for (let i = 0; i < seatsWithAngles.length; i++) {
      await tx.seat.update({
        where: { id: seatsWithAngles[i].seat.id },
        data: { label: String(i + 1) },
      })
    }

    return { updatedCount: seatsWithAngles.length }
  })

  // Notify POS terminals of floor plan update
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      action: 'recalculate-labels',
      updatedCount: result.updatedCount,
      message: `Recalculated labels for ${result.updatedCount} seats`,
    },
  })
}

/**
 * Action: apply-virtual-labels
 *
 * Apply virtual group labels ("T1-3" format).
 * Uses calculateVirtualSeatNumbers() from virtual-group-seats.ts.
 */
async function handleApplyVirtualLabels(body: {
  locationId: string
  primaryTableId: string
  tableIds: string[]
}) {
  const { locationId, primaryTableId, tableIds } = body

  if (!primaryTableId) {
    return NextResponse.json(
      { error: 'primaryTableId is required' },
      { status: 400 }
    )
  }

  if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'tableIds array is required' },
      { status: 400 }
    )
  }

  const result = await db.$transaction(async (tx) => {
    // Fetch all tables with their seats
    const tables = await tx.table.findMany({
      where: {
        id: { in: tableIds },
        locationId,
        deletedAt: null,
      },
      include: {
        seats: {
          where: { isActive: true, deletedAt: null },
          orderBy: { seatNumber: 'asc' },
        },
      },
    })

    if (tables.length === 0) {
      return { updatedCount: 0 }
    }

    // Prepare table data for virtual seat calculation
    const tablesWithSeats: TableWithSeats[] = tables.map((table) => ({
      id: table.id,
      name: table.name,
      posX: table.posX,
      posY: table.posY,
      seats: table.seats.map((seat) => ({
        id: seat.id,
        seatNumber: seat.seatNumber,
        label: seat.label,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
      })),
    }))

    // Calculate virtual seat numbers (primary table first, then others clockwise)
    const virtualSeatInfo = calculateVirtualSeatNumbers(primaryTableId, tablesWithSeats)

    // Update each seat with virtual label (e.g., "T1-3")
    for (const seatInfo of virtualSeatInfo) {
      await tx.seat.update({
        where: { id: seatInfo.seatId },
        data: {
          label: seatInfo.virtualLabel, // Store "TableName-SeatNum" format
        },
      })
    }

    return { updatedCount: virtualSeatInfo.length }
  })

  // Notify POS terminals of floor plan update
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      action: 'apply-virtual-labels',
      updatedCount: result.updatedCount,
      message: `Applied virtual labels to ${result.updatedCount} seats`,
    },
  })
}

/**
 * Action: restore-labels
 *
 * Restore original labels (undo virtual labeling).
 * Restores label to String(seatNumber).
 */
async function handleRestoreLabels(body: {
  locationId: string
  tableIds: string[]
}) {
  const { locationId, tableIds } = body

  if (!tableIds || !Array.isArray(tableIds) || tableIds.length === 0) {
    return NextResponse.json(
      { error: 'tableIds array is required' },
      { status: 400 }
    )
  }

  const result = await db.$transaction(async (tx) => {
    // Fetch all seats for the tables
    const seats = await tx.seat.findMany({
      where: {
        tableId: { in: tableIds },
        locationId,
        isActive: true,
        deletedAt: null,
      },
    })

    let restoredCount = 0

    // Restore each seat's original label
    for (const seat of seats) {
      // Check if label has table prefix format (e.g., "T1-3")
      const hasTablePrefix = seat.label.includes('-')

      if (hasTablePrefix) {
        // Restore to original seat number format
        await tx.seat.update({
          where: { id: seat.id },
          data: {
            label: String(seat.seatNumber), // Simple number format
          },
        })
        restoredCount++
      }
    }

    return { restoredCount, totalSeats: seats.length }
  })

  // Notify POS terminals of floor plan update
  dispatchFloorPlanUpdate(locationId, { async: true })

  return NextResponse.json({
    data: {
      action: 'restore-labels',
      restoredCount: result.restoredCount,
      totalSeats: result.totalSeats,
      message: `Restored labels for ${result.restoredCount} of ${result.totalSeats} seats`,
    },
  })
}

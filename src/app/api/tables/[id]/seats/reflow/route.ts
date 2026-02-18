import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
import { withVenue } from '@/lib/with-venue'

// POST - Reflow seats when table is resized
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params;
    const body = await request.json();
    const { oldWidth, oldHeight, newWidth, newHeight, availableSpace } = body;

    if (!oldWidth || !oldHeight || !newWidth || !newHeight) {
      return NextResponse.json(
        { error: 'Missing dimension parameters' },
        { status: 400 }
      );
    }

    // Helper to calculate dynamic clearance based on available space
    const getDynamicClearance = (availableSpace: number | undefined, baseClearance: number = 25): number => {
      const SEAT_RADIUS = 20;
      const MIN_CLEARANCE = 10;
      const MAX_CLEARANCE = 50;

      if (availableSpace === undefined) return baseClearance;

      // Compress clearance if space is limited
      return Math.max(MIN_CLEARANCE, Math.min(baseClearance, availableSpace - SEAT_RADIUS));
    };

    // Get table and its active seats
    const table = await db.table.findUnique({
      where: { id: tableId },
      include: {
        seats: {
          where: { isActive: true, deletedAt: null },
          orderBy: { seatNumber: 'asc' },
        },
      },
    });

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      );
    }

    // Calculate dynamic clearance for each side
    const baseClearance = 25;
    const topClearance = getDynamicClearance(availableSpace?.top, baseClearance);
    const bottomClearance = getDynamicClearance(availableSpace?.bottom, baseClearance);
    const leftClearance = getDynamicClearance(availableSpace?.left, baseClearance);
    const rightClearance = getDynamicClearance(availableSpace?.right, baseClearance);

    // Handle round/oval tables differently
    const isRoundTable = table.shape === 'circle';

    // Update each seat's position using edge-relative positioning
    const updatedSeats = await Promise.all(
      table.seats.map((seat) => {
        const oldHalfW = oldWidth / 2;
        const oldHalfH = oldHeight / 2;
        const newHalfW = newWidth / 2;
        const newHalfH = newHeight / 2;

        let newRelX: number;
        let newRelY: number;

        if (isRoundTable) {
          // For round/oval tables: maintain radial distance from center
          // Calculate current angle and distance from center
          const currentAngle = Math.atan2(seat.relativeY, seat.relativeX);

          // Use average clearance for round tables (simplified)
          const avgClearance = (topClearance + bottomClearance + leftClearance + rightClearance) / 4;

          // For oval, use ellipse formula; for round, use circle
          let newRadius: number;
          if (table.width !== table.height) {
            // Ellipse: maintain position on ellipse perimeter + clearance
            newRadius = Math.sqrt(
              Math.pow(newHalfW * Math.cos(currentAngle), 2) +
              Math.pow(newHalfH * Math.sin(currentAngle), 2)
            ) + avgClearance;
          } else {
            // Circle: use smaller dimension as radius
            newRadius = Math.min(newHalfW, newHalfH) + avgClearance;
          }

          newRelX = newRadius * Math.cos(currentAngle);
          newRelY = newRadius * Math.sin(currentAngle);
        } else {
          // For rectangular tables: determine which edge the seat belongs to
          const absX = Math.abs(seat.relativeX);
          const absY = Math.abs(seat.relativeY);

          // Normalize to see which edge dominates
          const normalizedX = absX / oldHalfW;  // 0 = center, 1 = edge
          const normalizedY = absY / oldHalfH;

          if (normalizedY >= normalizedX) {
            // Seat is on top or bottom edge
            // Use dynamic clearance based on side
            const direction = seat.relativeY >= 0 ? 1 : -1;
            const clearance = direction > 0 ? bottomClearance : topClearance;
            newRelY = direction * (newHalfH + clearance);

            // Scale X position proportionally along the edge
            newRelX = seat.relativeX * (newWidth / oldWidth);
          } else {
            // Seat is on left or right edge
            // Use dynamic clearance based on side
            const direction = seat.relativeX >= 0 ? 1 : -1;
            const clearance = direction > 0 ? rightClearance : leftClearance;
            newRelX = direction * (newHalfW + clearance);

            // Scale Y position proportionally along the edge
            newRelY = seat.relativeY * (newHeight / oldHeight);
          }
        }

        // Update seat position
        return db.seat.update({
          where: { id: seat.id },
          data: {
            relativeX: Math.round(newRelX),
            relativeY: Math.round(newRelY),
          },
        });
      })
    );

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(table.locationId, { async: true });

    return NextResponse.json({ data: {
      seats: updatedSeats.map((s) => ({
        id: s.id,
        seatNumber: s.seatNumber,
        label: s.label,
        relativeX: s.relativeX,
        relativeY: s.relativeY,
        angle: s.angle,
      })),
      message: `Reflowed ${updatedSeats.length} seats`,
    } });
  } catch (error) {
    console.error('Failed to reflow seats:', error);
    return NextResponse.json(
      { error: 'Failed to reflow seats' },
      { status: 500 }
    );
  }
})

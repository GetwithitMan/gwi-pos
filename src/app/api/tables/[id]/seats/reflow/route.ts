import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';

// POST - Reflow seats when table is resized
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params;
    const body = await request.json();
    const { oldWidth, oldHeight, newWidth, newHeight } = body;

    if (!oldWidth || !oldHeight || !newWidth || !newHeight) {
      return NextResponse.json(
        { error: 'Missing dimension parameters' },
        { status: 400 }
      );
    }

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

    // Fixed clearance from table edge (matches seat-generation.ts)
    const CLEARANCE = 25;

    // Handle round/oval tables differently
    const isRoundTable = table.shape === 'round' || table.shape === 'oval';

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

          // For oval, use ellipse formula; for round, use circle
          let newRadius: number;
          if (table.shape === 'oval') {
            // Ellipse: maintain position on ellipse perimeter + clearance
            newRadius = Math.sqrt(
              Math.pow(newHalfW * Math.cos(currentAngle), 2) +
              Math.pow(newHalfH * Math.sin(currentAngle), 2)
            ) + CLEARANCE;
          } else {
            // Circle: use smaller dimension as radius
            newRadius = Math.min(newHalfW, newHalfH) + CLEARANCE;
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
            // Maintain Y clearance, scale X proportionally along the edge
            const direction = seat.relativeY >= 0 ? 1 : -1;
            newRelY = direction * (newHalfH + CLEARANCE);

            // Scale X position proportionally along the edge
            newRelX = seat.relativeX * (newWidth / oldWidth);
          } else {
            // Seat is on left or right edge
            // Maintain X clearance, scale Y proportionally along the edge
            const direction = seat.relativeX >= 0 ? 1 : -1;
            newRelX = direction * (newHalfW + CLEARANCE);

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

    return NextResponse.json({
      seats: updatedSeats.map((s) => ({
        id: s.id,
        seatNumber: s.seatNumber,
        label: s.label,
        relativeX: s.relativeX,
        relativeY: s.relativeY,
        angle: s.angle,
      })),
      message: `Reflowed ${updatedSeats.length} seats`,
    });
  } catch (error) {
    console.error('Failed to reflow seats:', error);
    return NextResponse.json(
      { error: 'Failed to reflow seats' },
      { status: 500 }
    );
  }
}

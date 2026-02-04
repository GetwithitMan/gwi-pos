import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
import { generateSeatPositions, type SeatPattern } from '@/lib/seat-generation';

// POST - Generate/regenerate default seat layout
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params;
    const body = await request.json();
    const {
      pattern,
      count,
      saveAsDefault = false,
    } = body;

    // Get table details
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: {
        id: true,
        locationId: true,
        name: true,
        width: true,
        height: true,
        shape: true,
        capacity: true,
        seatPattern: true,
      },
    });

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      );
    }

    // Use defaults from table if not provided
    const finalPattern = (pattern || table.seatPattern || 'all_around') as SeatPattern;
    const finalCount = count || table.capacity;

    // Generate seat positions using params object
    const seatPositions = generateSeatPositions({
      shape: (table.shape as 'rectangle' | 'square' | 'round' | 'oval' | 'booth') || 'rectangle',
      pattern: finalPattern,
      capacity: finalCount,
      width: table.width,
      height: table.height,
    });

    // Hard delete existing seats to avoid unique constraint violation
    // (tableId + seatNumber must be unique, soft delete doesn't clear this)
    await db.seat.deleteMany({
      where: { tableId },
    });

    // Create new seats
    const createdSeats = await Promise.all(
      seatPositions.map((pos) =>
        db.seat.create({
          data: {
            locationId: table.locationId,
            tableId,
            seatNumber: pos.seatNumber,
            label: String(pos.seatNumber), // Generate label from seat number
            relativeX: pos.relativeX,
            relativeY: pos.relativeY,
            angle: pos.angle,
            seatType: 'standard',
            // If saveAsDefault, set original positions for restore capability
            ...(saveAsDefault
              ? {
                  originalRelativeX: pos.relativeX,
                  originalRelativeY: pos.relativeY,
                  originalAngle: pos.angle,
                }
              : {}),
          },
        })
      )
    );

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(table.locationId, { async: true });

    return NextResponse.json({
      seats: createdSeats.map((s) => ({
        id: s.id,
        label: s.label,
        seatNumber: s.seatNumber,
        relativeX: s.relativeX,
        relativeY: s.relativeY,
        angle: s.angle,
        seatType: s.seatType,
        isActive: s.isActive,
      })),
    });
  } catch (error) {
    console.error('Failed to generate seats:', error);
    return NextResponse.json(
      { error: 'Failed to generate seats' },
      { status: 500 }
    );
  }
}

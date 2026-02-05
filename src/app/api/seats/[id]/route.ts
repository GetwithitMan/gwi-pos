import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
import { softDeleteData } from '@/lib/floorplan/queries';

// GET - Get a single seat with table info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const seat = await db.seat.findFirst({
      where: { id, deletedAt: null },
      include: {
        table: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
            shape: true,
            capacity: true,
            width: true,
            height: true,
          },
        },
      },
    });

    if (!seat) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      seat: {
        id: seat.id,
        locationId: seat.locationId,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        originalRelativeX: seat.originalRelativeX,
        originalRelativeY: seat.originalRelativeY,
        originalAngle: seat.originalAngle,
        seatType: seat.seatType,
        isActive: seat.isActive,
        table: seat.table,
      },
    });
  } catch (error) {
    console.error('Failed to fetch seat:', error);
    return NextResponse.json(
      { error: 'Failed to fetch seat' },
      { status: 500 }
    );
  }
}

// PUT - Update seat position/properties
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      relativeX,
      relativeY,
      angle,
      label,
      seatType,
      isActive,
      originalRelativeX,
      originalRelativeY,
      originalAngle,
    } = body;

    // Get current seat for locationId
    const currentSeat = await db.seat.findFirst({
      where: { id, deletedAt: null },
    });

    if (!currentSeat) {
      return NextResponse.json({ error: 'Seat not found' }, { status: 404 });
    }

    const seat = await db.seat.update({
      where: { id },
      data: {
        ...(relativeX !== undefined ? { relativeX } : {}),
        ...(relativeY !== undefined ? { relativeY } : {}),
        ...(angle !== undefined ? { angle } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(seatType !== undefined ? { seatType } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(originalRelativeX !== undefined ? { originalRelativeX } : {}),
        ...(originalRelativeY !== undefined ? { originalRelativeY } : {}),
        ...(originalAngle !== undefined ? { originalAngle } : {}),
      },
    });

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(currentSeat.locationId, { async: true });

    return NextResponse.json({
      seat: {
        id: seat.id,
        locationId: seat.locationId,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
        isActive: seat.isActive,
      },
    });
  } catch (error) {
    console.error('Failed to update seat:', error);
    return NextResponse.json(
      { error: 'Failed to update seat' },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete seat
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get seat for locationId before deletion
    const seat = await db.seat.findFirst({
      where: { id, deletedAt: null },
      select: { locationId: true },
    });

    if (!seat) {
      return NextResponse.json({ error: 'Seat not found' }, { status: 404 });
    }

    // Soft delete
    await db.seat.update({
      where: { id },
      data: softDeleteData(),
    });

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(seat.locationId, { async: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete seat:', error);
    return NextResponse.json(
      { error: 'Failed to delete seat' },
      { status: 500 }
    );
  }
}

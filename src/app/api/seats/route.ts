import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
import { withVenue } from '@/lib/with-venue'

// GET - List seats with filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const locationId = searchParams.get('locationId');
    const tableId = searchParams.get('tableId');
    const status = searchParams.get('status');

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      );
    }

    const seats = await db.seat.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(tableId ? { tableId } : {}),
        ...(status ? { isActive: status === 'active' } : {}),
      },
      include: {
        table: {
          select: {
            id: true,
            name: true,
            shape: true,
          },
        },
      },
      orderBy: [
        { tableId: 'asc' },
        { seatNumber: 'asc' },
      ],
    });

    return NextResponse.json({ data: {
      seats: seats.map((seat) => ({
        id: seat.id,
        locationId: seat.locationId,
        tableId: seat.tableId,
        tableName: seat.table.name,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
        isActive: seat.isActive,
      })),
    } });
  } catch (error) {
    console.error('Failed to fetch seats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch seats' },
      { status: 500 }
    );
  }
})

// POST - Create a single seat
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      locationId,
      tableId,
      seatNumber,
      label,
      relativeX,
      relativeY,
      angle,
      seatType,
    } = body;

    if (!locationId || !tableId) {
      return NextResponse.json(
        { error: 'Location ID and Table ID are required' },
        { status: 400 }
      );
    }

    // Auto-increment seat number if not provided
    let finalSeatNumber = seatNumber;
    if (!finalSeatNumber) {
      const maxSeat = await db.seat.findFirst({
        where: { tableId, deletedAt: null },
        orderBy: { seatNumber: 'desc' },
      });
      finalSeatNumber = (maxSeat?.seatNumber || 0) + 1;
    }

    const seat = await db.seat.create({
      data: {
        locationId,
        tableId,
        seatNumber: finalSeatNumber,
        label: label || String(finalSeatNumber),
        relativeX: relativeX || 0,
        relativeY: relativeY || 0,
        angle: angle || 0,
        seatType: seatType || 'standard',
      },
    });

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(locationId, { async: true });

    return NextResponse.json({ data: {
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
    } });
  } catch (error) {
    console.error('Failed to create seat:', error);
    return NextResponse.json(
      { error: 'Failed to create seat' },
      { status: 500 }
    );
  }
})

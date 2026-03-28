import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch';
import { softDeleteData } from '@/lib/floorplan/queries';
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

// GET - Get a single seat with table info
export const GET = withVenue(async function GET(
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
      return notFound('Seat not found');
    }

    return ok({
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
        table: seat.table,
      },
    });
  } catch (error) {
    console.error('Failed to fetch seat:', error);
    return err('Failed to fetch seat', 500);
  }
})

// PUT - Update seat position/properties
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
    } = body;

    // Get current seat for locationId
    const currentSeat = await db.seat.findFirst({
      where: { id, deletedAt: null },
    });

    if (!currentSeat) {
      return notFound('Seat not found');
    }

    // POS context: only allow moving temporary seats (permanent seats belong to editor)
    const context = request.nextUrl.searchParams.get('context');
    if (context === 'pos' && !currentSeat.isTemporary) {
      return forbidden('Only temporary seats can be moved from POS view');
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
        lastMutatedBy: 'cloud',
      },
    });

    pushUpstream()

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(currentSeat.locationId, { async: true });

    return ok({
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
    return err('Failed to update seat', 500);
  }
}))

// DELETE - Soft delete seat
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
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
      return notFound('Seat not found');
    }

    // Soft delete
    await db.seat.update({
      where: { id },
      data: { ...softDeleteData(), lastMutatedBy: 'cloud' },
    });

    pushUpstream()

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(seat.locationId, { async: true });

    return ok({ success: true });
  } catch (error) {
    console.error('Failed to delete seat:', error);
    return err('Failed to delete seat', 500);
  }
}))

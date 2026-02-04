import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GWI POS - Seats Cleanup API
 *
 * Clean up duplicate seats (same tableId + seatNumber).
 * Keeps the oldest seat (by createdAt) and soft-deletes the rest.
 */

// POST - Clean up duplicate seats
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { locationId, dryRun = true } = body;

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      );
    }

    // Find all active seats for this location
    const allSeats = await db.seat.findMany({
      where: {
        locationId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' }, // Oldest first
      include: {
        table: { select: { name: true } },
      },
    });

    // Group by tableId + seatNumber
    const groups = new Map<string, typeof allSeats>();
    for (const seat of allSeats) {
      const key = `${seat.tableId}:${seat.seatNumber}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(seat);
    }

    // Find duplicates (groups with more than 1 seat)
    const duplicates: Array<{
      tableId: string;
      tableName: string;
      seatNumber: number;
      keepId: string;
      deleteIds: string[];
    }> = [];

    for (const [key, seats] of groups) {
      if (seats.length > 1) {
        // Keep the first (oldest), delete the rest
        const [keep, ...toDelete] = seats;
        duplicates.push({
          tableId: keep.tableId,
          tableName: keep.table?.name || 'Unknown',
          seatNumber: keep.seatNumber,
          keepId: keep.id,
          deleteIds: toDelete.map(s => s.id),
        });
      }
    }

    if (duplicates.length === 0) {
      return NextResponse.json({
        message: 'No duplicate seats found',
        duplicatesFound: 0,
      });
    }

    // If dry run, just report what would be deleted
    if (dryRun) {
      return NextResponse.json({
        message: 'Dry run complete - no changes made',
        duplicatesFound: duplicates.length,
        totalToDelete: duplicates.reduce((sum, d) => sum + d.deleteIds.length, 0),
        duplicates: duplicates.map(d => ({
          table: d.tableName,
          seatNumber: d.seatNumber,
          keeping: d.keepId,
          deleting: d.deleteIds.length,
        })),
      });
    }

    // Actually delete (soft delete) the duplicates
    const allDeleteIds = duplicates.flatMap(d => d.deleteIds);

    await db.seat.updateMany({
      where: { id: { in: allDeleteIds } },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    return NextResponse.json({
      message: `Cleaned up ${allDeleteIds.length} duplicate seats`,
      duplicatesFound: duplicates.length,
      seatsDeleted: allDeleteIds.length,
      duplicates: duplicates.map(d => ({
        table: d.tableName,
        seatNumber: d.seatNumber,
        deleted: d.deleteIds.length,
      })),
    });
  } catch (error) {
    console.error('Failed to cleanup duplicate seats:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup duplicate seats' },
      { status: 500 }
    );
  }
}

// GET - Check for duplicates without modifying
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('locationId');

  if (!locationId) {
    return NextResponse.json(
      { error: 'locationId query param required' },
      { status: 400 }
    );
  }

  // Reuse POST logic with dryRun=true
  const mockRequest = {
    json: async () => ({ locationId, dryRun: true }),
  } as NextRequest;

  return POST(mockRequest);
}

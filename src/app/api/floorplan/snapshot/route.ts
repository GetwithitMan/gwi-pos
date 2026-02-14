import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { createServerTiming } from '@/lib/perf-timing'

/**
 * GET /api/floorplan/snapshot?locationId=...
 *
 * Single endpoint returning tables + sections + elements + openOrdersCount.
 * Replaces 4 separate fetches on FloorPlanHome mount (3 parallel + 1 count).
 * All queries run in parallel within one serverless invocation.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get('locationId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  const timing = createServerTiming()
  timing.start('total')

  try {
    timing.start('db')
    const [tables, sections, elements, openOrdersCount] = await Promise.all([
      // Tables with seats + current order summary (no items/modifiers)
      db.table.findMany({
        where: { locationId, isActive: true, deletedAt: null },
        include: {
          section: { select: { id: true, name: true, color: true } },
          _count: { select: { seats: { where: { isActive: true, deletedAt: null } } } },
          seats: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true, label: true, seatNumber: true,
              relativeX: true, relativeY: true, angle: true, seatType: true,
            },
            orderBy: { seatNumber: 'asc' },
          },
          orders: {
            where: { status: 'open', deletedAt: null },
            select: {
              id: true, orderNumber: true, guestCount: true, total: true, createdAt: true,
              employee: { select: { displayName: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: [{ section: { name: 'asc' } }, { name: 'asc' }],
      }),

      // Sections with table counts + assigned employees
      db.section.findMany({
        where: { locationId, deletedAt: null },
        include: {
          tables: { where: { isActive: true, deletedAt: null }, select: { id: true } },
          assignments: {
            where: { unassignedAt: null, deletedAt: null },
            include: {
              employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),

      // Floor plan elements (fixtures, entertainment)
      db.floorPlanElement.findMany({
        where: { locationId, deletedAt: null },
        include: {
          linkedMenuItem: {
            select: {
              id: true, name: true, price: true, itemType: true,
              entertainmentStatus: true, blockTimeMinutes: true,
            },
          },
          section: { select: { id: true, name: true, color: true } },
          waitlistEntries: {
            where: { status: 'waiting', deletedAt: null },
            orderBy: { position: 'asc' },
            select: { id: true, customerName: true, partySize: true, requestedAt: true, tableId: true },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),

      // Open orders count (lightweight aggregate)
      db.order.count({
        where: { locationId, status: 'open', deletedAt: null },
      }),
    ])
    timing.end('db', 'Parallel queries')

    timing.start('map')
    const response = NextResponse.json({
      tables: tables.map(t => ({
        id: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
        capacity: t.capacity,
        seatCount: t._count.seats,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        shape: t.shape,
        seatPattern: t.seatPattern,
        status: t.status,
        section: t.section,
        sectionId: t.sectionId,
        isLocked: t.isLocked,
        seats: t.seats,
        currentOrder: t.orders[0] ? {
          id: t.orders[0].id,
          orderNumber: t.orders[0].orderNumber,
          guestCount: t.orders[0].guestCount,
          total: Number(t.orders[0].total),
          openedAt: t.orders[0].createdAt.toISOString(),
          server: t.orders[0].employee?.displayName ||
            `${t.orders[0].employee?.firstName || ''} ${t.orders[0].employee?.lastName || ''}`.trim(),
        } : null,
      })),
      sections: sections.map(s => ({
        id: s.id,
        name: s.name,
        color: s.color,
        sortOrder: s.sortOrder,
        posX: s.posX,
        posY: s.posY,
        width: s.width,
        height: s.height,
        widthFeet: s.widthFeet,
        heightFeet: s.heightFeet,
        gridSizeFeet: s.gridSizeFeet,
        tableCount: s.tables.length,
        assignedEmployees: s.assignments.map(a => ({
          id: a.employee.id,
          name: a.employee.displayName ||
            `${a.employee.firstName} ${a.employee.lastName}`,
        })),
      })),
      elements: elements.map(el => ({
        id: el.id,
        name: el.name,
        abbreviation: el.abbreviation,
        elementType: el.elementType,
        visualType: el.visualType,
        linkedMenuItemId: el.linkedMenuItemId,
        linkedMenuItem: el.linkedMenuItem,
        sectionId: el.sectionId,
        section: el.section,
        posX: el.posX,
        posY: el.posY,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        geometry: el.geometry,
        thickness: el.thickness,
        fillColor: el.fillColor,
        strokeColor: el.strokeColor,
        opacity: el.opacity,
        status: el.status,
        currentOrderId: el.currentOrderId,
        sessionStartedAt: el.sessionStartedAt,
        sessionExpiresAt: el.sessionExpiresAt,
        isLocked: el.isLocked,
        isVisible: el.isVisible,
        waitlistCount: el.waitlistEntries.length,
        waitlistEntries: el.waitlistEntries,
      })),
      openOrdersCount,
    })
    timing.end('map', 'Response mapping')
    timing.end('total')
    return timing.apply(response)
  } catch (error) {
    console.error('[floorplan/snapshot] GET error:', error)
    return NextResponse.json({ error: 'Failed to load floor plan' }, { status: 500 })
  }
})

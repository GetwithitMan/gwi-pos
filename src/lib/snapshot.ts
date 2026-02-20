/**
 * Shared floor plan snapshot logic.
 *
 * Extracted from /api/floorplan/snapshot so both the snapshot route
 * and /api/session/bootstrap can call it without duplication.
 */

import { db } from '@/lib/db'
import { getCurrentBusinessDay } from '@/lib/business-day'

export interface SnapshotTable {
  id: string
  name: string
  abbreviation: string | null
  capacity: number
  seatCount: number
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  rotation: number | null
  shape: string | null
  seatPattern: string | null
  status: string
  section: { id: string; name: string; color: string | null } | null
  sectionId: string | null
  isLocked: boolean
  seats: {
    id: string
    label: string | null
    seatNumber: number
    relativeX: number | null
    relativeY: number | null
    angle: number | null
    seatType: string | null
    isTemporary: boolean
  }[]
  currentOrder: {
    id: string
    orderNumber: number
    guestCount: number
    total: number
    openedAt: string
    server: string
    status: string
    isBottleService: boolean
    bottleServiceTierId: string | null
    bottleServiceMinSpend: number | null
    bottleServiceTierName: string | null
    bottleServiceTierColor: string | null
    splitOrders: {
      id: string
      splitIndex: number
      displayNumber: string | null
      total: number
      status: string
      isPaid: boolean
      card: { last4: string; brand: string } | null
    }[]
  } | null
}

export interface SnapshotSection {
  id: string
  name: string
  color: string | null
  sortOrder: number
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  widthFeet: number | null
  heightFeet: number | null
  gridSizeFeet: number | null
  tableCount: number
  assignedEmployees: { id: string; name: string }[]
}

export interface SnapshotElement {
  id: string
  name: string | null
  abbreviation: string | null
  elementType: string
  visualType: string | null
  linkedMenuItemId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkedMenuItem: any
  sectionId: string | null
  section: { id: string; name: string; color: string | null } | null
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  rotation: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geometry: any
  thickness: number | null
  fillColor: string | null
  strokeColor: string | null
  opacity: number | null
  status: string | null
  currentOrderId: string | null
  sessionStartedAt: Date | string | null
  sessionExpiresAt: Date | string | null
  isLocked: boolean
  isVisible: boolean
  waitlistCount: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitlistEntries: any[]
}

export interface SnapshotResult {
  tables: SnapshotTable[]
  sections: SnapshotSection[]
  elements: SnapshotElement[]
  openOrdersCount: number
}

/**
 * Build a full floor plan snapshot for a location.
 * Runs 4 parallel queries: tables, sections, elements, open orders count.
 */
export async function getFloorPlanSnapshot(locationId: string): Promise<SnapshotResult> {
  // Get business day start so the open orders count matches what the panel shows
  const locationSettings = await db.location.findFirst({
    where: { id: locationId },
    select: { settings: true },
  })
  const locSettings = locationSettings?.settings as Record<string, unknown> | null
  const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
  const businessDayStart = getCurrentBusinessDay(dayStartTime).start

  const [rawTables, sections, elements, openOrdersCount] = await Promise.all([
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
            relativeX: true, relativeY: true, angle: true, seatType: true, isTemporary: true,
          },
          orderBy: { seatNumber: 'asc' },
        },
        orders: {
          where: { status: { in: ['open', 'split'] }, deletedAt: null, parentOrderId: null },
          select: {
            id: true, orderNumber: true, guestCount: true, total: true, createdAt: true,
            status: true, isBottleService: true, bottleServiceTierId: true, bottleServiceMinSpend: true,
            employee: { select: { displayName: true, firstName: true, lastName: true } },
            splitOrders: {
              where: { deletedAt: null },
              select: {
                id: true,
                splitIndex: true,
                displayNumber: true,
                status: true,
                total: true,
                cards: {
                  where: { status: 'authorized', deletedAt: null },
                  select: { cardLast4: true, cardType: true },
                  take: 1,
                  orderBy: { createdAt: 'desc' as const },
                },
              },
              orderBy: { splitIndex: 'asc' as const },
            },
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

    // Open orders count — current business day only, exclude child splits
    db.order.count({
      where: { locationId, status: { in: ['open', 'split'] }, deletedAt: null, parentOrderId: null, OR: [{ businessDayDate: { gte: businessDayStart } }, { businessDayDate: null, createdAt: { gte: businessDayStart } }] },
    }),
  ])

  // Collect unique bottle service tier IDs from open orders so we can look up name/color in one query
  const tierIds = new Set<string>()
  for (const t of rawTables) {
    const tierId = t.orders[0]?.bottleServiceTierId
    if (tierId) tierIds.add(tierId)
  }
  const tierMap = new Map<string, { name: string; color: string }>()
  if (tierIds.size > 0) {
    const tiers = await db.bottleServiceTier.findMany({
      where: { id: { in: Array.from(tierIds) } },
      select: { id: true, name: true, color: true },
    })
    for (const tier of tiers) tierMap.set(tier.id, { name: tier.name, color: tier.color })
  }

  const tables = rawTables

  return {
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
        status: t.orders[0].status,
        isBottleService: t.orders[0].isBottleService,
        bottleServiceTierId: t.orders[0].bottleServiceTierId ?? null,
        bottleServiceMinSpend: t.orders[0].bottleServiceMinSpend !== undefined && t.orders[0].bottleServiceMinSpend !== null ? Number(t.orders[0].bottleServiceMinSpend) : null,
        bottleServiceTierName: t.orders[0].bottleServiceTierId ? (tierMap.get(t.orders[0].bottleServiceTierId)?.name ?? null) : null,
        bottleServiceTierColor: t.orders[0].bottleServiceTierId ? (tierMap.get(t.orders[0].bottleServiceTierId)?.color ?? null) : null,
        splitOrders: (t.orders[0].splitOrders || []).map((s: any) => ({
          id: s.id,
          splitIndex: s.splitIndex,
          displayNumber: s.displayNumber,
          total: Number(s.total),
          status: s.status,
          isPaid: s.status === 'paid',
          card: s.cards?.[0] ? {
            last4: s.cards[0].cardLast4,
            brand: s.cards[0].cardType,
          } : null,
        })),
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
  }
}

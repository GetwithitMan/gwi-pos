import type { Employee } from '@prisma/client';

// ═══════════════════════════════════════════════════════════════
// Floor Plan Serializers - Consistent DTO shapes
// ═══════════════════════════════════════════════════════════════

export function formatServerName(employee: Employee | null | undefined): string {
  if (!employee) return 'Unknown';
  if (employee.displayName) return employee.displayName;
  return `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Unknown';
}

interface SerializeOrderOptions {
  includeItems?: boolean;
  includeModifiers?: boolean;
}

export function serializeCurrentOrder(order: any, opts: SerializeOrderOptions = {}) {
  if (!order) return null;

  const base = {
    id: order.id,
    orderNumber: order.orderNumber,
    guestCount: order.guestCount,
    total: Number(order.total),
    openedAt: order.createdAt?.toISOString?.() || order.createdAt,
    server: formatServerName(order.employee ?? null),
  };

  if (!opts.includeItems || !order.items) return base;

  return {
    ...base,
    items: order.items.map((item: any) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: Number(item.price),
      ...(opts.includeModifiers && item.modifiers ? {
        modifiers: item.modifiers.map((m: any) => ({
          name: m.name,
          price: Number(m.price),
        })),
      } : {}),
    })),
  };
}

interface SerializeTableOptions {
  includeSeats?: boolean;
  includeOrderItems?: boolean;
  includeOrderModifiers?: boolean;
}

export function serializeTable(table: any, opts: SerializeTableOptions = {}) {
  const firstOrder = table.orders?.[0];

  return {
    id: table.id,
    name: table.name,
    abbreviation: table.abbreviation,
    posX: table.posX,
    posY: table.posY,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
    shape: table.shape,
    seatPattern: table.seatPattern,
    status: table.status,
    section: table.section ? {
      id: table.section.id,
      name: table.section.name,
      color: table.section.color,
    } : null,
    // Seat count from _count or seats array
    seatCount: table._count?.seats ?? table.seats?.length ?? 0,
    seats: opts.includeSeats ? (table.seats ?? []).map(serializeSeat) : [],
    isLocked: table.isLocked,
    // Current order
    currentOrder: serializeCurrentOrder(firstOrder, {
      includeItems: opts.includeOrderItems,
      includeModifiers: opts.includeOrderModifiers,
    }),
  };
}

export function serializeSeat(seat: any) {
  return {
    id: seat.id,
    tableId: seat.tableId,
    label: seat.label,
    seatNumber: seat.seatNumber,
    relativeX: seat.relativeX,
    relativeY: seat.relativeY,
    angle: seat.angle,
    seatType: seat.seatType,
    isActive: seat.isActive,
  };
}

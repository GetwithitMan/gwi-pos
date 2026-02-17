/**
 * Table Service - L2 Tables & Smart Objects
 *
 * Provides table management operations for the Floor Plan domain.
 * Wraps existing utilities and provides a clean domain API.
 */

import { db } from '@/shared'
import type { Table, TableShape, TableStatus } from '../types'

// Re-export existing utilities for internal use
export {
  toTableRect,
  toTableRectArray,
  getTotalSeats,
} from '@/lib/table-utils'

/**
 * Get all tables for a location
 */
export async function getTablesForLocation(locationId: string): Promise<Table[]> {
  const tables = await db.table.findMany({
    where: {
      locationId,
      deletedAt: null,
    },
    include: {
      section: true,
      seats: {
        where: { deletedAt: null },
      },
    },
    orderBy: [
      { name: 'asc' },
    ],
  })

  return tables.map(mapPrismaTableToDomain)
}

/**
 * Get a single table by ID
 */
export async function getTableById(tableId: string): Promise<Table | null> {
  const table = await db.table.findUnique({
    where: { id: tableId },
    include: {
      section: true,
      seats: {
        where: { deletedAt: null },
      },
    },
  })

  if (!table) return null
  return mapPrismaTableToDomain(table)
}

/**
 * Get tables for a specific section
 */
export async function getTablesForSection(sectionId: string): Promise<Table[]> {
  const tables = await db.table.findMany({
    where: {
      sectionId,
      deletedAt: null,
    },
    include: {
      section: true,
      seats: {
        where: { deletedAt: null },
      },
    },
    orderBy: { name: 'asc' },
  })

  return tables.map(mapPrismaTableToDomain)
}

/**
 * Update table position
 */
export async function updateTablePosition(
  tableId: string,
  posX: number,
  posY: number
): Promise<Table> {
  const table = await db.table.update({
    where: { id: tableId },
    data: { posX, posY },
    include: {
      section: true,
      seats: {
        where: { deletedAt: null },
      },
    },
  })

  return mapPrismaTableToDomain(table)
}

/**
 * Update table status
 */
export async function updateTableStatus(
  tableId: string,
  status: TableStatus
): Promise<Table> {
  const table = await db.table.update({
    where: { id: tableId },
    data: { status },
    include: {
      section: true,
      seats: {
        where: { deletedAt: null },
      },
    },
  })

  return mapPrismaTableToDomain(table)
}

/**
 * Map Prisma table to domain Table type
 */
function mapPrismaTableToDomain(prismaTable: any): Table {
  return {
    id: prismaTable.id,
    sectionId: prismaTable.sectionId,
    name: prismaTable.name,
    number: parseInt(prismaTable.name?.replace(/\D/g, '') || '0', 10),
    shape: mapShape(prismaTable.shape),
    x: prismaTable.posX,
    y: prismaTable.posY,
    width: prismaTable.width,
    height: prismaTable.height,
    rotation: prismaTable.rotation || 0,
    capacity: prismaTable.capacity,
    minCapacity: 1,
    status: prismaTable.status as TableStatus,
    isActive: prismaTable.isActive ?? true,
    isEntertainment: prismaTable.isTimedRental ?? false,
    entertainmentType: prismaTable.timedItemId ? 'timed' : undefined,
  }
}

/**
 * Map database shape to domain TableShape
 */
function mapShape(dbShape: string): TableShape {
  const shapeMap: Record<string, TableShape> = {
    'rectangle': 'rectangle',
    'circle': 'circle',
    'square': 'square',
    'booth': 'booth',
    'bar': 'bar',
  }
  return shapeMap[dbShape] || 'rectangle'
}

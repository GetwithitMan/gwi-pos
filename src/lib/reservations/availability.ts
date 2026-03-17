/**
 * Availability Engine
 *
 * Calculates available time slots for a given date, location, and party size.
 * Handles reservation blocks, table capacity, cross-midnight venues, and reduced capacity.
 */

import { PrismaClient } from '@prisma/client'
import { parseTimeToMinutes, slotsOverlap, isWithinOperatingHours, minutesToTime } from './service-date'
import type { ReservationSettings } from '@/lib/settings'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TimeSlot {
  time: string        // "HH:MM"
  available: boolean
  availableTables: number
  maxPartySize: number
  reason?: string     // why unavailable
}

export interface OperatingHours {
  open: string   // "HH:MM"
  close: string  // "HH:MM"
}

export interface AvailabilityParams {
  locationId: string
  date: string          // YYYY-MM-DD
  partySize: number
  db: PrismaClient
  settings: ReservationSettings
  operatingHours?: OperatingHours | null  // venue hours for this day; null = closed
  excludeReservationId?: string  // for self-modification
  isPublic?: boolean    // cap at single table for public
}

export interface SlotAvailabilityResult {
  available: boolean
  tables: Array<{
    id: string
    name: string
    capacity: number
    minCapacity: number
    maxCapacity: number | null
    sectionId: string | null
    priority: number
    turnTimeOverrideMinutes: number | null
    combinableWithTableIds: string[]
  }>
  reason?: string
}

// ─── Main: Get Available Slots ──────────────────────────────────────────────

export async function getAvailableSlots(params: AvailabilityParams): Promise<TimeSlot[]> {
  const {
    locationId,
    date,
    partySize,
    db,
    settings,
    operatingHours,
    excludeReservationId,
    isPublic,
  } = params

  // Venue closed this day
  if (!operatingHours) {
    return []
  }

  const openMinutes = parseTimeToMinutes(operatingHours.open)
  const closeMinutes = parseTimeToMinutes(operatingHours.close)

  // Load data in parallel
  const [reservations, blocks, tables] = await Promise.all([
    loadReservations(db, locationId, date, excludeReservationId),
    loadBlocks(db, locationId, date),
    loadReservableTables(db, locationId),
  ])

  // Check for full-day closure block
  const allDayBlock = blocks.find(b => b.isAllDay)
  if (allDayBlock) {
    return []
  }

  // Generate slot times at interval within operating hours
  const slotInterval = settings.slotIntervalMinutes
  const defaultTurnTime = settings.defaultTurnTimeMinutes
  const slots: TimeSlot[] = []

  // Cross-midnight: if close < open, we need to handle the wrap
  const isCrossMidnight = closeMinutes <= openMinutes
  const effectiveClose = isCrossMidnight ? closeMinutes + 1440 : closeMinutes

  for (let t = openMinutes; t < effectiveClose; t += slotInterval) {
    const slotMinutes = t % 1440
    const slotTime = minutesToTime(slotMinutes)

    // Check if slot + default turn time exceeds close time
    const slotEnd = t + defaultTurnTime
    if (slotEnd > effectiveClose) {
      // Slot would extend past closing — mark unavailable
      slots.push({
        time: slotTime,
        available: false,
        availableTables: 0,
        maxPartySize: 0,
        reason: 'Too close to closing time',
      })
      continue
    }

    // Check blocks for this time slot
    const blockReason = getBlockReason(blocks, slotMinutes, defaultTurnTime)
    if (blockReason) {
      slots.push({
        time: slotTime,
        available: false,
        availableTables: 0,
        maxPartySize: 0,
        reason: blockReason,
      })
      continue
    }

    // Determine reduced capacity from blocks
    const capacityMultiplier = getCapacityMultiplier(blocks, slotMinutes, defaultTurnTime)

    // Find available tables for this slot
    const availableTables = getAvailableTablesForSlot(
      tables,
      reservations,
      blocks,
      slotMinutes,
      defaultTurnTime,
      settings,
    )

    // Apply reduced capacity
    const effectiveTableCount = capacityMultiplier < 1
      ? Math.floor(availableTables.length * capacityMultiplier)
      : availableTables.length

    // Filter tables that fit partySize
    const fittingTables = availableTables.filter(t =>
      t.minCapacity <= partySize && (t.maxCapacity === null || t.maxCapacity >= partySize)
    )

    const fittingCount = Math.min(fittingTables.length, effectiveTableCount)

    // Compute maxPartySize from available tables
    let maxParty = 0
    if (isPublic) {
      // Public: cap at largest single reservable table
      for (const tbl of availableTables.slice(0, effectiveTableCount)) {
        const cap = tbl.maxCapacity ?? tbl.capacity
        if (cap > maxParty) maxParty = cap
      }
    } else {
      for (const tbl of availableTables.slice(0, effectiveTableCount)) {
        const cap = tbl.maxCapacity ?? tbl.capacity
        if (cap > maxParty) maxParty = cap
      }
    }

    const available = fittingCount > 0
    slots.push({
      time: slotTime,
      available,
      availableTables: fittingCount,
      maxPartySize: maxParty,
      reason: available ? undefined : fittingCount === 0 && availableTables.length > 0
        ? 'No tables available for this party size'
        : 'No tables available',
    })
  }

  return slots
}

// ─── Single Slot Check ──────────────────────────────────────────────────────

export async function checkSlotAvailability(params: {
  locationId: string
  date: string
  time: string          // HH:MM
  partySize: number
  durationMinutes: number
  db: PrismaClient
  settings: ReservationSettings
  operatingHours?: OperatingHours | null
  excludeReservationId?: string
}): Promise<SlotAvailabilityResult> {
  const {
    locationId,
    date,
    time,
    partySize,
    durationMinutes,
    db,
    settings,
    operatingHours,
    excludeReservationId,
  } = params

  if (!operatingHours) {
    return { available: false, tables: [], reason: 'Venue is closed on this day' }
  }

  const openMinutes = parseTimeToMinutes(operatingHours.open)
  const closeMinutes = parseTimeToMinutes(operatingHours.close)
  const slotMinutes = parseTimeToMinutes(time)

  // Check within operating hours
  if (!isWithinOperatingHours(slotMinutes, openMinutes, closeMinutes)) {
    return { available: false, tables: [], reason: 'Outside operating hours' }
  }

  // Check slot + duration doesn't exceed close time (cross-midnight aware)
  const isCrossMidnight = closeMinutes <= openMinutes
  const effectiveClose = isCrossMidnight ? closeMinutes + 1440 : closeMinutes
  const effectiveSlot = (isCrossMidnight && slotMinutes < openMinutes)
    ? slotMinutes + 1440
    : slotMinutes

  if (effectiveSlot + durationMinutes > effectiveClose) {
    return { available: false, tables: [], reason: 'Reservation would extend past closing time' }
  }

  // Load data in parallel
  const [reservations, blocks, tables] = await Promise.all([
    loadReservations(db, locationId, date, excludeReservationId),
    loadBlocks(db, locationId, date),
    loadReservableTables(db, locationId),
  ])

  // Full-day block
  const allDayBlock = blocks.find(b => b.isAllDay)
  if (allDayBlock) {
    return { available: false, tables: [], reason: `Blocked: ${allDayBlock.name}` }
  }

  // Check time-specific blocks
  const blockReason = getBlockReason(blocks, slotMinutes, durationMinutes)
  if (blockReason) {
    return { available: false, tables: [], reason: blockReason }
  }

  // Get available tables
  const availableTables = getAvailableTablesForSlot(
    tables,
    reservations,
    blocks,
    slotMinutes,
    durationMinutes,
    settings,
  )

  // Apply reduced capacity
  const capacityMultiplier = getCapacityMultiplier(blocks, slotMinutes, durationMinutes)
  const effectiveCount = capacityMultiplier < 1
    ? Math.floor(availableTables.length * capacityMultiplier)
    : availableTables.length

  const effectiveTables = availableTables.slice(0, effectiveCount)

  // Filter by party size
  const fittingTables = effectiveTables.filter(t =>
    t.minCapacity <= partySize && (t.maxCapacity === null || t.maxCapacity >= partySize)
  )

  if (fittingTables.length === 0) {
    return {
      available: false,
      tables: [],
      reason: effectiveTables.length > 0
        ? 'No tables available for this party size'
        : 'No tables available at this time',
    }
  }

  return {
    available: true,
    tables: fittingTables,
  }
}

// ─── Data Loaders ───────────────────────────────────────────────────────────

interface LoadedReservation {
  id: string
  reservationTime: string
  duration: number
  tableId: string | null
  status: string
  holdExpiresAt: Date | null
  reservationTables: Array<{ tableId: string }>
}

async function loadReservations(
  db: PrismaClient,
  locationId: string,
  date: string,
  excludeReservationId?: string,
): Promise<LoadedReservation[]> {
  const searchDate = new Date(date + 'T00:00:00Z')
  const where: Record<string, unknown> = {
    locationId,
    status: { notIn: ['cancelled', 'no_show'] },
    OR: [
      { reservationDate: searchDate },
      { serviceDate: searchDate },
    ],
  }

  if (excludeReservationId) {
    where.id = { not: excludeReservationId }
  }

  const reservations = await db.reservation.findMany({
    where,
    select: {
      id: true,
      reservationTime: true,
      duration: true,
      tableId: true,
      status: true,
      holdExpiresAt: true,
      reservationTables: { select: { tableId: true } },
    },
  })

  return reservations as LoadedReservation[]
}

interface LoadedBlock {
  id: string
  name: string
  isAllDay: boolean
  startTime: string | null
  endTime: string | null
  reducedCapacityPercent: number | null
  blockedTableIds: string[]
  blockedSectionIds: string[]
}

async function loadBlocks(
  db: PrismaClient,
  locationId: string,
  date: string,
): Promise<LoadedBlock[]> {
  const blockDate = new Date(date + 'T00:00:00Z')

  const blocks = await db.reservationBlock.findMany({
    where: {
      locationId,
      blockDate,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      isAllDay: true,
      startTime: true,
      endTime: true,
      reducedCapacityPercent: true,
      blockedTableIds: true,
      blockedSectionIds: true,
    },
  })

  return blocks.map(b => ({
    ...b,
    blockedTableIds: Array.isArray(b.blockedTableIds) ? b.blockedTableIds as string[] : [],
    blockedSectionIds: Array.isArray(b.blockedSectionIds) ? b.blockedSectionIds as string[] : [],
  }))
}

interface LoadedTable {
  id: string
  name: string
  capacity: number
  minCapacity: number
  maxCapacity: number | null
  sectionId: string | null
  priority: number
  turnTimeOverrideMinutes: number | null
  combinableWithTableIds: string[]
}

async function loadReservableTables(
  db: PrismaClient,
  locationId: string,
): Promise<LoadedTable[]> {
  const tables = await db.table.findMany({
    where: {
      locationId,
      isReservable: true,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      capacity: true,
      minCapacity: true,
      maxCapacity: true,
      sectionId: true,
      priority: true,
      turnTimeOverrideMinutes: true,
      combinableWithTableIds: true,
    },
    orderBy: { priority: 'desc' },
  })

  return tables.map(t => ({
    ...t,
    combinableWithTableIds: Array.isArray(t.combinableWithTableIds)
      ? t.combinableWithTableIds as string[]
      : [],
  }))
}

// ─── Block Logic ────────────────────────────────────────────────────────────

/**
 * Check if any block fully prevents reservations at this slot.
 * Returns reason string or null if no block prevents it.
 */
function getBlockReason(
  blocks: LoadedBlock[],
  slotMinutes: number,
  durationMinutes: number,
): string | null {
  for (const block of blocks) {
    if (block.isAllDay) return `Blocked: ${block.name}`

    if (block.startTime && block.endTime) {
      const blockStart = parseTimeToMinutes(block.startTime)
      const blockEnd = parseTimeToMinutes(block.endTime)
      const blockDuration = blockEnd > blockStart
        ? blockEnd - blockStart
        : (1440 - blockStart) + blockEnd

      // If block has NO specific tables/sections, it's a full venue block for that time
      if (block.blockedTableIds.length === 0 && block.blockedSectionIds.length === 0) {
        if (slotsOverlap(slotMinutes, durationMinutes, blockStart, blockDuration)) {
          return `Blocked: ${block.name}`
        }
      }
    }
  }
  return null
}

/**
 * Returns capacity multiplier (0-1) based on reduced capacity blocks.
 */
function getCapacityMultiplier(
  blocks: LoadedBlock[],
  slotMinutes: number,
  durationMinutes: number,
): number {
  let multiplier = 1

  for (const block of blocks) {
    if (block.reducedCapacityPercent == null || block.isAllDay) continue

    if (!block.startTime || !block.endTime) {
      // No time range but has reduced capacity — apply all day
      multiplier = Math.min(multiplier, (100 - block.reducedCapacityPercent) / 100)
      continue
    }

    const blockStart = parseTimeToMinutes(block.startTime)
    const blockEnd = parseTimeToMinutes(block.endTime)
    const blockDuration = blockEnd > blockStart
      ? blockEnd - blockStart
      : (1440 - blockStart) + blockEnd

    if (slotsOverlap(slotMinutes, durationMinutes, blockStart, blockDuration)) {
      multiplier = Math.min(multiplier, (100 - block.reducedCapacityPercent) / 100)
    }
  }

  return multiplier
}

/**
 * Check if a table is blocked by section or table block.
 */
function isTableBlockedByBlock(
  table: LoadedTable,
  blocks: LoadedBlock[],
  slotMinutes: number,
  durationMinutes: number,
): boolean {
  for (const block of blocks) {
    if (block.isAllDay) continue
    if (block.blockedTableIds.length === 0 && block.blockedSectionIds.length === 0) continue

    // Check if block's time overlaps this slot
    let overlaps = false
    if (!block.startTime || !block.endTime) {
      // No time range — applies all day
      overlaps = true
    } else {
      const blockStart = parseTimeToMinutes(block.startTime)
      const blockEnd = parseTimeToMinutes(block.endTime)
      const blockDuration = blockEnd > blockStart
        ? blockEnd - blockStart
        : (1440 - blockStart) + blockEnd

      overlaps = slotsOverlap(slotMinutes, durationMinutes, blockStart, blockDuration)
    }

    if (!overlaps) continue

    // Check if this table is specifically blocked
    if (block.blockedTableIds.includes(table.id)) return true

    // Check if this table's section is blocked
    if (table.sectionId && block.blockedSectionIds.includes(table.sectionId)) return true
  }

  return false
}

// ─── Table Availability ─────────────────────────────────────────────────────

/**
 * Get all tables that are not occupied at a given slot time.
 * Considers existing reservations and per-table/section blocks.
 */
function getAvailableTablesForSlot(
  allTables: LoadedTable[],
  reservations: LoadedReservation[],
  blocks: LoadedBlock[],
  slotMinutes: number,
  durationMinutes: number,
  settings: ReservationSettings,
): LoadedTable[] {
  const available: LoadedTable[] = []

  for (const table of allTables) {
    // Check if table is blocked by a section or table block
    if (isTableBlockedByBlock(table, blocks, slotMinutes, durationMinutes)) continue

    // Check if any existing reservation overlaps this slot on this table
    const turnTime = table.turnTimeOverrideMinutes ?? settings.defaultTurnTimeMinutes
    const isOccupied = reservations.some(res => {
      // Skip pending reservations with expired holds — they no longer block slots
      if (res.status === 'pending' && res.holdExpiresAt && res.holdExpiresAt < new Date()) {
        return false
      }

      // Check if reservation is assigned to this table (via direct tableId or ReservationTable join)
      const assignedToTable = res.tableId === table.id ||
        res.reservationTables.some(rt => rt.tableId === table.id)

      if (!assignedToTable) return false

      const resStartMinutes = parseTimeToMinutes(res.reservationTime)
      const resDuration = res.duration || turnTime

      return slotsOverlap(slotMinutes, durationMinutes, resStartMinutes, resDuration)
    })

    if (!isOccupied) {
      available.push(table)
    }
  }

  return available
}

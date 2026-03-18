/**
 * Table Suggestion Engine
 *
 * Scores and ranks available tables for a reservation request.
 * Handles single-table fit, section preference, and table combinations.
 */

import { checkSlotAvailability, type OperatingHours } from './availability'
import type { PrismaClient } from '@/generated/prisma/client'
import type { ReservationSettings } from '@/lib/settings'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScoredTable {
  table: {
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
  score: number
  reasons: string[]     // why this score
  combinedWith?: Array<{
    id: string
    name: string
    capacity: number
    maxCapacity: number | null
  }>
}

export interface TableSuggestionParams {
  locationId: string
  date: string
  time: string
  partySize: number
  durationMinutes: number
  db: PrismaClient
  settings: ReservationSettings
  operatingHours?: OperatingHours | null
  sectionPreference?: string
  excludeReservationId?: string
}

// ─── Main: Suggest Tables ───────────────────────────────────────────────────

export async function suggestTables(params: TableSuggestionParams): Promise<ScoredTable[]> {
  const {
    locationId,
    date,
    time,
    partySize,
    durationMinutes,
    db,
    settings,
    operatingHours,
    sectionPreference,
    excludeReservationId,
  } = params

  // Get available tables from availability engine
  const slotResult = await checkSlotAvailability({
    locationId,
    date,
    time,
    partySize,
    durationMinutes,
    db,
    settings,
    operatingHours,
    excludeReservationId,
  })

  // Score single tables
  const scored: ScoredTable[] = []

  for (const table of slotResult.tables) {
    const { score, reasons } = scoreTable(table, partySize, sectionPreference)
    scored.push({ table, score, reasons })
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // If no single table fits, try combinations
  if (scored.length === 0 && slotResult.tables.length === 0) {
    // Re-check without party size filter to get ALL available tables
    const allAvailable = await checkSlotAvailability({
      locationId,
      date,
      time,
      partySize: 1, // get all tables regardless of party size
      durationMinutes,
      db,
      settings,
      operatingHours,
      excludeReservationId,
    })

    const combinations = findTableCombinations(allAvailable.tables, partySize)
    for (const combo of combinations) {
      const primary = combo[0]
      const rest = combo.slice(1)
      const totalCapacity = combo.reduce((sum, t) => sum + (t.maxCapacity ?? t.capacity), 0)

      const reasons: string[] = [
        `Combined ${combo.length} tables (total capacity: ${totalCapacity})`,
      ]
      // Score combos lower than single tables, but prefer tighter fits
      const wasteScore = Math.max(0, 100 - (totalCapacity - partySize) * 10)
      const score = wasteScore - 20 // penalty for combination

      if (sectionPreference) {
        const allSameSection = combo.every(t => t.sectionId === sectionPreference)
        if (allSameSection) {
          reasons.push('All tables in preferred section')
        }
      }

      scored.push({
        table: primary,
        score,
        reasons,
        combinedWith: rest.map(t => ({
          id: t.id,
          name: t.name,
          capacity: t.capacity,
          maxCapacity: t.maxCapacity,
        })),
      })
    }

    scored.sort((a, b) => b.score - a.score)
  }

  // Return top 10
  return scored.slice(0, 10)
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function scoreTable(
  table: {
    minCapacity: number
    maxCapacity: number | null
    capacity: number
    priority: number
    sectionId: string | null
  },
  partySize: number,
  sectionPreference?: string,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  const effectiveMax = table.maxCapacity ?? table.capacity

  // Capacity fit (highest weight): prefer smallest table that fits
  const capacityFit = 100 - (effectiveMax - partySize) * 10
  const capacityScore = Math.max(0, capacityFit)
  score += capacityScore
  reasons.push(`Capacity fit: ${capacityScore} (seats ${effectiveMax}, party ${partySize})`)

  // Priority bonus
  if (table.priority > 0) {
    const priorityScore = table.priority * 5
    score += priorityScore
    reasons.push(`Priority bonus: +${priorityScore}`)
  }

  // Section preference
  if (sectionPreference && table.sectionId === sectionPreference) {
    score += 20
    reasons.push('Section preference match: +20')
  }

  // Capacity range sweet spot: party between min and max
  if (partySize >= table.minCapacity && (table.maxCapacity === null || partySize <= table.maxCapacity)) {
    score += 10
    reasons.push('Within capacity range: +10')
  }

  return { score, reasons }
}

// ─── Table Combinations ─────────────────────────────────────────────────────

interface CombinableTable {
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

/**
 * Find valid table combinations that together can seat the party.
 * Bidirectional enforcement: A lists B AND B lists A.
 * Returns smallest combinations first.
 */
function findTableCombinations(
  tables: CombinableTable[],
  partySize: number,
): CombinableTable[][] {
  // Build adjacency map for combinable tables (bidirectional check)
  const canCombine = (a: CombinableTable, b: CombinableTable): boolean => {
    return a.combinableWithTableIds.includes(b.id) &&
      b.combinableWithTableIds.includes(a.id)
  }

  const results: CombinableTable[][] = []

  // Try pairs first (most common)
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      if (!canCombine(tables[i], tables[j])) continue
      const totalCap = (tables[i].maxCapacity ?? tables[i].capacity) +
        (tables[j].maxCapacity ?? tables[j].capacity)
      if (totalCap >= partySize) {
        results.push([tables[i], tables[j]])
      }
    }
  }

  // Try triples if no pairs found
  if (results.length === 0) {
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        if (!canCombine(tables[i], tables[j])) continue
        for (let k = j + 1; k < tables.length; k++) {
          if (!canCombine(tables[i], tables[k]) || !canCombine(tables[j], tables[k])) continue
          const totalCap = (tables[i].maxCapacity ?? tables[i].capacity) +
            (tables[j].maxCapacity ?? tables[j].capacity) +
            (tables[k].maxCapacity ?? tables[k].capacity)
          if (totalCap >= partySize) {
            results.push([tables[i], tables[j], tables[k]])
          }
        }
      }
    }
  }

  // Sort by total capacity ascending (smallest combination first)
  results.sort((a, b) => {
    const capA = a.reduce((sum, t) => sum + (t.maxCapacity ?? t.capacity), 0)
    const capB = b.reduce((sum, t) => sum + (t.maxCapacity ?? t.capacity), 0)
    return capA - capB
  })

  return results.slice(0, 5) // Max 5 combination suggestions
}

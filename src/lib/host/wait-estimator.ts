/**
 * Wait Time Estimator — SPEC-26
 *
 * Estimates how long a party will wait based on:
 * - Available tables matching party size
 * - Average table turn time (from recent history)
 * - Current queue depth
 *
 * Applies quotedWaitMultiplier for customer-facing quote
 * (always better to under-promise).
 */

export interface TableForEstimate {
  id: string
  capacity: number
  status: string        // 'available' | 'occupied' | 'reserved' | 'dirty'
  seatedAt: Date | null // When current party was seated
}

export interface WaitEstimateSettings {
  quotedWaitMultiplier: number   // default 1.2
  estimateMinutesPerTurn: number // from waitlist settings, default 45
}

export interface WaitEstimate {
  minutes: number
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Estimate wait time for a party of the given size.
 *
 * Algorithm:
 * 1. Count available tables that fit the party -> if any, wait = 0
 * 2. Look at occupied tables that fit the party and estimate when each will turn
 * 3. Factor in queue depth (parties ahead of this one)
 * 4. Apply multiplier for customer-facing quote
 */
export function estimateWaitTime(
  partySize: number,
  tables: TableForEstimate[],
  queueDepth: number,
  avgTurnMinutes: number,
  settings: WaitEstimateSettings
): WaitEstimate {
  // Tables that can seat this party
  const fittingTables = tables.filter(t => t.capacity >= partySize)

  // Available tables right now
  const availableNow = fittingTables.filter(t => t.status === 'available')

  if (availableNow.length > 0 && queueDepth === 0) {
    return { minutes: 0, confidence: 'high' }
  }

  // Dirty tables turning soon (estimate 5 min to bus)
  const dirtyTables = fittingTables.filter(t => t.status === 'dirty')

  if (dirtyTables.length > queueDepth && availableNow.length === 0) {
    const rawMinutes = Math.max(5, 5 * (queueDepth + 1))
    return {
      minutes: Math.ceil(rawMinutes * settings.quotedWaitMultiplier),
      confidence: 'high',
    }
  }

  // Occupied tables — estimate turn time based on how long they've been seated
  const now = new Date()
  const occupiedFitting = fittingTables
    .filter(t => t.status === 'occupied' && t.seatedAt)
    .map(t => {
      const seatedMinutes = (now.getTime() - new Date(t.seatedAt!).getTime()) / 60000
      const remainingMinutes = Math.max(0, avgTurnMinutes - seatedMinutes)
      return { ...t, remainingMinutes }
    })
    .sort((a, b) => a.remainingMinutes - b.remainingMinutes)

  // Total turnable capacity (available + dirty + occupied)
  const totalTurnable = availableNow.length + dirtyTables.length + occupiedFitting.length

  if (totalTurnable === 0) {
    // No tables can seat this party at all
    return {
      minutes: Math.ceil((queueDepth + 1) * avgTurnMinutes * settings.quotedWaitMultiplier),
      confidence: 'low',
    }
  }

  // How many table turns needed to clear the queue ahead + this party
  const partiesAhead = queueDepth
  let tablesNeeded = partiesAhead + 1 // +1 for this party
  let estimatedMinutes = 0

  // Subtract immediately available tables
  if (availableNow.length >= tablesNeeded) {
    return { minutes: 0, confidence: 'high' }
  }
  tablesNeeded -= availableNow.length

  // Subtract dirty tables (5 min each)
  if (dirtyTables.length >= tablesNeeded) {
    estimatedMinutes = 5
    return {
      minutes: Math.ceil(estimatedMinutes * settings.quotedWaitMultiplier),
      confidence: 'high',
    }
  }
  tablesNeeded -= dirtyTables.length

  // Wait for occupied tables to turn
  let tablesTurned = 0
  for (const ot of occupiedFitting) {
    tablesTurned++
    estimatedMinutes = Math.max(estimatedMinutes, ot.remainingMinutes)
    if (tablesTurned >= tablesNeeded) break
  }

  // If we still don't have enough tables, estimate additional full turns
  if (tablesTurned < tablesNeeded) {
    const extraTurns = Math.ceil((tablesNeeded - tablesTurned) / Math.max(1, totalTurnable))
    estimatedMinutes += extraTurns * avgTurnMinutes
  }

  const confidence: 'high' | 'medium' | 'low' =
    estimatedMinutes < avgTurnMinutes ? 'high' :
    estimatedMinutes < avgTurnMinutes * 2 ? 'medium' : 'low'

  return {
    minutes: Math.ceil(estimatedMinutes * settings.quotedWaitMultiplier),
    confidence,
  }
}

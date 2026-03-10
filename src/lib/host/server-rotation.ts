/**
 * Server Rotation Engine — SPEC-26
 *
 * Round-robin assignment of tables to servers, respecting section assignments.
 * Tracks last-seated-at per server for fair distribution.
 */

export interface ServerInfo {
  employeeId: string
  name: string
  sectionId: string | null
  tableCount: number
  lastSeatedAt: Date | null
  isOnFloor: boolean
}

export interface Section {
  id: string
  name: string
}

export interface RotationPreferences {
  sectionBased: boolean
  autoRotate: boolean
}

/**
 * Get the next server to assign a table to.
 *
 * Strategy:
 * 1. If sectionBased, filter to servers in the target section first
 * 2. If autoRotate, pick the server with fewest tables, then oldest lastSeatedAt
 * 3. If not autoRotate, return the first available server (manual override expected)
 *
 * Returns null if no eligible server is found.
 */
export function getNextServer(
  servers: ServerInfo[],
  targetSectionId: string | null,
  preferences: RotationPreferences
): ServerInfo | null {
  // Only consider servers who are on the floor
  let eligible = servers.filter(s => s.isOnFloor)

  if (eligible.length === 0) return null

  // Filter by section if sectionBased and we have a target
  if (preferences.sectionBased && targetSectionId) {
    const sectionServers = eligible.filter(s => s.sectionId === targetSectionId)
    // Fall back to all eligible if no one is assigned to that section
    if (sectionServers.length > 0) {
      eligible = sectionServers
    }
  }

  if (!preferences.autoRotate) {
    // Just return the first server alphabetically (host chooses manually)
    return eligible.sort((a, b) => a.name.localeCompare(b.name))[0] ?? null
  }

  // Round-robin: least tables first, then oldest lastSeatedAt (fairness tiebreaker)
  eligible.sort((a, b) => {
    // Primary: fewer tables first
    if (a.tableCount !== b.tableCount) {
      return a.tableCount - b.tableCount
    }

    // Secondary: longest time since last seated (null = never seated = top priority)
    const aTime = a.lastSeatedAt ? a.lastSeatedAt.getTime() : 0
    const bTime = b.lastSeatedAt ? b.lastSeatedAt.getTime() : 0
    return aTime - bTime
  })

  return eligible[0] ?? null
}

/**
 * Build server info list from raw DB rows.
 * Utility for transforming query results into ServerInfo[].
 */
export function buildServerInfoList(rows: Array<{
  employeeId: string
  firstName: string
  lastName: string
  sectionId: string | null
  tableCount: number | string
  lastSeatedAt: Date | string | null
  isOnFloor: boolean
}>): ServerInfo[] {
  return rows.map(r => ({
    employeeId: r.employeeId,
    name: `${r.firstName} ${r.lastName}`.trim(),
    sectionId: r.sectionId,
    tableCount: typeof r.tableCount === 'string' ? parseInt(r.tableCount, 10) : r.tableCount,
    lastSeatedAt: r.lastSeatedAt ? new Date(r.lastSeatedAt as string) : null,
    isOnFloor: r.isOnFloor,
  }))
}

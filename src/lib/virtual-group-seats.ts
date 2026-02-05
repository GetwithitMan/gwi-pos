/**
 * Virtual Group Seat Numbering Logic
 *
 * Handles seat renumbering and labeling when tables are virtually combined.
 * Virtual groups link tables logically without moving them physically.
 */

export interface VirtualSeatInfo {
  seatId: string
  tableId: string
  tableName: string
  originalSeatNumber: number // Number within original table (1, 2, 3...)
  virtualSeatNumber: number // Sequential number within group (1..N)
  originalLabel: string // Original label before grouping
  virtualLabel: string // Display label with table prefix ("T1-3")
}

export interface TableWithSeats {
  id: string
  name: string
  abbreviation?: string | null
  posX: number
  posY: number
  seats: Array<{
    id: string
    seatNumber: number
    label: string
    relativeX: number
    relativeY: number
  }>
}

/**
 * Calculate virtual seat numbers for a group of tables
 *
 * Algorithm:
 * 1. Primary table's seats come first (1, 2, 3...)
 * 2. Secondary tables ordered by position (top-left clockwise)
 * 3. Each table's seats ordered by seatNumber
 * 4. Returns mapping for each seat
 */
export function calculateVirtualSeatNumbers(
  primaryTableId: string,
  tables: TableWithSeats[]
): VirtualSeatInfo[] {
  const result: VirtualSeatInfo[] = []

  // Find primary table
  const primaryTable = tables.find((t) => t.id === primaryTableId)
  if (!primaryTable) {
    throw new Error(`Primary table ${primaryTableId} not found`)
  }

  // Sort secondary tables by position (top-left first, then clockwise)
  const secondaryTables = tables
    .filter((t) => t.id !== primaryTableId)
    .sort((a, b) => {
      // Calculate angle from primary table center to secondary table center
      const primaryCenterX = primaryTable.posX
      const primaryCenterY = primaryTable.posY

      const angleA = Math.atan2(a.posY - primaryCenterY, a.posX - primaryCenterX)
      const angleB = Math.atan2(b.posY - primaryCenterY, b.posX - primaryCenterX)

      // Convert to 0-360 degrees, starting from top (12 o'clock) going clockwise
      const degreesA = ((angleA * 180) / Math.PI + 90 + 360) % 360
      const degreesB = ((angleB * 180) / Math.PI + 90 + 360) % 360

      return degreesA - degreesB
    })

  // Combine tables in order: primary first, then secondaries
  const orderedTables = [primaryTable, ...secondaryTables]

  let virtualSeatNumber = 1

  // Process each table's seats
  for (const table of orderedTables) {
    // Sort seats by seat number
    const sortedSeats = [...table.seats].sort((a, b) => a.seatNumber - b.seatNumber)

    for (const seat of sortedSeats) {
      // Create short name: use abbreviation if set, otherwise "T" + table number
      // Examples: "Table 20" -> "T20", "Bar Top 1" -> "BT1", abbreviation "VIP" -> "VIP"
      const shortName = table.abbreviation || (() => {
        // Extract numbers from table name (e.g., "Table 20" -> "20")
        const numbers = table.name.replace(/[^0-9]/g, '')
        if (numbers) {
          return `T${numbers}`
        }
        // Fallback: First letter of each word (e.g., "Bar Top" -> "BT")
        return table.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3)
      })()

      result.push({
        seatId: seat.id,
        tableId: table.id,
        tableName: table.name,
        originalSeatNumber: seat.seatNumber,
        virtualSeatNumber,
        originalLabel: seat.label,
        virtualLabel: `${shortName}-${seat.seatNumber}`,
      })

      virtualSeatNumber++
    }
  }

  return result
}

/**
 * Restore original seat numbers after dissolving a virtual group
 */
export function restoreOriginalSeatNumbers(
  virtualSeats: VirtualSeatInfo[]
): Map<string, { seatNumber: number; label: string }> {
  const result = new Map<string, { seatNumber: number; label: string }>()

  for (const virtualSeat of virtualSeats) {
    result.set(virtualSeat.seatId, {
      seatNumber: virtualSeat.originalSeatNumber,
      label: virtualSeat.originalLabel,
    })
  }

  return result
}

/**
 * Get display label for a virtual seat
 *
 * @param virtualInfo - Virtual seat info
 * @param showTablePrefix - If true, returns "T1-3", if false returns "3"
 */
export function getVirtualSeatLabel(
  virtualInfo: VirtualSeatInfo,
  showTablePrefix: boolean
): string {
  if (showTablePrefix) {
    return virtualInfo.virtualLabel
  }
  return String(virtualInfo.originalSeatNumber)
}

/**
 * Calculate total seat count for a virtual group
 */
export function getVirtualGroupSeatCount(tables: TableWithSeats[]): number {
  return tables.reduce((total, table) => total + table.seats.length, 0)
}

/**
 * Get seat distribution summary (useful for display)
 */
export function getVirtualGroupSeatSummary(
  tables: TableWithSeats[]
): Array<{ tableName: string; seatCount: number; seatRange: string }> {
  const primaryTable = tables[0] // Assumes primary is first
  const secondaryTables = tables.slice(1)
  const orderedTables = [primaryTable, ...secondaryTables]

  let startNumber = 1
  const summary = []

  for (const table of orderedTables) {
    const seatCount = table.seats.length
    const endNumber = startNumber + seatCount - 1
    const seatRange = seatCount === 1 ? `${startNumber}` : `${startNumber}-${endNumber}`

    summary.push({
      tableName: table.name,
      seatCount,
      seatRange,
    })

    startNumber = endNumber + 1
  }

  return summary
}

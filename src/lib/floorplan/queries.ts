// ═══════════════════════════════════════════════════════════════
// Floor Plan Query Helpers - Consistent where clauses
// ═══════════════════════════════════════════════════════════════

/**
 * Base where clause for active tables
 */
export function tableBaseWhere(locationId: string, extra?: Record<string, any>) {
  return {
    locationId,
    isActive: true,
    deletedAt: null,
    ...extra,
  };
}

/**
 * Base where clause for active seats
 */
export function seatBaseWhere(tableId: string, opts?: { includeInactive?: boolean }) {
  return {
    tableId,
    deletedAt: null,
    ...(opts?.includeInactive ? {} : { isActive: true }),
  };
}

/**
 * Base where clause for active fixtures
 */
export function fixtureBaseWhere(locationId: string, extra?: Record<string, any>) {
  return {
    locationId,
    deletedAt: null,
    ...extra,
  };
}

/**
 * Soft delete data object
 */
export function softDeleteData() {
  return {
    isActive: false,
    deletedAt: new Date(),
  };
}

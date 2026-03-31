/**
 * Base Seed Check — single definition of what "seeded" means.
 *
 * Used by bootstrap, readiness, and provisioner.
 * Checks: Location >= 1, Role >= 1, Employee >= 1, OrderType >= 1
 */

export interface BaseSeedResult {
  ok: boolean
  missing: string[]
}

// eslint-disable-next-line -- $queryRawUnsafe required: dynamic table names from hardcoded list (not user input)
export async function checkBaseSeedPresent(
  client: { $queryRawUnsafe: (sql: string) => Promise<unknown[]> }
): Promise<BaseSeedResult> {
  const missing: string[] = []

  const checks = [
    { table: 'Location', label: 'Location' },
    { table: 'Role', label: 'Role' },
    { table: 'Employee', label: 'Employee' },
    { table: 'OrderType', label: 'OrderType' },
  ]

  for (const { table, label } of checks) {
    try {
      const rows = await client.$queryRawUnsafe(
        `SELECT 1 FROM "${table}" LIMIT 1`
      )
      if (!rows || rows.length === 0) {
        missing.push(label)
      }
    } catch {
      // Table doesn't exist
      missing.push(label)
    }
  }

  return { ok: missing.length === 0, missing }
}

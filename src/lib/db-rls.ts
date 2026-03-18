/**
 * Row-Level Security (RLS) Helpers
 *
 * Sets the `app.current_tenant` GUC within a Prisma transaction so that
 * PostgreSQL RLS policies enforce tenant isolation at the database level.
 *
 * This is a defense-in-depth layer on top of the app-layer tenant scoping
 * in `db-tenant-scope.ts`. Even if the Prisma extension is bypassed (e.g.,
 * raw queries, future refactors), the database itself will block cross-tenant
 * access.
 *
 * ## How It Works
 *
 * Migration 078 (`scripts/migrations/078-enable-rls.js`) enables RLS on all
 * tenant-scoped models and creates a policy per table:
 *
 *   USING ("locationId" = current_setting('app.current_tenant', true)::text)
 *   WITH CHECK ("locationId" = current_setting('app.current_tenant', true)::text)
 *
 * The `true` in `current_setting(_, true)` means "missing_ok": if the GUC
 * is not set, it returns NULL. NULL != any locationId, so queries without
 * `SET LOCAL` see ZERO rows. This is fail-closed by default.
 *
 * ## Usage
 *
 * ### Explicit (recommended for new transaction-based code):
 *
 *   import { withTenantRLS } from '@/lib/db-rls'
 *   import { db } from '@/lib/db'
 *
 *   const result = await withTenantRLS(db, locationId, async (tx) => {
 *     return tx.menuItem.findMany()  // RLS-scoped automatically
 *   })
 *
 * ### Manual (when you already have a transaction):
 *
 *   await db.$transaction(async (tx) => {
 *     await setTenantForTransaction(tx, locationId)
 *     // All queries in this transaction are now RLS-scoped
 *     const items = await tx.menuItem.findMany()
 *   })
 *
 * ## Integration Path
 *
 * Phase 1 (this file): Explicit opt-in via `withTenantRLS()` or
 *   `setTenantForTransaction()`. New code and security-critical paths
 *   should use these helpers.
 *
 * Phase 2 (future): Automatic RLS in the Prisma transaction wrapper.
 *   When `db.$transaction()` is called and a locationId is available
 *   from request context, automatically call `setTenantForTransaction()`
 *   at the start of each transaction. This gives every transaction
 *   RLS enforcement without any code changes.
 *
 * Phase 3 (future): Once all write paths go through transactions with
 *   RLS, the app-layer `db-tenant-scope.ts` extension becomes a
 *   redundant (but still useful) defense layer for non-transactional reads.
 *
 * ## Important Notes
 *
 * - `set_config(name, value, true)` — the third arg `true` means
 *   "local to transaction" (equivalent to SET LOCAL). The GUC is
 *   automatically reset when the transaction completes.
 * - The `db-tenant-scope.ts` Prisma extension is NOT modified —
 *   it continues to enforce tenant scoping at the app layer.
 *   RLS is an additional database-level enforcement.
 * - Admin/cross-tenant operations (MC sync, migrations, cron) should
 *   NOT call setTenantForTransaction(). They use `adminDb` which
 *   bypasses tenant scoping. RLS will block them from seeing rows
 *   unless they SET LOCAL — this is intentional. Admin operations
 *   that need cross-tenant access should use a separate bypass policy
 *   or a superuser role (Phase 2 concern).
 */

import type { PrismaClient } from '@/generated/prisma/client'

/**
 * Set the RLS tenant context for an active Prisma transaction.
 *
 * Uses the parameterized `set_config()` function instead of string
 * interpolation to prevent SQL injection via a crafted locationId.
 *
 * @param tx - Active Prisma transaction client (from $transaction callback)
 * @param locationId - The tenant's location ID
 */
export async function setTenantForTransaction(tx: any, locationId: string): Promise<void> {
  if (!locationId) {
    throw new Error('[db-rls] setTenantForTransaction called without locationId — refusing to leave RLS unset (fail-closed)')
  }
  await tx.$queryRawUnsafe(
    `SELECT set_config('app.current_tenant', $1, true)`,
    locationId
  )
}

/**
 * Execute a callback within an RLS-scoped Prisma transaction.
 *
 * This is the recommended way to use RLS. It wraps `db.$transaction()`
 * and automatically sets the tenant GUC before your callback runs.
 *
 * @param db - PrismaClient instance (the tenant-aware `db` proxy from db.ts)
 * @param locationId - The tenant's location ID
 * @param fn - Async callback receiving the transaction client
 * @returns The return value of the callback
 *
 * @example
 *   const items = await withTenantRLS(db, locationId, async (tx) => {
 *     return tx.menuItem.findMany({ where: { categoryId: 'xxx' } })
 *   })
 */
export async function withTenantRLS<T>(
  db: PrismaClient,
  locationId: string,
  fn: (tx: any) => Promise<T>
): Promise<T> {
  if (!locationId) {
    throw new Error('[db-rls] withTenantRLS called without locationId — refusing to run unscoped transaction')
  }
  return (db as any).$transaction(async (tx: any) => {
    await setTenantForTransaction(tx, locationId)
    return fn(tx)
  })
}

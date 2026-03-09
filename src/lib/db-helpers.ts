import { PrismaClient } from '@prisma/client'

/**
 * Transaction client type — the Prisma client available inside $transaction().
 * Supports both the full PrismaClient (for nested calls) and the transaction
 * client that Prisma passes to interactive transaction callbacks.
 */
type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/**
 * Enable synchronous replication for the current transaction.
 *
 * Sets `synchronous_commit = 'remote_apply'` at the transaction level via
 * SET LOCAL, which means PostgreSQL will NOT return success until the standby
 * has applied the WAL for this transaction's writes.
 *
 * This adds ~5-10ms latency per transaction but guarantees zero data loss
 * (RPO = 0) for payment-critical operations during HA failover.
 *
 * **Graceful degradation:**
 * - If no standby is connected, PG falls back to local commit (no blocking).
 * - If `synchronous_standby_names` is empty/unset, the setting is ignored.
 * - On Vercel/Neon (no streaming replication), the SET LOCAL is a no-op.
 * - If the raw SQL fails for any reason, we log and continue — payment
 *   recording is more important than sync replication guarantee.
 *
 * **Usage:** Call immediately after acquiring the FOR UPDATE lock inside
 * a `db.$transaction()` callback:
 *
 * ```ts
 * const result = await db.$transaction(async (tx) => {
 *   await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`
 *   await enableSyncReplication(tx)
 *   // ... payment writes ...
 * })
 * ```
 */
export async function enableSyncReplication(tx: TransactionClient): Promise<void> {
  try {
    await (tx as any).$executeRawUnsafe("SET LOCAL synchronous_commit = 'remote_apply'")
  } catch (err) {
    // Non-fatal: sync replication is a durability enhancement, not a correctness requirement.
    // If the SET LOCAL fails (e.g., Neon managed PG that doesn't support the setting),
    // we still want the payment to go through with async replication.
    console.warn('[sync-replication] Failed to enable synchronous_commit for transaction:', err)
  }
}

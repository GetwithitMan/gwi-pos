import { db } from '@/lib/db'

/**
 * Resolve the CFD terminal paired to a register terminal.
 *
 * Used by payment routes that need to emit customer-facing lifecycle events
 * directly to the paired CFD display.
 */
export async function resolvePairedCfdTerminalId(
  registerTerminalId: string | null | undefined,
): Promise<string | null> {
  if (!registerTerminalId) return null

  const terminal = await db.terminal.findFirst({
    where: { id: registerTerminalId, deletedAt: null },
    select: { cfdTerminalId: true },
  })

  return terminal?.cfdTerminalId ?? null
}

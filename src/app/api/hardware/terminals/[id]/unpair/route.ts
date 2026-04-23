import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'
import { clearCfdMapping, revokeTerminal } from '@/lib/socket-server'
import { dispatchCFDIdle } from '@/lib/socket-dispatch/cfd-dispatch'

// POST unpair a terminal (manager action)
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const terminal = await db.terminal.findUnique({ where: { id } })
    if (!terminal || terminal.deletedAt) {
      return notFound('Terminal not found')
    }

    if (!terminal.isPaired) {
      return err('Terminal is not paired')
    }

    const previousCfdTerminalId = terminal.cfdTerminalId ?? null

    // Clear pairing data
    await db.terminal.update({
      where: { id },
      data: {
        isPaired: false,
        isOnline: false,
        deviceToken: null,
        deviceFingerprint: null,
        deviceInfo: Prisma.JsonNull,
        cfdTerminalId: null,
        cfdIpAddress: null,
        cfdConnectionMode: null,
        cfdSerialNumber: null,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
        // Keep lastKnownIp and lastSeenAt for audit trail
      },
    })

    if (previousCfdTerminalId) {
      dispatchCFDIdle(terminal.locationId, previousCfdTerminalId)
      clearCfdMapping(previousCfdTerminalId)
    }

    // Clear CellularDevice record so the fingerprint doesn't block re-pairing.
    // Without this, the old ACTIVE record persists in Neon and the device
    // can't obtain a new cellular JWT on re-pair.
    void db.$executeRaw`DELETE FROM "CellularDevice" WHERE "terminalId" = ${id} AND "locationId" = ${terminal.locationId}`.catch(err => console.warn('[unpair] CellularDevice cleanup failed (non-fatal):', err instanceof Error ? err.message : err))

    // ── REVOKE Terminal (instantly disconnect socket) ──
    void revokeTerminal(id, 'Unpaired by manager').catch(err => console.warn('[unpair] revokeTerminal failed (non-fatal):', err instanceof Error ? err.message : err))

    void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      success: true,
      message: 'Terminal unpaired successfully',
    })
  } catch (error) {
    console.error('Failed to unpair terminal:', error)
    return err('Failed to unpair terminal', 500)
  }
}))

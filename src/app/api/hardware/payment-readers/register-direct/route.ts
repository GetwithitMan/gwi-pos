import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

/**
 * POST /api/hardware/payment-readers/register-direct
 *
 * Called by Android when a USB or Bluetooth VP3350 reader connects.
 * Upserts the reader by serialNumber and assigns it to the calling terminal.
 *
 * Returns:
 *   { reader, conflict: { terminalName } | null }
 *
 * conflict is non-null when the serial is already assigned to a DIFFERENT terminal.
 * The Android app shows "Paired to: [terminalName]" as a warning — the user can still
 * proceed but should physically verify only one terminal uses the reader.
 */
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { serialNumber, connectionType, name, locationId, terminalId } = body

    if (!serialNumber || !locationId || !terminalId) {
      return err('serialNumber, locationId, and terminalId are required')
    }

    const resolvedConnectionType = (connectionType === 'BLUETOOTH' ? 'BLUETOOTH' : 'USB') as string
    const resolvedName = name || (resolvedConnectionType === 'BLUETOOTH' ? 'VP3350 BT' : 'VP3350 USB')

    // Find existing reader by serial number
    const existing = await db.paymentReader.findFirst({
      where: { serialNumber, locationId, deletedAt: null },
      include: {
        terminals: { select: { id: true, name: true } },
      },
    })

    // Check if assigned to a DIFFERENT terminal
    let conflict: { terminalName: string } | null = null
    if (existing) {
      const otherTerminal = existing.terminals.find((t) => t.id !== terminalId)
      if (otherTerminal) {
        conflict = { terminalName: otherTerminal.name }
      }
    }

    // Pull MID from location settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const merchantId = parseSettings(location?.settings).payments?.datacapMerchantId || null

    let reader
    if (existing) {
      // Update: mark online, refresh name if not customised
      reader = await db.paymentReader.update({
        where: { id: existing.id },
        data: {
          isOnline: true,
          lastSeenAt: new Date(),
          connectionType: resolvedConnectionType,
          // Only update name if it still matches the auto-generated default (not user-customised)
          ...(existing.name === 'VP3350 USB' || existing.name === 'VP3350 BT'
            ? { name: resolvedName }
            : {}),
        },
      })
    } else {
      // Create new reader
      reader = await db.paymentReader.create({
        data: {
          locationId,
          name: resolvedName,
          serialNumber,
          connectionType: resolvedConnectionType,
          ipAddress: '127.0.0.1',
          port: 8080,
          verificationType: 'SERIAL_HANDSHAKE',
          communicationMode: 'local',
          merchantId,
          isActive: true,
          isOnline: true,
          lastSeenAt: new Date(),
        },
      })
    }

    void notifyDataChanged({ locationId, domain: 'hardware', action: existing ? 'updated' : 'created', entityId: reader.id })
    void pushUpstream()

    // Assign to this terminal (only if no conflict, or overriding)
    if (!conflict) {
      await db.terminal.update({
        where: { id: terminalId },
        data: { paymentReaderId: reader.id, paymentProvider: 'DATACAP_DIRECT', lastMutatedBy: 'local' },
      })
    }

    return ok({
        reader: {
          ...reader,
          serialNumberMasked: reader.serialNumber.length > 6
            ? `...${reader.serialNumber.slice(-6)}`
            : reader.serialNumber,
        },
        conflict,
      })
  } catch (error) {
    console.error('Failed to register direct reader:', error)
    return err('Failed to register reader', 500)
  }
}))

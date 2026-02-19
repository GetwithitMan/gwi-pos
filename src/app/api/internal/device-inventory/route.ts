import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'

/**
 * GET /api/internal/device-inventory
 *
 * Localhost-only endpoint returning all devices at this venue.
 * Called by the NUC sync-agent to include device inventory in heartbeats.
 *
 * No auth required — only accessible on the local network (NUC → localhost).
 */
export async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No locationId configured' }, { status: 500 })
    }

    const where = { locationId, deletedAt: null }

    const [terminals, kdsScreens, printers, paymentReaders] = await Promise.all([
      db.terminal.findMany({
        where,
        select: {
          id: true,
          name: true,
          category: true,
          staticIp: true,
          isPaired: true,
          isActive: true,
          isOnline: true,
          lastSeenAt: true,
          lastKnownIp: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      db.kDSScreen.findMany({
        where,
        select: {
          id: true,
          name: true,
          screenType: true,
          isPaired: true,
          isActive: true,
          isOnline: true,
          lastSeenAt: true,
          lastKnownIp: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      db.printer.findMany({
        where,
        select: {
          id: true,
          name: true,
          printerType: true,
          printerRole: true,
          ipAddress: true,
          port: true,
          isActive: true,
          lastPingOk: true,
          lastPingAt: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      db.paymentReader.findMany({
        where,
        select: {
          id: true,
          name: true,
          serialNumber: true,
          ipAddress: true,
          port: true,
          deviceType: true,
          isActive: true,
          isOnline: true,
          lastSeenAt: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ])

    const fixedTerminals = terminals.filter(t => t.category === 'FIXED_STATION')
    const handhelds = terminals.filter(t => t.category === 'HANDHELD')

    return NextResponse.json({
      data: {
        terminals,
        kdsScreens,
        printers,
        paymentReaders,
        counts: {
          terminals: fixedTerminals.length,
          handhelds: handhelds.length,
          kdsScreens: kdsScreens.length,
          printers: printers.length,
          paymentReaders: paymentReaders.length,
        },
      },
    })
  } catch (err) {
    console.error('[Device Inventory] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

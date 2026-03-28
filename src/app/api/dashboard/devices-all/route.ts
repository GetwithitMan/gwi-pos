/**
 * GET /api/dashboard/devices-all
 *
 * Returns all 6 device types for the location in a single call.
 * Used by the NUC Dashboard app to render the devices overview.
 */

import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

// No auth required — this is a local-only endpoint consumed by the NUC Dashboard
// (Tauri app). The Dashboard makes unauthenticated HTTP requests to localhost:3005.
// The endpoint is not exposed to the internet (NUC firewall blocks external access).
export const GET = withVenue(async function GET(request: Request): Promise<NextResponse> {
  // Resolve locationId: request context (Vercel/NUC with slug) → env (NUC single-venue)
  const { getRequestLocationId } = await import('@/lib/request-context')
  const locationId =
    getRequestLocationId() ||
    process.env.POS_LOCATION_ID ||
    process.env.LOCATION_ID ||
    new URL(request.url).searchParams.get('locationId')

  if (!locationId) {
    return err('locationId is required')
  }

  // Run all 6 queries in parallel for speed
  const [terminals, kdsScreens, printers, paymentReaders, scales, bergDevices] = await Promise.all([
    // Terminals
    db.terminal.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        category: true,
        platform: true,
        isOnline: true,
        lastSeenAt: true,
        appVersion: true,
        isPaired: true,
        lastKnownIp: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    // KDS Screens
    db.kDSScreen.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        screenType: true,
        isOnline: true,
        lastSeenAt: true,
        displayMode: true,
        lastKnownIp: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    // Printers
    db.printer.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        printerRole: true,
        model: true,
        ipAddress: true,
        lastPingOk: true,
        lastPingAt: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    // Payment Readers
    db.paymentReader.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        deviceType: true,
        isOnline: true,
        lastSeenAt: true,
        avgResponseTime: true,
        successRate: true,
        lastError: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    // Scales
    db.scale.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        isConnected: true,
        lastSeenAt: true,
        lastError: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    // Berg Devices
    db.bergDevice.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastSeenAt: true,
        lastError: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),
  ])

  return ok({
      terminals: terminals.map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        platform: t.platform,
        isOnline: t.isOnline,
        lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
        appVersion: t.appVersion ?? null,
        isPaired: t.isPaired,
        lastKnownIp: t.lastKnownIp ?? null,
      })),
      kdsScreens: kdsScreens.map(k => ({
        id: k.id,
        name: k.name,
        screenType: k.screenType,
        isOnline: k.isOnline,
        lastSeenAt: k.lastSeenAt?.toISOString() ?? null,
        displayMode: k.displayMode ?? null,
        lastKnownIp: k.lastKnownIp ?? null,
      })),
      printers: printers.map(p => ({
        id: p.id,
        name: p.name,
        printerRole: p.printerRole,
        model: p.model ?? null,
        ipAddress: p.ipAddress ?? null,
        lastPingOk: p.lastPingOk ?? null,
        lastPingAt: p.lastPingAt?.toISOString() ?? null,
      })),
      paymentReaders: paymentReaders.map(r => ({
        id: r.id,
        name: r.name,
        deviceType: r.deviceType,
        isOnline: r.isOnline,
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        avgResponseTime: r.avgResponseTime ?? null,
        successRate: r.successRate != null ? Number(r.successRate) : null,
        lastError: r.lastError ?? null,
      })),
      scales: scales.map(s => ({
        id: s.id,
        name: s.name,
        isConnected: s.isConnected,
        lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
        lastError: s.lastError ?? null,
      })),
      bergDevices: bergDevices.map(b => ({
        id: b.id,
        name: b.name,
        isActive: b.isActive,
        lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
        lastError: b.lastError ?? null,
      })),
    })
})

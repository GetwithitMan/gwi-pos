import { config } from '@/lib/system-config'
import { db } from '@/lib/db'
import { ok, err, unauthorized } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * GET /api/internal/node-health
 *
 * Aggregates all peripheral device health into one JSON payload.
 * Consumed by Mission Control for fleet-wide device visibility.
 * Auth: x-api-key header matching PROVISION_API_KEY.
 */
export async function GET(request: Request) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== config.provisionApiKey) {
    return unauthorized('Unauthorized')
  }

  const locationId =
    process.env.POS_LOCATION_ID || process.env.LOCATION_ID || null

  if (!locationId) {
    return err('locationId not configured on this node', 500)
  }

  const where = { locationId, deletedAt: null, isActive: true }

  const [terminals, printers, readers, scales, kdsScreens] = await Promise.all([
    db.terminal.findMany({
      where,
      select: {
        id: true,
        name: true,
        isOnline: true,
        lastSeenAt: true,
        platform: true,
        appVersion: true,
        category: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    db.printer.findMany({
      where,
      select: {
        id: true,
        name: true,
        printerRole: true,
        ipAddress: true,
        lastPingOk: true,
        lastPingAt: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    db.paymentReader.findMany({
      where,
      select: {
        id: true,
        name: true,
        isOnline: true,
        lastSeenAt: true,
        lastError: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    db.scale.findMany({
      where,
      select: {
        id: true,
        name: true,
        isConnected: true,
        lastSeenAt: true,
        lastError: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),

    db.kDSScreen.findMany({
      where,
      select: {
        id: true,
        name: true,
        isOnline: true,
        lastSeenAt: true,
        screenType: true,
      },
      orderBy: { name: 'asc' },
    }).catch(() => []),
  ])

  return ok({
    timestamp: new Date().toISOString(),
    terminals: terminals.map((t) => ({
      id: t.id,
      name: t.name,
      isOnline: t.isOnline,
      lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
      platform: t.platform,
      appVersion: t.appVersion ?? null,
      category: t.category,
    })),
    printers: printers.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.printerRole,
      ipAddress: p.ipAddress ?? null,
      lastPingOk: p.lastPingOk ?? null,
      lastPingAt: p.lastPingAt?.toISOString() ?? null,
    })),
    readers: readers.map((r) => ({
      id: r.id,
      name: r.name,
      isOnline: r.isOnline,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      lastError: r.lastError ?? null,
    })),
    scales: scales.map((s) => ({
      id: s.id,
      name: s.name,
      isConnected: s.isConnected,
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      lastError: s.lastError ?? null,
    })),
    kdsScreens: kdsScreens.map((k) => ({
      id: k.id,
      name: k.name,
      isOnline: k.isOnline,
      lastSeenAt: k.lastSeenAt?.toISOString() ?? null,
      screenType: k.screenType,
    })),
  })
}

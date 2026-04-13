import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { getClientIp } from '@/lib/get-client-ip'
import { revokeTerminal } from '@/lib/socket-server'
import { err, ok } from '@/lib/api-response'
const VALID_PLATFORMS = ['BROWSER', 'ANDROID', 'IOS'] as const

// POST complete terminal pairing for native apps (Android/iOS)
// NO withAuth — devices are unauthenticated during pairing. The pairing code IS the auth.
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pairingCode, deviceFingerprint, stableDeviceId, deviceInfo, appVersion, osVersion, pushToken } = body
    if (!VALID_PLATFORMS.includes(body.platform)) {
      return NextResponse.json(
        { error: `Invalid platform '${body.platform}'. Must be one of: ${VALID_PLATFORMS.join(', ')}` },
        { status: 400 }
      )
    }
    const platform = body.platform

    if (!pairingCode) {
      return err('Pairing code is required')
    }

    // Find terminal by pairing code — locationId is derived from the terminal record
    // (no need for the client to send locationId separately)
    const terminal = await db.terminal.findFirst({
      where: {
        pairingCode,
        deletedAt: null,
      },
    })

    if (!terminal) {
      return err('Invalid pairing code')
    }

    // Check if code is expired
    if (terminal.pairingCodeExpiresAt && terminal.pairingCodeExpiresAt < new Date()) {
      return err('Pairing code has expired')
    }

    // Device count limit check — use location settings instead of hardcoded limit
    const locationId = terminal.locationId
    const { checkDeviceLimit } = await import('@/lib/device-limits')
    const deviceType = terminal.category === 'HANDHELD' ? 'handheld' as const
      : terminal.category === 'CFD_DISPLAY' ? 'cfd' as const
      : 'terminal' as const
    const limitCheck = await checkDeviceLimit(locationId, deviceType)
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: limitCheck.upgradeMessage,
          code: 'DEVICE_LIMIT_EXCEEDED',
          current: limitCheck.current,
          limit: limitCheck.limit,
        },
        { status: 403 }
      )
    }

    // Get client IP
    const clientIp = getClientIp(request)

    // IP affinity is NOT checked during pairing — the pairing code is the
    // authentication. Static IP enforcement happens on subsequent heartbeats
    // and API requests after the device is paired.

    // Generate secure device token
    const deviceToken = crypto.randomBytes(32).toString('hex')

    // Check if this hardware was previously paired to a DIFFERENT terminal.
    // If so, unpair the old terminal to prevent zombie entries and dual-paired state.
    let previousDeviceName: string | null = null
    const fingerprintToMatch = stableDeviceId || deviceFingerprint
    if (fingerprintToMatch) {
      const previousTerminal = await db.terminal.findFirst({
        where: {
          locationId,
          deviceFingerprint: fingerprintToMatch,
          id: { not: terminal.id },
          deletedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { lastSeenAt: 'desc' },
      })
      if (previousTerminal) {
        previousDeviceName = previousTerminal.name
        console.log(
          `[pair-native] Device re-identified: fingerprint ${fingerprintToMatch} was previously "${previousTerminal.name}" — unpairing old terminal`
        )

        // Full unpair of the old terminal (matches unpair/route.ts contract exactly)
        await db.terminal.update({
          where: { id: previousTerminal.id },
          data: {
            isPaired: false,
            isOnline: false,
            deviceToken: null,
            deviceFingerprint: null,
            deviceInfo: Prisma.JsonNull,
            lastMutatedBy: 'local',
          },
        })

        // Clear CellularDevice so fingerprint doesn't block re-pairing
        void db.$executeRaw`DELETE FROM "CellularDevice" WHERE "terminalId" = ${previousTerminal.id} AND "locationId" = ${locationId}`
          .catch(e => console.warn('[pair-native] CellularDevice cleanup failed (non-fatal):', e instanceof Error ? e.message : e))

        // Instantly disconnect the old terminal's socket session
        void revokeTerminal(previousTerminal.id, 'Device re-paired to different terminal')
          .catch(e => console.warn('[pair-native] revokeTerminal failed (non-fatal):', e instanceof Error ? e.message : e))

        void notifyDataChanged({ locationId, domain: 'hardware', action: 'updated', entityId: previousTerminal.id })
        void pushUpstream()
      }
    }

    // Complete pairing with native app fields
    const updated = await db.terminal.update({
      where: { id: terminal.id },
      data: {
        deviceToken,
        deviceFingerprint: stableDeviceId || deviceFingerprint || null,
        deviceInfo: deviceInfo || null,
        platform,
        appVersion: appVersion || null,
        osVersion: osVersion || null,
        pushToken: pushToken || null,
        lastKnownIp: clientIp,
        lastSeenAt: new Date(),
        isPaired: true,
        isOnline: true,
        // Clear pairing code after successful pair
        pairingCode: null,
        pairingCodeExpiresAt: null,
        lastMutatedBy: 'local',
      },
      include: {
        receiptPrinter: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
            printerRole: true,
          },
        },
      },
    })

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

    console.log(
      `[pair-native] Terminal ${updated.id} (${updated.name}) paired successfully — fingerprint: ${deviceFingerprint || 'none'}, platform: ${platform}, ip: ${clientIp}`
    )

    // Return token in JSON body (native apps use Bearer token auth, no httpOnly cookie)
    return ok({
      token: deviceToken,
      terminal: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        platform: updated.platform,
        roleSkipRules: updated.roleSkipRules,
        forceAllPrints: updated.forceAllPrints,
        receiptPrinter: updated.receiptPrinter,
      },
      location: { id: terminal.locationId },
      previousDeviceName,
    })
  } catch (error) {
    console.error('Failed to pair native terminal:', error)
    return err('Failed to pair terminal', 500)
  }
})

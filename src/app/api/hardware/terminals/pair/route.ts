import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { getClientIp } from '@/lib/get-client-ip'
import { revokeTerminal } from '@/lib/socket-server'
import { err } from '@/lib/api-response'

// POST complete terminal pairing with code
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pairingCode, deviceFingerprint, deviceInfo } = body
    const locationId = body.locationId
    if (!locationId) {
      return err('locationId is required')
    }

    if (!pairingCode) {
      return err('Pairing code is required')
    }

    // Find terminal with this pairing code
    const terminal = await db.terminal.findFirst({
      where: {
        locationId,
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

    // Get client IP
    const clientIp = getClientIp(request)

    // IP affinity check for fixed stations
    // If a static IP is configured, the pairing device must match
    if (terminal.category === 'FIXED_STATION' && terminal.staticIp) {
      if (clientIp !== terminal.staticIp && clientIp !== 'unknown') {
        return NextResponse.json(
          {
            error: `This terminal is configured for IP ${terminal.staticIp}. Your device IP (${clientIp}) does not match.`,
            code: 'IP_MISMATCH',
            expectedIp: terminal.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
      }
    }

    // Generate secure device token
    const deviceToken = crypto.randomBytes(32).toString('hex')

    // Reclaim: if this fingerprint is already paired to a different terminal, unpair the old one
    if (deviceFingerprint) {
      const previousTerminal = await db.terminal.findFirst({
        where: {
          locationId,
          deviceFingerprint,
          id: { not: terminal.id },
          deletedAt: null,
        },
        select: { id: true, name: true },
      })
      if (previousTerminal) {
        console.log(`[pair] Device fingerprint ${deviceFingerprint} was previously on "${previousTerminal.name}" — unpairing`)
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
        void db.$executeRaw`DELETE FROM "CellularDevice" WHERE "terminalId" = ${previousTerminal.id} AND "locationId" = ${locationId}`
          .catch(e => console.warn('[pair] CellularDevice cleanup failed (non-fatal):', e instanceof Error ? e.message : e))
        void revokeTerminal(previousTerminal.id, 'Device re-paired to different terminal')
          .catch(e => console.warn('[pair] revokeTerminal failed (non-fatal):', e instanceof Error ? e.message : e))
        void notifyDataChanged({ locationId, domain: 'hardware', action: 'updated', entityId: previousTerminal.id })
      }
    }

    // Complete pairing
    const updated = await db.terminal.update({
      where: { id: terminal.id },
      data: {
        deviceToken,
        deviceFingerprint: deviceFingerprint || null,
        deviceInfo: deviceInfo || null,
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

    void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

    // Create response with httpOnly cookie for the token
    const response = NextResponse.json({ data: {
      success: true,
      terminal: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        roleSkipRules: updated.roleSkipRules,
        forceAllPrints: updated.forceAllPrints,
        receiptPrinter: updated.receiptPrinter,
      },
    } })

    // Set httpOnly cookie for security (1 year expiry)
    response.cookies.set('terminal_token', deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 365 * 24 * 60 * 60, // 1 year
    })

    return response
  } catch (error) {
    console.error('Failed to pair terminal:', error)
    return err('Failed to pair terminal', 500)
  }
}))

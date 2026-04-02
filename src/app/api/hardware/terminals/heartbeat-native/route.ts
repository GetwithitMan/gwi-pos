import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { getClientIp } from '@/lib/get-client-ip'
import { createChildLogger } from '@/lib/logger'
import { err, ok, unauthorized } from '@/lib/api-response'
import { refreshSessionToken } from '@/lib/auth-session'
const log = createChildLogger('hardware-terminals-heartbeat-native')
// POST terminal heartbeat for native apps (Android/iOS) - Bearer token auth
// NO withAuth — this route does its own token validation against the Terminal table.
// Terminals authenticate via Bearer token (not session cookie or cellular JWT).
// Cellular terminals are pre-authenticated by the proxy (x-cellular-authenticated header);
// their Bearer token is a JWT, not a deviceToken, so we look up by x-terminal-id instead.
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const isCellularAuth = request.headers.get('x-cellular-authenticated') === '1'

    // Get token from Authorization header instead of cookie
    const authHeader = request.headers.get('authorization')
    const terminalToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!terminalToken && !isCellularAuth) {
      return unauthorized('Not authenticated. Provide Authorization: Bearer {token}')
    }

    // Parse optional body for version info + session token
    let appVersion: string | undefined
    let datacapSdkVersion: string | undefined
    let connectedHardware: Record<string, unknown> | undefined
    let sessionToken: string | undefined
    try {
      const body = await request.json()
      appVersion = body?.appVersion
      datacapSdkVersion = body?.datacapSdkVersion
      connectedHardware = body?.connectedHardware
      sessionToken = body?.sessionToken
    } catch {
      // No body or invalid JSON — fine, heartbeat still works
    }

    // Get client IP
    const clientIp = getClientIp(request)

    // ── Cellular fast-path ────────────────────────────────────────────────────
    // Cellular terminals don't have a Terminal record in the POS Neon DB —
    // their terminalId is a virtual MC-generated ID. The proxy already verified
    // the JWT, so we just return success to keep the Android health check happy.
    if (isCellularAuth) {
      const cellularTerminalId = request.headers.get('x-terminal-id')
      const cellularRole = request.headers.get('x-terminal-role') || 'CELLULAR_ROAMING'

      return ok({
        success: true,
        terminal: {
          id: cellularTerminalId || 'cellular',
          name: `Cellular ${cellularRole}`,
          category: 'CELLULAR',
          roleSkipRules: null,
          forceAllPrints: false,
          receiptPrinter: null,
        },
      })
    }

    // ── LAN terminal path ──────────────────────────────────────────────────
    const terminalInclude = {
      receiptPrinter: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
        },
      },
    }

    const terminal = await db.terminal.findFirst({
      where: {
        deviceToken: terminalToken!,
        deletedAt: null,
      },
      include: terminalInclude,
    })

    if (!terminal) {
      return unauthorized('Invalid terminal token')
    }

    // IP affinity check for fixed stations
    if (terminal.category === 'FIXED_STATION' && terminal.staticIp) {
      if (clientIp !== terminal.staticIp && clientIp !== 'unknown') {
        // IP mismatch on fixed station - force re-pair
        await db.terminal.update({
          where: { id: terminal.id },
          data: {
            isPaired: false,
            isOnline: false,
            deviceToken: null,
            lastMutatedBy: 'local',
          },
        })

        void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
        void pushUpstream()

        return NextResponse.json(
          {
            error: 'IP mismatch - terminal must be re-paired',
            code: 'IP_MISMATCH',
            expectedIp: terminal.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
      }
    }

    // Capture offline→online transition before updating
    const wasOffline = !terminal.isOnline

    // Update last seen
    const deviceInfoUpdate = (connectedHardware || datacapSdkVersion) ? {
      deviceInfo: {
        ...((terminal.deviceInfo as Record<string, unknown>) || {}),
        ...(datacapSdkVersion ? { datacapSdkVersion } : {}),
        ...(connectedHardware ? {
          connectedHardware,
          lastHardwareReportAt: new Date().toISOString(),
        } : {}),
      } as Prisma.InputJsonValue,
    } : {}

    await db.terminal.update({
      where: { id: terminal.id },
      data: {
        isOnline: true,
        lastSeenAt: new Date(),
        lastKnownIp: clientIp,
        lastMutatedBy: 'local',
        ...(appVersion ? { appVersion } : {}),
        ...deviceInfoUpdate,
      },
    })

    void notifyDataChanged({ locationId: terminal.locationId, domain: 'hardware', action: 'updated', entityId: terminal.id })
    void pushUpstream()

    // Notify admin browsers of offline→online transition
    if (wasOffline) {
      void emitToLocation(terminal.locationId, 'terminal:status_changed', {
        terminalId: terminal.id,
        isOnline: true,
        lastSeenAt: new Date().toISOString(),
        source: 'heartbeat_reconnected',
      })
      void db.auditLog.create({
        data: {
          locationId: terminal.locationId,
          action: 'terminal_reconnected',
          entityType: 'terminal',
          entityId: terminal.id,
          details: { source: 'heartbeat_native', appVersion: appVersion ?? null },
        },
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // ── Session token refresh (Android terminals) ──────────────────────────
    // Android apps send their session JWT in the heartbeat body. We refresh it
    // here so the 30-minute idle timeout never fires — the heartbeat IS activity.
    // Backward-compatible: old apps that don't send sessionToken still work fine.
    let refreshedSessionToken: string | undefined
    let sessionRevoked = false
    let sessionRevokedReason: string | undefined

    if (sessionToken) {
      try {
        const freshToken = await refreshSessionToken(sessionToken)
        if (freshToken) {
          refreshedSessionToken = freshToken

          // Check if the session was revoked in the DB (e.g. remote logout by manager)
          const mobileSession = await db.mobileSession.findFirst({
            where: {
              sessionToken,
              deletedAt: null,
            },
            select: { revokedAt: true },
          })

          if (mobileSession?.revokedAt) {
            sessionRevoked = true
            sessionRevokedReason = 'Session was revoked by a manager or admin'
            refreshedSessionToken = undefined // Don't return a refreshed token for revoked sessions
          }
        }
        // If freshToken is null, the token was expired/invalid — don't crash,
        // just don't include refreshedSessionToken in the response
      } catch (e) {
        log.warn({ err: e }, 'Session token refresh failed during heartbeat — ignoring')
        // Non-fatal: heartbeat still succeeds even if session refresh fails
      }
    }

    return ok({
      success: true,
      terminal: {
        id: terminal.id,
        name: terminal.name,
        category: terminal.category,
        roleSkipRules: terminal.roleSkipRules,
        forceAllPrints: terminal.forceAllPrints,
        receiptPrinter: terminal.receiptPrinter,
      },
      ...(refreshedSessionToken ? { refreshedSessionToken } : {}),
      ...(sessionRevoked ? { sessionRevoked, sessionRevokedReason } : {}),
    })
  } catch (error) {
    console.error('Terminal heartbeat (native) failed:', error)
    return err('Heartbeat failed', 500)
  }
})

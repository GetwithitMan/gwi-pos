import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'

/**
 * Smart Terminal Auto-Reconnect
 *
 * When an Android terminal reboots, it sends its stored deviceFingerprint
 * to this endpoint. If the fingerprint matches a previously paired terminal,
 * a new deviceToken is issued without requiring a pairing code.
 *
 * This eliminates the need for manual re-pairing after device reboots,
 * app updates, or token expiry.
 *
 * POST /api/hardware/terminals/reconnect
 * Body: { deviceFingerprint: string, terminalId?: string }
 * Returns: { data: { token, terminal, location } } on success
 *          { error, code: 'NOT_PAIRED' } on 404
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { deviceFingerprint, terminalId } = body

    if (!deviceFingerprint || typeof deviceFingerprint !== 'string') {
      return NextResponse.json(
        { error: 'deviceFingerprint is required' },
        { status: 400 }
      )
    }

    // Build query — match fingerprint on a previously paired terminal
    // If terminalId is provided, match on both for a more specific lookup
    const whereClause: Record<string, unknown> = {
      deviceFingerprint,
      isPaired: true,
      deletedAt: null,
    }
    if (terminalId && typeof terminalId === 'string') {
      whereClause.id = terminalId
    }

    const terminal = await db.terminal.findFirst({
      where: whereClause,
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

    if (!terminal) {
      return NextResponse.json(
        { error: 'No matching terminal found', code: 'NOT_PAIRED' },
        { status: 404 }
      )
    }

    // Get client IP
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // IP affinity check for fixed stations
    if (terminal.category === 'FIXED_STATION' && terminal.staticIp) {
      if (clientIp !== terminal.staticIp && clientIp !== 'unknown') {
        return NextResponse.json(
          {
            error: 'IP mismatch - terminal must be re-paired manually',
            code: 'IP_MISMATCH',
            expectedIp: terminal.staticIp,
            actualIp: clientIp,
          },
          { status: 403 }
        )
      }
    }

    // Generate a fresh device token
    const newDeviceToken = crypto.randomBytes(32).toString('hex')

    // Update terminal with new token and mark as online
    const updated = await db.terminal.update({
      where: { id: terminal.id },
      data: {
        deviceToken: newDeviceToken,
        lastSeenAt: new Date(),
        lastKnownIp: clientIp,
        isOnline: true,
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

    console.log(
      `[reconnect] Terminal ${updated.id} (${updated.name}) auto-reconnected via fingerprint — ip: ${clientIp}`
    )

    // Notify admin browsers that terminal came back online
    try {
      const { emitToLocation } = await import('@/lib/socket-server')
      void emitToLocation(terminal.locationId, 'terminal:status_changed', {
        terminalId: terminal.id,
        isOnline: true,
        lastSeenAt: new Date().toISOString(),
        source: 'auto_reconnect',
      })
    } catch {
      // Socket module may not be loaded — non-fatal
    }

    // Audit log the reconnect
    try {
      await db.auditLog.create({
        data: {
          locationId: terminal.locationId,
          action: 'terminal_auto_reconnected',
          entityType: 'terminal',
          entityId: terminal.id,
          details: {
            fingerprint: deviceFingerprint.slice(0, 8) + '...',
            ip: clientIp,
          },
        },
      })
    } catch {
      // Audit log failure is non-fatal
    }

    return NextResponse.json({
      data: {
        token: newDeviceToken,
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
      },
    })
  } catch (error) {
    console.error('Terminal reconnect failed:', error)
    return NextResponse.json(
      { error: 'Reconnect failed' },
      { status: 500 }
    )
  }
})

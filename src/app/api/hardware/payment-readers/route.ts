import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

// GET all payment readers for a location
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }
    const activeOnly = searchParams.get('activeOnly') === 'true'

    const readers = await db.paymentReader.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(activeOnly && { isActive: true }),
      },
      include: {
        terminals: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return ok({
      readers: readers.map((r) => ({
        ...r,
        avgResponseTime: r.avgResponseTime,
        successRate: r.successRate ? Number(r.successRate) : null,
        // Mask serial number for security (show last 6)
        serialNumberMasked: r.serialNumber.length > 6
          ? `...${r.serialNumber.slice(-6)}`
          : r.serialNumber,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch payment readers:', error)
    return err('Failed to fetch payment readers', 500)
  }
}))

// POST create a new payment reader
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      serialNumber,
      connectionType = 'IP',       // 'USB' | 'IP' | 'BLUETOOTH' | 'WIFI'
      ipAddress: rawIp,
      port = 8080,
      verificationType = 'SERIAL_HANDSHAKE',
      terminalId,
      communicationMode: rawMode,
      assignTerminalIds,           // string[] — terminals to bind on creation
      employeeId: bodyEmployeeId,
    } = body
    // merchantId intentionally NOT accepted from client — sourced from location settings (MC-managed)

    // Validate required fields
    if (!locationId || !name || !serialNumber) {
      return err('locationId, name, and serial number are required')
    }

    // Auth check — require settings.hardware permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Connection-type rules
    const isNetworkType = connectionType === 'IP' || connectionType === 'WIFI'
    const ipAddress = isNetworkType ? (rawIp || '') : '127.0.0.1'
    // USB + BT go through DC Direct (localhost:8080); IP/WiFi talk directly — all modes are 'local'
    const communicationMode = rawMode ?? 'local'

    // For network readers, IP address is required and must be valid
    if (isNetworkType) {
      if (!ipAddress) {
        return err('IP address is required for IP/WiFi readers')
      }
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (!ipv4Regex.test(ipAddress)) {
        return err('Invalid IP address format')
      }
    }

    // Validate port range
    if (port < 1 || port > 65535) {
      return err('Port must be between 1 and 65535')
    }

    // Check for duplicate serial number
    const existingSerial = await db.paymentReader.findFirst({
      where: { serialNumber, deletedAt: null },
    })
    if (existingSerial) {
      return err('A reader with this serial number already exists')
    }

    // Check for duplicate IP only for network readers
    if (isNetworkType && ipAddress !== '127.0.0.1') {
      const existingIp = await db.paymentReader.findFirst({
        where: { locationId, ipAddress, deletedAt: null },
      })
      if (existingIp) {
        return err('A reader with this IP address already exists at this location')
      }
    }

    // Pull MID from location settings — managed by Mission Control, never from client
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const locSettings = parseSettings(location?.settings)
    const merchantId = locSettings.payments?.datacapMerchantId || null

    const reader = await db.paymentReader.create({
      data: {
        locationId,
        name,
        serialNumber,
        connectionType,
        ipAddress,
        port,
        verificationType,
        merchantId,
        terminalId,
        communicationMode,
        isActive: true,
        isOnline: false,
      },
    })

    // Bind to terminals if provided
    if (Array.isArray(assignTerminalIds) && assignTerminalIds.length > 0) {
      await db.terminal.updateMany({
        where: { id: { in: assignTerminalIds }, locationId },
        data: { paymentReaderId: reader.id, paymentProvider: 'DATACAP_DIRECT', lastMutatedBy: 'local' },
      })
    }

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: reader.id })
    void pushUpstream()

    return ok({ reader })
  } catch (error) {
    console.error('Failed to create payment reader:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return err('A reader with this name already exists at this location')
    }
    return err('Failed to create payment reader', 500)
  }
}))

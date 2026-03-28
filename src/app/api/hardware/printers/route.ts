import { NextRequest, NextResponse } from 'next/server'
import { PrinterRole } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { DEFAULT_KITCHEN_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from '@/types/print'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { emitToLocation } from '@/lib/socket-server'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('hardware-printers')

// GET all printers for a location
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return err('locationId is required')
    }
    const role = searchParams.get('role') // Filter by printerRole

    const printers = await db.printer.findMany({
      where: {
        locationId,
        ...(role && { printerRole: role as PrinterRole }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return ok({
      printers: printers.map((p) => ({
        ...p,
        port: p.port,
        paperWidth: p.paperWidth,
        sortOrder: p.sortOrder,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch printers:', error)
    return err('Failed to fetch printers', 500)
  }
}))

// POST create a new printer
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      printerType,
      model,
      ipAddress,
      port = 9100,
      printerRole = 'kitchen',
      isDefault = false,
      paperWidth = 80,
      supportsCut = true,
      printSettings,
      employeeId: bodyEmployeeId,
    } = body

    // Validate required fields
    if (!locationId) {
      return err('locationId is required')
    }
    if (!name || !printerType || !ipAddress) {
      return err('Name, printer type, and IP address are required')
    }

    // Auth check — require settings.hardware permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Printer count limit check (subscription-gated)
    const { checkDeviceLimit } = await import('@/lib/device-limits')
    const printerLimit = await checkDeviceLimit(locationId, 'printer')
    if (!printerLimit.allowed) {
      return NextResponse.json(
        {
          error: printerLimit.upgradeMessage,
          code: 'DEVICE_LIMIT_EXCEEDED',
          current: printerLimit.current,
          limit: printerLimit.limit,
        },
        { status: 403 }
      )
    }

    // Validate IP address format
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
    if (!ipv4Regex.test(ipAddress)) {
      return err('Invalid IP address format')
    }

    // If setting as default, unset other defaults for the same role
    if (isDefault) {
      await db.printer.updateMany({
        where: {
          locationId,
          printerRole,
          isDefault: true,
        },
        data: { isDefault: false },
      })
    }

    // Use provided printSettings or default based on role
    const defaultSettings = printerRole === 'receipt'
      ? DEFAULT_RECEIPT_TEMPLATE
      : DEFAULT_KITCHEN_TEMPLATE

    const printer = await db.printer.create({
      data: {
        locationId,
        name,
        printerType,
        model,
        ipAddress,
        port,
        printerRole,
        isDefault,
        paperWidth,
        supportsCut,
        printSettings: printSettings || defaultSettings,
      },
    })

    // Notify all terminals that hardware config changed
    void emitToLocation(locationId, 'settings:updated', { source: 'printer', action: 'created', printerId: printer.id }).catch(err => log.warn({ err }, 'Background task failed'))
    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: printer.id })
    void pushUpstream()

    return ok({ printer })
  } catch (error) {
    console.error('Failed to create printer:', error)
    // Check for unique constraint violation (name must be unique per location)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return err('A printer with this name already exists at this location')
    }
    return err('Failed to create printer', 500)
  }
}))

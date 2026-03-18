import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TerminalCategory } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'

// GET all terminals for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const category = searchParams.get('category') as TerminalCategory | null

    let terminals
    try {
      terminals = await db.terminal.findMany({
        where: {
          locationId,
          deletedAt: null,
          ...(category && { category }),
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
          kitchenPrinter: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              printerRole: true,
            },
          },
          barPrinter: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              printerRole: true,
            },
          },
          backupTerminal: {
            select: {
              id: true,
              name: true,
              isOnline: true,
              lastSeenAt: true,
            },
          },
          scale: {
            select: {
              id: true,
              name: true,
              portPath: true,
              isConnected: true,
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    } catch {
      // Fallback for un-migrated databases without Scale table
      terminals = await db.terminal.findMany({
        where: {
          locationId,
          deletedAt: null,
          ...(category && { category }),
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
          backupTerminal: {
            select: {
              id: true,
              name: true,
              isOnline: true,
              lastSeenAt: true,
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    }

    return NextResponse.json({ data: { terminals } })
  } catch (error) {
    console.error('Failed to fetch terminals:', error)
    return NextResponse.json({ error: 'Failed to fetch terminals' }, { status: 500 })
  }
})

// POST create a new terminal
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      category = 'FIXED_STATION',
      platform = 'BROWSER',
      staticIp,
      receiptPrinterId,
      roleSkipRules,
      scaleId,
      employeeId: bodyEmployeeId,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth check — require settings.hardware permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? bodyEmployeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Device count limit check (subscription-gated)
    const { checkDeviceLimit } = await import('@/lib/device-limits')
    const deviceType = category === 'HANDHELD' ? 'handheld' as const : 'terminal' as const
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

    // Validate required fields
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Validate category
    if (!['FIXED_STATION', 'HANDHELD'].includes(category)) {
      return NextResponse.json(
        { error: 'Category must be FIXED_STATION or HANDHELD' },
        { status: 400 }
      )
    }

    // Validate platform
    if (!['BROWSER', 'ANDROID', 'IOS'].includes(platform)) {
      return NextResponse.json(
        { error: 'Platform must be BROWSER, ANDROID, or IOS' },
        { status: 400 }
      )
    }

    // Validate IP address format if provided
    if (staticIp) {
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (!ipv4Regex.test(staticIp)) {
        return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
      }
    }

    // If receiptPrinterId is provided, verify it exists and is a receipt printer
    if (receiptPrinterId) {
      const printer = await db.printer.findUnique({
        where: { id: receiptPrinterId },
      })
      if (!printer) {
        return NextResponse.json({ error: 'Receipt printer not found' }, { status: 400 })
      }
      if (printer.printerRole !== 'receipt') {
        return NextResponse.json(
          { error: 'Selected printer must have receipt role' },
          { status: 400 }
        )
      }
    }

    // Validate scale if provided (skip if table doesn't exist)
    const cleanScaleId = scaleId || null
    if (cleanScaleId) {
      try {
        const scale = await db.scale.findFirst({
          where: { id: cleanScaleId, deletedAt: null },
        })
        if (!scale) {
          return NextResponse.json({ error: 'Scale not found' }, { status: 400 })
        }
      } catch {
        // Scale table doesn't exist on un-migrated DB — ignore scaleId
      }
    }

    let terminal
    try {
      terminal = await db.terminal.create({
        data: {
          locationId,
          name,
          category,
          platform,
          staticIp: staticIp || null,
          receiptPrinterId: receiptPrinterId || null,
          roleSkipRules: roleSkipRules || {},
          scaleId: cleanScaleId,
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
          scale: {
            select: {
              id: true,
              name: true,
              portPath: true,
              isConnected: true,
            },
          },
        },
      })
    } catch (createErr) {
      // Fallback for un-migrated databases without Scale table/column
      terminal = await db.terminal.create({
        data: {
          locationId,
          name,
          category,
          platform,
          staticIp: staticIp || null,
          receiptPrinterId: receiptPrinterId || null,
          roleSkipRules: roleSkipRules || {},
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
    }

    return NextResponse.json({ data: { terminal } })
  } catch (error) {
    console.error('Failed to create terminal:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A terminal with this name already exists at this location' },
        { status: 400 }
      )
    }
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to create terminal: ${msg}` }, { status: 500 })
  }
})

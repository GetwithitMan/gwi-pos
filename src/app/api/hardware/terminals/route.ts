import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TerminalCategory } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withAuth } from '@/lib/api-auth-middleware'

/** Validate IPv4 address — each octet must be 0-255 with no leading zeros */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every(p => {
    const n = parseInt(p, 10)
    return n >= 0 && n <= 255 && String(n) === p
  })
}

// GET all terminals for a location
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth check — require settings.hardware permission (read access)
    // Use cookie-based actor, fall back to query param for dev/API clients
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? searchParams.get('employeeId')
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.SETTINGS_HARDWARE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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
}))

// POST create a new terminal
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      category = 'FIXED_STATION',
      platform = 'BROWSER',
      staticIp,
      receiptPrinterId,
      kitchenPrinterId,
      barPrinterId,
      roleSkipRules,
      scaleId,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Auth check — require settings.hardware permission
    // Use cookie-based actor, fall back to body employeeId for dev/API clients
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
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
      if (!isValidIPv4(staticIp)) {
        return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
      }
    }

    // Validate printers belong to the same location
    const printerChecks: { id: string; label: string; requiredRole?: string }[] = []
    if (receiptPrinterId) printerChecks.push({ id: receiptPrinterId, label: 'Receipt printer', requiredRole: 'receipt' })
    if (kitchenPrinterId) printerChecks.push({ id: kitchenPrinterId, label: 'Kitchen printer', requiredRole: 'kitchen' })
    if (barPrinterId) printerChecks.push({ id: barPrinterId, label: 'Bar printer', requiredRole: 'bar' })

    if (printerChecks.length > 0) {
      const printerIds = printerChecks.map((p) => p.id)
      const printers = await db.printer.findMany({
        where: { id: { in: printerIds } },
        select: { id: true, locationId: true, printerRole: true },
      })

      for (const check of printerChecks) {
        const printer = printers.find((p) => p.id === check.id)
        if (!printer) {
          return NextResponse.json({ error: `${check.label} not found` }, { status: 400 })
        }
        if (printer.locationId !== locationId) {
          return NextResponse.json(
            { error: `${check.label} belongs to a different location` },
            { status: 403 }
          )
        }
        if (check.requiredRole && printer.printerRole !== check.requiredRole) {
          return NextResponse.json(
            { error: `${check.label} must have ${check.requiredRole} role` },
            { status: 400 }
          )
        }
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
        if (scale.locationId !== locationId) {
          return NextResponse.json(
            { error: 'Scale belongs to a different location' },
            { status: 403 }
          )
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
          kitchenPrinterId: kitchenPrinterId || null,
          barPrinterId: barPrinterId || null,
          roleSkipRules: roleSkipRules || {},
          scaleId: cleanScaleId,
          lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
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
          kitchenPrinterId: kitchenPrinterId || null,
          barPrinterId: barPrinterId || null,
          roleSkipRules: roleSkipRules || {},
          lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
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
        },
      })
    }

    void notifyDataChanged({ locationId, domain: 'hardware', action: 'created', entityId: terminal.id })

    return NextResponse.json({ data: { terminal } })
  } catch (error: any) {
    console.error('Failed to create terminal:', error)
    if (error?.code === 'P2002') {
      const target = error.meta?.target as string[] | undefined
      if (target?.includes('scaleId')) {
        return NextResponse.json(
          { error: 'This scale is already assigned to another terminal' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'A terminal with this name already exists' },
        { status: 409 }
      )
    }
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to create terminal: ${msg}` }, { status: 500 })
  }
}))

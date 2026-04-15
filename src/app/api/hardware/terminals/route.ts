import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TerminalCategory } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, forbidden, ok } from '@/lib/api-response'

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
      return err('locationId is required')
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

    return ok({ terminals })
  } catch (error) {
    console.error('Failed to fetch terminals:', error)
    return err('Failed to fetch terminals', 500)
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
      return err('locationId is required')
    }

    const isCFD = category === 'CFD_DISPLAY'

    // Device count limit check (subscription-gated)
    const { checkDeviceLimit } = await import('@/lib/device-limits')
    const deviceType = isCFD
      ? 'cfd' as const
      : category === 'HANDHELD' ? 'handheld' as const : 'terminal' as const
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
      return err('Name is required')
    }

    // Validate category
    if (!['FIXED_STATION', 'HANDHELD', 'CFD_DISPLAY'].includes(category)) {
      return err('Category must be FIXED_STATION, HANDHELD, or CFD_DISPLAY')
    }

    // Validate platform
    if (!['BROWSER', 'ANDROID', 'IOS'].includes(platform)) {
      return err('Platform must be BROWSER, ANDROID, or IOS')
    }

    if (!isCFD) {
      // Validate IP address format if provided
      if (staticIp) {
        if (!isValidIPv4(staticIp)) {
          return err('Invalid IP address format')
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
            return err(`${check.label} not found`)
          }
          if (printer.locationId !== locationId) {
            return forbidden(`${check.label} belongs to a different location`)
          }
          if (check.requiredRole && printer.printerRole !== check.requiredRole) {
            return err(`${check.label} must have ${check.requiredRole} role`)
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
            return err('Scale not found')
          }
          if (scale.locationId !== locationId) {
            return forbidden('Scale belongs to a different location')
          }
        } catch {
          // Scale table doesn't exist on un-migrated DB — ignore scaleId
        }
      }
    }

    // Check for active terminal with same name (soft-delete-safe uniqueness)
    const existingActive = await db.terminal.findFirst({
      where: { locationId, name, deletedAt: null },
      select: { id: true },
    })
    if (existingActive) {
      return err('A terminal with this name already exists at this location', 409)
    }

    const cfdData = isCFD ? {
      deviceToken: crypto.randomBytes(32).toString('hex'),
      isPaired: true,
    } : {}

    let terminal
    try {
      terminal = await db.terminal.create({
        data: {
          locationId,
          name,
          category,
          platform,
          staticIp: staticIp || null,
          receiptPrinterId: isCFD ? null : (receiptPrinterId || null),
          kitchenPrinterId: isCFD ? null : (kitchenPrinterId || null),
          barPrinterId: isCFD ? null : (barPrinterId || null),
          roleSkipRules: roleSkipRules || {},
          scaleId: isCFD ? null : (scaleId || null),
          lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
          ...cfdData,
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
          receiptPrinterId: isCFD ? null : (receiptPrinterId || null),
          kitchenPrinterId: isCFD ? null : (kitchenPrinterId || null),
          barPrinterId: isCFD ? null : (barPrinterId || null),
          roleSkipRules: roleSkipRules || {},
          lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
          ...cfdData,
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
    void pushUpstream()

    return ok({ terminal })
  } catch (error: any) {
    console.error('Failed to create terminal:', error)
    if (error?.code === 'P2002') {
      const target = error.meta?.target as string[] | undefined
      if (target?.includes('scaleId')) {
        return err('This scale is already assigned to another terminal', 409)
      }
      return err('A terminal with this name already exists', 409)
    }
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return err(`Failed to create terminal: ${msg}`, 500)
  }
}))

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ShiftStatus } from '@/generated/prisma/client'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { queueIfOutage, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'

const log = createChildLogger('shifts')

// ── Zod schema for POST /api/shifts ─────────────────────────────────
const CreateShiftSchema = z.object({
  locationId: z.string().min(1, 'Location ID is required'),
  employeeId: z.string().min(1, 'Employee ID is required'),
  startingCash: z.number().nonnegative().optional(),
  notes: z.string().max(1000).optional().nullable(),
  drawerId: z.string().min(1).optional(),
  workingRoleId: z.string().min(1).optional(),
  cashHandlingMode: z.enum(['drawer', 'purse', 'none']).optional(),
}).passthrough()

// GET - List shifts with optional filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId') || process.env.POS_LOCATION_ID || process.env.LOCATION_ID
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status') as ShiftStatus | null
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return err('Location ID is required')
    }

    const shifts = await db.shift.findMany({
      where: {
        locationId,
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status } : {}),
        ...(startDate || endDate ? {
          startedAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: {
              select: { permissions: true },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    return ok({
      shifts: shifts.map(shift => ({
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
          permissions: Array.isArray(shift.employee.role?.permissions) ? shift.employee.role.permissions as string[] : [],
        },
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt?.toISOString() || null,
        status: shift.status,
        startingCash: Number(shift.startingCash),
        expectedCash: shift.expectedCash ? Number(shift.expectedCash) : null,
        actualCash: shift.actualCash ? Number(shift.actualCash) : null,
        variance: shift.variance ? Number(shift.variance) : null,
        totalSales: shift.totalSales ? Number(shift.totalSales) : null,
        cashSales: shift.cashSales ? Number(shift.cashSales) : null,
        cardSales: shift.cardSales ? Number(shift.cardSales) : null,
        tipsDeclared: shift.tipsDeclared ? Number(shift.tipsDeclared) : null,
        drawerId: shift.drawerId || null,
        notes: shift.notes,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch shifts:', error)
    return err('Failed to fetch shifts', 500)
  }
})

// POST - Start a new shift
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const parseResult = CreateShiftSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data
    const { locationId, employeeId, startingCash, notes, drawerId, workingRoleId, cashHandlingMode } = body

    // Auth check — require manager shift review permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.MGR_SHIFT_REVIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    const mode = cashHandlingMode || 'drawer'

    // Validate based on cash handling mode
    if (mode === 'drawer') {
      if (startingCash === undefined || startingCash < 0) {
        return err('Starting cash amount is required for drawer mode')
      }
      if (!drawerId) {
        return err('Drawer selection is required for drawer mode')
      }
    } else if (mode === 'purse') {
      if (startingCash === undefined || startingCash < 0) {
        return err('Starting purse amount is required')
      }
    }
    // mode === 'none' — no cash validation needed

    // Check if employee already has an open shift
    const existingShift = await db.shift.findFirst({
      where: {
        employeeId,
        locationId,
        status: ShiftStatus.open,
      },
    })

    if (existingShift) {
      return err('Employee already has an open shift. Please close it first.')
    }

    // If drawer mode, verify drawer isn't already claimed
    if (drawerId) {
      const drawerClaimed = await db.shift.findFirst({
        where: {
          drawerId,
          status: ShiftStatus.open,
          deletedAt: null,
        },
        include: {
          employee: {
            select: { displayName: true, firstName: true, lastName: true },
          },
        },
      })
      if (drawerClaimed) {
        const claimedBy = drawerClaimed.employee.displayName
          || `${drawerClaimed.employee.firstName} ${drawerClaimed.employee.lastName}`
        return err(`Drawer already claimed by ${claimedBy}`, 409)
      }
    }

    // Look up active time clock entry to link
    const activeClockEntry = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
        deletedAt: null,
      },
      select: { id: true },
    })

    // Create new shift
    const shift = await db.shift.create({
      data: {
        locationId,
        employeeId,
        startingCash: startingCash ?? 0,
        notes,
        status: ShiftStatus.open,
        timeClockEntryId: activeClockEntry?.id || null,
        ...(drawerId ? { drawerId } : {}),
        ...(workingRoleId ? { workingRoleId } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    // Queue for Neon replay if in outage mode (fire-and-forget)
    queueIfOutage('Shift', locationId, shift.id, 'INSERT', shift as unknown as Record<string, unknown>)
    pushUpstream()

    // Real-time cross-terminal update
    void emitToLocation(locationId, 'shifts:changed', { action: 'started', shiftId: shift.id, employeeId }).catch(err => log.warn({ err }, 'socket emit failed'))

    return ok({
      shift: {
        id: shift.id,
        employee: {
          id: shift.employee.id,
          name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
        },
        startedAt: shift.startedAt.toISOString(),
        startingCash: Number(shift.startingCash),
        status: shift.status,
      },
      message: 'Shift started successfully',
    })
  } catch (error) {
    console.error('Failed to start shift:', error)
    return err('Failed to start shift', 500)
  }
})

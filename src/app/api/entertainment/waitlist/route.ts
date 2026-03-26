import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { EntertainmentWaitlistStatus } from '@/generated/prisma/client'
import { dispatchFloorPlanUpdate, dispatchEntertainmentWaitlistNotify, dispatchEntertainmentWaitlistChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { formatWaitTime, calculateWaitMinutes } from '@/lib/domain/entertainment'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - List waitlist entries for floor plan elements
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const elementId = searchParams.get('elementId')
    const visualType = searchParams.get('visualType')
    const status = (searchParams.get('status') || 'waiting') as EntertainmentWaitlistStatus | 'all'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const waitlist = await db.entertainmentWaitlist.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(elementId ? { elementId } : {}),
        ...(visualType ? { visualType } : {}),
        ...(status !== 'all' ? { status } : {}),
      },
      include: {
        element: {
          select: {
            id: true,
            name: true,
            visualType: true,
            status: true,
          },
        },
        table: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { status: 'asc' },
        { position: 'asc' },
        { requestedAt: 'asc' },
      ],
    })

    // Calculate wait times
    const now = new Date()

    const enrichedWaitlist = waitlist.map(entry => {
      const waitMinutes = calculateWaitMinutes(entry.requestedAt, now)

      return {
        id: entry.id,
        customerName: entry.customerName,
        phone: entry.phone,
        partySize: entry.partySize,
        notes: entry.notes,
        status: entry.status,
        position: entry.position,
        waitMinutes,
        waitTimeFormatted: formatWaitTime(waitMinutes),
        elementId: entry.elementId,
        visualType: entry.visualType,
        element: entry.element ? {
          id: entry.element.id,
          name: entry.element.name,
          visualType: entry.element.visualType,
          status: entry.element.status,
        } : null,
        table: entry.table ? {
          id: entry.table.id,
          name: entry.table.name,
        } : null,
        requestedAt: entry.requestedAt.toISOString(),
        notifiedAt: entry.notifiedAt?.toISOString() || null,
        seatedAt: entry.seatedAt?.toISOString() || null,
        expiresAt: entry.expiresAt?.toISOString() || null,
        // Deposit fields
        depositAmount: entry.depositAmount ? Number(entry.depositAmount) : null,
        depositMethod: entry.depositMethod,
        depositRecordNo: entry.depositRecordNo,
        depositCardLast4: entry.depositCardLast4,
        depositCardBrand: entry.depositCardBrand,
        depositStatus: entry.depositStatus,
        depositCollectedBy: entry.depositCollectedBy,
        depositRefundedAt: entry.depositRefundedAt?.toISOString() || null,
      }
    })

    return NextResponse.json({ data: {
      waitlist: enrichedWaitlist,
      counts: {
        waiting: enrichedWaitlist.filter(w => w.status === 'waiting').length,
        notified: enrichedWaitlist.filter(w => w.status === 'notified').length,
        seated: enrichedWaitlist.filter(w => w.status === 'seated').length,
      },
    } })
  } catch (error) {
    console.error('Failed to fetch waitlist:', error)
    return NextResponse.json(
      { error: 'Failed to fetch waitlist' },
      { status: 500 }
    )
  }
})

// POST - Add to waitlist
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      elementId,
      visualType,
      tableId,
      customerName,
      phone,
      partySize,
      notes,
      expiresInMinutes,
      employeeId,
    } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Permission check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_ENTERTAINMENT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!elementId && !visualType) {
      return NextResponse.json(
        { error: 'Either elementId or visualType is required' },
        { status: 400 }
      )
    }

    if (!customerName && !tableId) {
      return NextResponse.json(
        { error: 'Either customer name or table ID is required' },
        { status: 400 }
      )
    }

    // Verify element exists if elementId provided
    let linkedMenuItemId: string | null = null
    if (elementId) {
      const element = await db.floorPlanElement.findUnique({
        where: { id: elementId },
        select: { id: true, locationId: true, linkedMenuItemId: true },
      })
      linkedMenuItemId = element?.linkedMenuItemId || null

      if (!element) {
        return NextResponse.json(
          { error: 'Element not found' },
          { status: 404 }
        )
      }

      if (element.locationId !== locationId) {
        return NextResponse.json(
          { error: 'Element does not belong to this location' },
          { status: 400 }
        )
      }
    }

    // Calculate expiry
    const expiresAt = expiresInMinutes
      ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
      : null

    // Create waitlist entry with transaction to prevent race condition
    const entry = await db.$transaction(async (tx) => {
      const currentWaitlistCount = await tx.entertainmentWaitlist.count({
        where: {
          locationId,
          deletedAt: null,
          status: EntertainmentWaitlistStatus.waiting,
          ...(elementId ? { elementId } : { visualType }),
        },
      })

      return tx.entertainmentWaitlist.create({
        data: {
          locationId,
          elementId: elementId || null,
          visualType: visualType || null,
          tableId: tableId || null,
          customerName: customerName?.trim() || null,
          phone: phone?.trim() || null,
          partySize: partySize || 1,
          notes: notes?.trim() || null,
          position: currentWaitlistCount + 1,
          status: EntertainmentWaitlistStatus.waiting,
          expiresAt,
        },
        include: {
          element: {
            select: {
              id: true,
              name: true,
              visualType: true,
              status: true,
            },
          },
          table: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    })

    pushUpstream()

    // Notify all terminals of new waitlist entry
    dispatchEntertainmentWaitlistNotify(locationId, {
      entryId: entry.id,
      customerName: entry.customerName,
      elementId: entry.elementId,
      elementName: entry.element?.name || entry.element?.visualType || null,
      partySize: entry.partySize,
      action: 'added',
      message: `${entry.customerName || 'Customer'} added to waitlist at position ${entry.position}`,
    }, { async: true })

    // Dispatch waitlist count change to POS menu grids
    if (linkedMenuItemId) {
      dispatchEntertainmentWaitlistChanged(locationId, {
        itemId: linkedMenuItemId,
        waitlistCount: entry.position, // position = new count after adding
      }, { async: true })
    }

    // Dispatch real-time update
    dispatchFloorPlanUpdate(locationId, { async: true })

    // Check if deposits are enabled for this location
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const waitlistSettings = settings.waitlist
    const depositRequired = waitlistSettings?.depositEnabled === true
    const depositAmountSetting = waitlistSettings?.depositAmount ?? 25

    // Audit trail: waitlist entry added
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: auth.employee.id,
        action: 'entertainment_waitlist_added',
        entityType: 'entertainment_waitlist',
        entityId: entry.id,
        details: {
          customerName: entry.customerName,
          partySize: entry.partySize,
          position: entry.position,
          elementId: entry.elementId,
          elementName: entry.element?.name || entry.element?.visualType || null,
          employeeName: auth.employee.displayName || `${auth.employee.firstName} ${auth.employee.lastName}`,
        },
      },
    }).catch(err => console.error('[entertainment] Audit log failed:', err))

    return NextResponse.json({ data: {
      entry: {
        id: entry.id,
        customerName: entry.customerName,
        phone: entry.phone,
        partySize: entry.partySize,
        notes: entry.notes,
        status: entry.status,
        position: entry.position,
        elementId: entry.elementId,
        visualType: entry.visualType,
        element: entry.element,
        table: entry.table,
        requestedAt: entry.requestedAt.toISOString(),
        expiresAt: entry.expiresAt?.toISOString() || null,
        depositAmount: null,
        depositMethod: null,
        depositRecordNo: null,
        depositCardLast4: null,
        depositCardBrand: null,
        depositStatus: null,
        depositCollectedBy: null,
        depositRefundedAt: null,
      },
      ...(depositRequired ? {
        depositRequired: true,
        depositAmount: depositAmountSetting,
        allowCashDeposit: waitlistSettings?.allowCashDeposit !== false,
      } : {}),
      message: `Added ${customerName || 'Table'} to waitlist at position ${entry.position}`,
    } })
  } catch (error) {
    console.error('Failed to add to waitlist:', error)
    return NextResponse.json(
      { error: 'Failed to add to waitlist' },
      { status: 500 }
    )
  }
})

// formatWaitTime moved to @/lib/domain/entertainment/validation.ts

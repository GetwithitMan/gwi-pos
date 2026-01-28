import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List waitlist entries
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const menuItemId = searchParams.get('menuItemId')
    const status = searchParams.get('status') || 'waiting'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const waitlist = await db.entertainmentWaitlist.findMany({
      where: {
        locationId,
        ...(menuItemId ? { menuItemId } : {}),
        ...(status !== 'all' ? { status } : {}),
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            displayName: true,
            entertainmentStatus: true,
          },
        },
      },
      orderBy: [
        { status: 'asc' }, // waiting first, then notified, seated, cancelled
        { createdAt: 'asc' },
      ],
    })

    // Calculate positions and wait times
    const now = new Date()
    const waitlistByItem: Record<string, number> = {}

    const enrichedWaitlist = waitlist.map(entry => {
      // Calculate position within same item
      if (!waitlistByItem[entry.menuItemId]) {
        waitlistByItem[entry.menuItemId] = 0
      }
      if (entry.status === 'waiting') {
        waitlistByItem[entry.menuItemId]++
      }

      const waitMinutes = Math.floor((now.getTime() - entry.createdAt.getTime()) / 1000 / 60)

      return {
        id: entry.id,
        customerName: entry.customerName,
        phoneNumber: entry.phoneNumber,
        partySize: entry.partySize,
        notes: entry.notes,
        status: entry.status,
        position: entry.status === 'waiting' ? waitlistByItem[entry.menuItemId] : null,
        waitMinutes,
        waitTimeFormatted: formatWaitTime(waitMinutes),
        menuItemId: entry.menuItemId,
        menuItem: {
          id: entry.menuItem.id,
          name: entry.menuItem.displayName || entry.menuItem.name,
          status: entry.menuItem.entertainmentStatus,
        },
        // Tab info
        tabId: entry.tabId,
        tabName: entry.tabName,
        // Deposit info
        depositAmount: entry.depositAmount ? Number(entry.depositAmount) : null,
        depositMethod: entry.depositMethod,
        depositCardLast4: entry.depositCardLast4,
        depositRefunded: entry.depositRefunded,
        notifiedAt: entry.notifiedAt?.toISOString() || null,
        seatedAt: entry.seatedAt?.toISOString() || null,
        createdAt: entry.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      waitlist: enrichedWaitlist,
      counts: {
        waiting: enrichedWaitlist.filter(w => w.status === 'waiting').length,
        notified: enrichedWaitlist.filter(w => w.status === 'notified').length,
        seated: enrichedWaitlist.filter(w => w.status === 'seated').length,
      },
    })
  } catch (error) {
    console.error('Failed to fetch waitlist:', error)
    return NextResponse.json(
      { error: 'Failed to fetch waitlist' },
      { status: 500 }
    )
  }
}

// POST - Add to waitlist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      menuItemId,
      customerName,
      phoneNumber,
      partySize,
      notes,
      employeeId,
      // Tab options
      tabId,
      createNewTab,
      newTabCardLast4,
      newTabPreAuthAmount,
      // Deposit options
      depositAmount,
      depositMethod,
      depositCardLast4,
    } = body

    if (!locationId || !menuItemId || !customerName) {
      return NextResponse.json(
        { error: 'Location ID, menu item ID, and customer name are required' },
        { status: 400 }
      )
    }

    // Verify the menu item exists and is entertainment type
    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, name: true, itemType: true, locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    if (menuItem.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Menu item does not belong to this location' },
        { status: 400 }
      )
    }

    if (menuItem.itemType !== 'timed_rental') {
      return NextResponse.json(
        { error: 'This menu item is not an entertainment item' },
        { status: 400 }
      )
    }

    // Handle tab linking
    let linkedTabId = tabId || null
    let linkedTabName = null

    // If linking to existing tab, verify it exists
    if (tabId) {
      const existingTab = await db.order.findUnique({
        where: { id: tabId },
        select: { id: true, tabName: true, status: true },
      })
      if (!existingTab || existingTab.status !== 'open') {
        return NextResponse.json(
          { error: 'Tab not found or is closed' },
          { status: 400 }
        )
      }
      linkedTabName = existingTab.tabName
    }

    // Create a new tab if requested
    if (createNewTab && !tabId) {
      // Generate order number
      const orderCount = await db.order.count({
        where: { locationId },
      })
      const orderNumber = orderCount + 1

      // Get employee ID - use provided or find any active employee
      let tabEmployeeId = employeeId
      if (!tabEmployeeId) {
        const anyEmployee = await db.employee.findFirst({
          where: { locationId, isActive: true },
          select: { id: true },
        })
        if (!anyEmployee) {
          return NextResponse.json(
            { error: 'No active employees found for this location' },
            { status: 400 }
          )
        }
        tabEmployeeId = anyEmployee.id
      }

      const newTab = await db.order.create({
        data: {
          locationId,
          employeeId: tabEmployeeId,
          orderNumber,
          orderType: 'bar',
          tabName: `${customerName}'s Tab`,
          status: 'open',
          subtotal: 0,
          taxTotal: 0,
          tipTotal: 0,
          discountTotal: 0,
          total: 0,
          preAuthAmount: newTabPreAuthAmount || null,
          preAuthLast4: newTabCardLast4 || null,
        },
      })
      linkedTabId = newTab.id
      linkedTabName = newTab.tabName
    }

    // Get current position
    const currentWaitlistCount = await db.entertainmentWaitlist.count({
      where: {
        menuItemId,
        status: 'waiting',
      },
    })

    // Create waitlist entry with tab and deposit info
    const entry = await db.entertainmentWaitlist.create({
      data: {
        locationId,
        menuItemId,
        customerName: customerName.trim(),
        phoneNumber: phoneNumber?.trim() || null,
        partySize: partySize || 1,
        notes: notes?.trim() || null,
        tabId: linkedTabId,
        tabName: linkedTabName,
        depositAmount: depositAmount || null,
        depositMethod: depositMethod || null,
        depositCardLast4: depositCardLast4 || null,
        status: 'waiting',
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            displayName: true,
            entertainmentStatus: true,
          },
        },
      },
    })

    return NextResponse.json({
      entry: {
        id: entry.id,
        customerName: entry.customerName,
        phoneNumber: entry.phoneNumber,
        partySize: entry.partySize,
        notes: entry.notes,
        status: entry.status,
        position: currentWaitlistCount + 1,
        tabId: entry.tabId,
        tabName: entry.tabName,
        depositAmount: entry.depositAmount ? Number(entry.depositAmount) : null,
        depositMethod: entry.depositMethod,
        menuItem: {
          id: entry.menuItem.id,
          name: entry.menuItem.displayName || entry.menuItem.name,
          status: entry.menuItem.entertainmentStatus,
        },
        createdAt: entry.createdAt.toISOString(),
      },
      message: `Added ${customerName} to waitlist at position ${currentWaitlistCount + 1}`,
      newTabCreated: createNewTab && linkedTabId ? { id: linkedTabId, name: linkedTabName } : null,
    })
  } catch (error) {
    console.error('Failed to add to waitlist:', error)
    return NextResponse.json(
      { error: 'Failed to add to waitlist' },
      { status: 500 }
    )
  }
}

function formatWaitTime(minutes: number): string {
  if (minutes < 1) return 'Just now'
  if (minutes === 1) return '1 min'
  if (minutes < 60) return `${minutes} mins`

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours === 1 && mins === 0) return '1 hour'
  if (hours === 1) return `1 hr ${mins} min`
  if (mins === 0) return `${hours} hours`
  return `${hours} hrs ${mins} min`
}

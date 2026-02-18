import { NextResponse } from 'next/server'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { invalidateLocationCache } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'

const VALID_DOMAINS = ['menu', 'floorplan', 'settings', 'employees', 'order-types'] as const
type Domain = typeof VALID_DOMAINS[number]

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { domain, action, entityId, locationId } = body as {
      domain: Domain
      action?: string
      entityId?: string
      locationId?: string
    }

    if (!domain || !VALID_DOMAINS.includes(domain)) {
      return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
    }

    if (process.env.NODE_ENV !== 'production') console.log(`[Cache Invalidate] domain=${domain} action=${action || ''} entityId=${entityId || ''}`)

    // Get locationId from env if not provided (NUC always has one location)
    const locId = locationId || process.env.LOCATION_ID || ''

    switch (domain) {
      case 'menu':
        if (locId) invalidateMenuCache(locId)
        // Also invalidate with empty string to catch unfiltered queries
        invalidateMenuCache('')
        void emitToLocation(locId, 'menu:updated', { action, entityId })
        void emitToLocation(locId, 'menu:structure-changed', { action, entityId })
        break

      case 'floorplan':
        void emitToLocation(locId, 'floor-plan:updated', { action, entityId })
        break

      case 'settings':
        if (locId) invalidateLocationCache(locId)
        void emitToLocation(locId, 'settings:updated', { action, entityId })
        break

      case 'employees':
        void emitToLocation(locId, 'employees:updated', { action, entityId })
        break

      case 'order-types':
        void emitToLocation(locId, 'order-types:updated', { action, entityId })
        break
    }

    return NextResponse.json({ data: { success: true, domain, action } })
  } catch (err) {
    console.error('[Cache Invalidate] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

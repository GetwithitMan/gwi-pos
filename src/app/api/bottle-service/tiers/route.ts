import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitToLocation } from '@/lib/socket-server'
import { err, ok } from '@/lib/api-response'

// GET - List bottle service tiers for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const tiers = await db.bottleServiceTier.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    })

    return ok(tiers.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        color: t.color,
        depositAmount: Number(t.depositAmount),
        minimumSpend: Number(t.minimumSpend),
        autoGratuityPercent: t.autoGratuityPercent ? Number(t.autoGratuityPercent) : null,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
      })))
  } catch (error) {
    console.error('Failed to list bottle service tiers:', error)
    return err('Failed to list bottle service tiers', 500)
  }
})

// POST - Create a new bottle service tier
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, color, depositAmount, minimumSpend, autoGratuityPercent, sortOrder } = body

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    if (!name || depositAmount == null || minimumSpend == null) {
      return err('Missing required fields: name, depositAmount, minimumSpend')
    }

    const auth = await requirePermission(body.employeeId || null, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // App-level uniqueness guard
    const existing = await db.bottleServiceTier.findFirst({
      where: { locationId, name, deletedAt: null },
    })
    if (existing) {
      return err(`A tier named "${name}" already exists`, 409)
    }

    const tier = await db.bottleServiceTier.create({
      data: {
        locationId,
        name,
        description,
        color: color || '#D4AF37',
        depositAmount,
        minimumSpend,
        autoGratuityPercent: autoGratuityPercent ?? null,
        sortOrder: sortOrder ?? 0,
        lastMutatedBy: 'cloud',
      },
    })

    void emitToLocation(locationId, 'settings:updated', { source: 'bottle-service-tier', action: 'created', tierId: tier.id }).catch(console.error)

    return ok({
        id: tier.id,
        name: tier.name,
        description: tier.description,
        color: tier.color,
        depositAmount: Number(tier.depositAmount),
        minimumSpend: Number(tier.minimumSpend),
        autoGratuityPercent: tier.autoGratuityPercent ? Number(tier.autoGratuityPercent) : null,
        sortOrder: tier.sortOrder,
        isActive: tier.isActive,
      })
  } catch (error) {
    console.error('Failed to create bottle service tier:', error)
    return err('Failed to create bottle service tier', 500)
  }
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { created, err, ok } from '@/lib/api-response'

/**
 * GET /api/berg/plu-mappings
 * Returns PLU mappings for a location.
 * Query params: locationId (required), deviceId (optional filter)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const deviceId = searchParams.get('deviceId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return err('locationId is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const where: Record<string, unknown> = { locationId }
    if (deviceId) where.deviceId = deviceId

    const mappings = await db.bergPluMapping.findMany({
      where,
      orderBy: { pluNumber: 'asc' },
    })

    return ok({ mappings })
  } catch (caughtErr) {
    console.error('[berg/plu-mappings GET]', err)
    return err('Failed to load PLU mappings', 500)
  }
})

/**
 * POST /api/berg/plu-mappings
 * Create a new PLU mapping.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      deviceId,
      pluNumber,
      bottleProductId,
      inventoryItemId,
      menuItemId,
      description,
      pourSizeOzOverride,
      modifierRule,
      trailerRule,
    } = body

    if (!locationId || pluNumber === undefined || pluNumber === null) {
      return err('locationId and pluNumber are required')
    }

    const requestingEmployeeId = body.requestingEmployeeId || body.employeeId || ''
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const mappingScopeKey = deviceId ? `device:${deviceId}` : `location:${locationId}`

    const mapping = await db.bergPluMapping.create({
      data: {
        locationId,
        deviceId: deviceId || null,
        mappingScopeKey,
        pluNumber: Number(pluNumber),
        bottleProductId: bottleProductId || null,
        inventoryItemId: inventoryItemId || null,
        menuItemId: menuItemId || null,
        description: description || null,
        pourSizeOzOverride: pourSizeOzOverride ? String(pourSizeOzOverride) : null,
        modifierRule: modifierRule || null,
        trailerRule: trailerRule || null,
      },
    })

    return created({ mapping })
  } catch (caughtErr: unknown) {
    const error = caughtErr as { code?: string; message?: string }
    if (error?.code === 'P2002') {
      return err('PLU number already mapped for this scope', 409)
    }
    console.error('[berg/plu-mappings POST]', caughtErr)
    return err('Failed to create PLU mapping', 500)
  }
})

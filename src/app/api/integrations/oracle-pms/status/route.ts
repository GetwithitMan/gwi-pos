import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { db } from '@/lib/db'
import { notFound, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET() {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return notFound('No location')

  const settings = parseSettings(await getLocationSettings(location.id))
  const pms = settings.hotelPms

  const configured = !!(
    pms?.enabled &&
    pms.baseUrl &&
    pms.clientId &&
    pms.clientSecret &&
    pms.appKey &&
    pms.hotelId &&
    pms.chargeCode
  )

  return ok({
      configured,
      enabled: pms?.enabled ?? false,
      environment: pms?.environment ?? 'cert',
      hotelId: pms?.hotelId ?? null,
      chargeCode: pms?.chargeCode ?? null,
    })
})

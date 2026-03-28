import { NextRequest } from 'next/server'
import { getDatacapClient, parseBody } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

interface CardLookupRequest {
  locationId: string
  readerId: string
}

/**
 * POST /api/datacap/card-lookup
 *
 * Performs a CardLookup on the reader to detect card type (debit vs credit)
 * without placing a charge. Used by Model 3 (dual_price_pan_debit) to
 * determine the correct pricing tier before sending the actual sale.
 */
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(request: NextRequest) {
  try {
    const body = await parseBody<CardLookupRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return err('Missing required fields: locationId, readerId')
    }

    const client = await getDatacapClient(locationId)
    const result = await client.cardLookup(readerId)

    return ok(result)
  } catch (caughtErr) {
    const message = err instanceof Error ? err.message : 'CardLookup failed'
    return err(message, 500)
  }
}))

import { NextRequest } from 'next/server'
import { getDatacapClient, parseBody } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

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
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<CardLookupRequest>(request)
    const { locationId, readerId } = body

    if (!locationId || !readerId) {
      return Response.json(
        { error: 'Missing required fields: locationId, readerId' },
        { status: 400 }
      )
    }

    const client = await getDatacapClient(locationId)
    const result = await client.cardLookup(readerId)

    return Response.json({ data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CardLookup failed'
    return Response.json({ error: message }, { status: 500 })
  }
})

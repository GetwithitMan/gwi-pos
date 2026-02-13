import { NextResponse } from 'next/server'
import { getRandomCard, generateAuthCode, delay, randomBetween } from '@/lib/mock-cards'
import { checkSimulatedReaderAccess } from '../guard'
import { withVenue } from '@/lib/with-venue'

/**
 * Simulated Datacap Reader - Process Transaction
 * Mimics POST /v1/process on a physical Datacap reader.
 * Uses mock card database for realistic simulation with ~5% decline rate.
 * BLOCKED in production via NODE_ENV guard.
 */
export const POST = withVenue(async function POST(request: Request) {
  const blocked = checkSimulatedReaderAccess()
  if (blocked) return blocked

  const body = await request.json()

  // Validate Amount
  const rawAmount = body.Amount
  const amount = parseFloat(rawAmount)
  if (!rawAmount || isNaN(amount) || amount <= 0) {
    console.error('[simulated-reader] Invalid amount:', rawAmount)
    return NextResponse.json(
      { error: 'Invalid amount: must be a positive number', approved: false },
      { status: 400 }
    )
  }

  // Validate TranType
  const tranType = body.TranType
  if (!tranType || !['Sale', 'Auth'].includes(tranType)) {
    console.error('[simulated-reader] Invalid TranType:', tranType)
    return NextResponse.json(
      { error: 'Invalid TranType: must be Sale or Auth', approved: false },
      { status: 400 }
    )
  }

  // Validate Invoice (orderId)
  const invoice = body.Invoice
  if (!invoice || typeof invoice !== 'string') {
    console.error('[simulated-reader] Missing Invoice (orderId)')
    return NextResponse.json(
      { error: 'Missing Invoice (orderId)', approved: false },
      { status: 400 }
    )
  }

  // Validate TipAmount if present (must be non-negative number)
  const tipAmount = body.TipAmount ? parseFloat(body.TipAmount) : 0
  if (isNaN(tipAmount) || tipAmount < 0) {
    console.error('[simulated-reader] Invalid TipAmount:', body.TipAmount)
    return NextResponse.json(
      { error: 'Invalid TipAmount: must be a non-negative number', approved: false },
      { status: 400 }
    )
  }

  // Simulate realistic reader delay (800-1500ms for tap)
  await delay(randomBetween(800, 1500))

  // Pick a random card from mock database
  const card = getRandomCard()

  // Random entry method (weighted: 60% Tap, 20% Chip, 20% Swipe)
  const entryRoll = Math.random()
  const entryMethod = entryRoll < 0.6 ? 'Tap' : entryRoll < 0.8 ? 'Chip' : 'Swipe'

  // Generate a simulated reference number
  const refNumber = `SIM-${Date.now().toString(36).toUpperCase()}`

  if (card.shouldDecline) {
    return NextResponse.json({
      approved: false,
      status: 'DECLINED',
      ResponseCode: '05',
      CardBrand: card.cardType.charAt(0).toUpperCase() + card.cardType.slice(1),
      CardLast4: card.lastFour,
      EntryMethod: entryMethod,
      amountAuthorized: '0.00',
      ReferenceNumber: refNumber,
      Message: 'DECLINED - Insufficient Funds',
    })
  }

  return NextResponse.json({
    approved: true,
    status: 'APPROVED',
    ResponseCode: '00',
    authCode: generateAuthCode(),
    CardBrand: card.cardType.charAt(0).toUpperCase() + card.cardType.slice(1),
    CardLast4: card.lastFour,
    EntryMethod: entryMethod,
    amountAuthorized: amount.toFixed(2),
    ReferenceNumber: refNumber,
    Message: 'APPROVED',
    // Include customer name for chip reads (real readers return cardholder name)
    ...(entryMethod === 'Chip' && { CardholderName: `${card.firstName} ${card.lastName}` }),
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { clearTwilioCache } from '@/lib/twilio'
import { requirePermission } from '@/lib/require-permission'

// GET - Load current Twilio config (masked)
export const GET = withVenue(async function GET(request: NextRequest) {
  await requirePermission(request, 'settings.integrations')

  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) {
    return NextResponse.json({ data: { configured: false } })
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const tw = settings.twilio

  if (tw?.accountSid && tw?.authToken && tw?.fromNumber) {
    return NextResponse.json({
      data: {
        configured: true,
        accountSid: `***${tw.accountSid.slice(-4)}`,
        fromNumber: tw.fromNumber,
      },
    })
  }

  return NextResponse.json({ data: { configured: false } })
})

// POST - Save Twilio credentials
export const POST = withVenue(async function POST(request: NextRequest) {
  await requirePermission(request, 'settings.integrations')

  const body = await request.json()
  const { accountSid, authToken, fromNumber } = body

  if (!accountSid || !authToken || !fromNumber) {
    return NextResponse.json({ error: 'All three fields are required: Account SID, Auth Token, and From Number' }, { status: 400 })
  }

  // Validate SID format
  if (!accountSid.startsWith('AC') || accountSid.length < 30) {
    return NextResponse.json({ error: 'Invalid Account SID — should start with "AC"' }, { status: 400 })
  }

  // Normalize phone to E.164
  const digits = fromNumber.replace(/\D/g, '')
  let normalizedPhone = fromNumber
  if (digits.length === 10) normalizedPhone = `+1${digits}`
  else if (digits.length === 11 && digits.startsWith('1')) normalizedPhone = `+${digits}`
  else if (!fromNumber.startsWith('+')) normalizedPhone = `+${digits}`

  const location = await db.location.findFirst({ select: { id: true, settings: true } })
  if (!location) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  const currentSettings = (location.settings as Record<string, unknown>) || {}

  await db.location.update({
    where: { id: location.id },
    data: {
      settings: {
        ...currentSettings,
        twilio: {
          accountSid: accountSid.trim(),
          authToken: authToken.trim(),
          fromNumber: normalizedPhone,
        },
      },
    },
  })

  // Clear cached credentials so the new ones take effect immediately
  clearTwilioCache()

  return NextResponse.json({
    data: {
      success: true,
      message: 'Twilio credentials saved successfully',
      fromNumber: normalizedPhone,
    },
  })
})

// DELETE - Remove Twilio credentials
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  await requirePermission(request, 'settings.integrations')

  const location = await db.location.findFirst({ select: { id: true, settings: true } })
  if (!location) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  const currentSettings = (location.settings as Record<string, unknown>) || {}
  delete currentSettings.twilio

  await db.location.update({
    where: { id: location.id },
    data: { settings: currentSettings },
  })

  clearTwilioCache()

  return NextResponse.json({ data: { success: true, message: 'Twilio credentials removed' } })
})

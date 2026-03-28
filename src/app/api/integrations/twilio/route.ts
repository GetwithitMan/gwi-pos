import { NextRequest } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { db } from '@/lib/db'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { clearTwilioCache } from '@/lib/twilio'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Load current Twilio config (masked)
export const GET = withVenue(async function GET(request: NextRequest) {

  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) {
    return ok({ configured: false })
  }

  // Gate by SETTINGS_VIEW permission
  const actor = await getActorFromRequest(request)
  const auth = await requirePermission(actor.employeeId, location.id, PERMISSIONS.SETTINGS_VIEW)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const settings = parseSettings(await getLocationSettings(location.id))
  const tw = settings.twilio

  if (tw?.accountSid && tw?.authToken && tw?.fromNumber) {
    return ok({
        configured: true,
        accountSid: `***${tw.accountSid.slice(-4)}`,
        fromNumber: tw.fromNumber,
      })
  }

  return ok({ configured: false })
})

// POST - Save Twilio credentials
export const POST = withVenue(async function POST(request: NextRequest) {

  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) {
    return notFound('Location not found')
  }

  // Gate by SETTINGS_EDIT permission
  const actor = await getActorFromRequest(request)
  const body = await request.json()
  const resolvedEmployeeId = actor.employeeId ?? body.employeeId
  const auth = await requirePermission(resolvedEmployeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const { accountSid, authToken, fromNumber } = body

  if (!accountSid || !authToken || !fromNumber) {
    return err('All three fields are required: Account SID, Auth Token, and From Number')
  }

  // Validate SID format
  if (!accountSid.startsWith('AC') || accountSid.length < 30) {
    return err('Invalid Account SID — should start with "AC"')
  }

  // Normalize phone to E.164
  const digits = fromNumber.replace(/\D/g, '')
  let normalizedPhone = fromNumber
  if (digits.length === 10) normalizedPhone = `+1${digits}`
  else if (digits.length === 11 && digits.startsWith('1')) normalizedPhone = `+${digits}`
  else if (!fromNumber.startsWith('+')) normalizedPhone = `+${digits}`

  // Re-fetch location with settings for the update
  const locationWithSettings = await db.location.findFirst({ select: { id: true, settings: true } })
  if (!locationWithSettings) {
    return notFound('Location not found')
  }

  const currentSettings = (locationWithSettings.settings as Record<string, unknown>) || {}

  await db.location.update({
    where: { id: locationWithSettings.id },
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

  return ok({
      success: true,
      message: 'Twilio credentials saved successfully',
      fromNumber: normalizedPhone,
    })
})

// DELETE - Remove Twilio credentials
export const DELETE = withVenue(async function DELETE(request: NextRequest) {

  const location = await db.location.findFirst({ select: { id: true, settings: true } })
  if (!location) {
    return notFound('Location not found')
  }

  // Gate by SETTINGS_EDIT permission
  const actor = await getActorFromRequest(request)
  const auth = await requirePermission(actor.employeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
  if (!auth.authorized) {
    return err(auth.error, auth.status)
  }

  const currentSettings = (location.settings as Record<string, unknown>) || {}
  delete currentSettings.twilio

  await db.location.update({
    where: { id: location.id },
    data: { settings: currentSettings as any },
  })

  clearTwilioCache()

  return ok({ success: true, message: 'Twilio credentials removed' })
})

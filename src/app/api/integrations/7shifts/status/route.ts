import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { db } from '@/lib/db'

export const GET = withVenue(async function GET() {
  const location = await db.location.findFirst({ select: { id: true } })
  if (!location) return NextResponse.json({ error: 'No location' }, { status: 404 })

  const settings = parseSettings(await getLocationSettings(location.id))
  const s = settings.sevenShifts

  // P1: isConfigured = has required credentials (regardless of enabled toggle)
  // This allows Test Connection even when the integration is disabled.
  const isConfigured = !!(s?.clientId && s.clientSecret && s.companyId && s.companyGuid)
  const isEnabled = s?.enabled ?? false

  // P1: Count employees linked to a 7shifts user ID
  const employeesLinked = await db.employee.count({
    where: {
      locationId: location.id,
      sevenShiftsUserId: { not: null },
      deletedAt: null,
    },
  })

  // P1: Webhooks are considered registered if the timestamp flag is set (set by register-webhooks route)
  const webhooksRegistered = !!s?.webhooksRegisteredAt

  return NextResponse.json({
    data: {
      isConfigured,
      isEnabled,
      // Legacy field — keep for backward compat with existing UI code
      configured: isConfigured,
      enabled: isEnabled,
      environment: s?.environment ?? 'sandbox',
      companyId: s?.companyId ?? 0,
      locationId7s: s?.locationId7s ?? 0,
      employeesLinked,
      webhooksRegistered,
      webhooksRegisteredAt: s?.webhooksRegisteredAt ?? null,
      lastSalesPushAt: s?.lastSalesPushAt ?? null,
      lastSalesPushStatus: s?.lastSalesPushStatus ?? null,
      lastSalesPushError: s?.lastSalesPushError ?? null,
      lastPunchPushAt: s?.lastPunchPushAt ?? null,
      lastPunchPushStatus: s?.lastPunchPushStatus ?? null,
      lastPunchPushError: s?.lastPunchPushError ?? null,
      lastSchedulePullAt: s?.lastSchedulePullAt ?? null,
      lastSchedulePullStatus: s?.lastSchedulePullStatus ?? null,
      lastSchedulePullError: s?.lastSchedulePullError ?? null,
      syncOptions: s?.syncOptions ?? { pushSales: true, pushTimePunches: true, pullSchedule: true },
    },
  })
})

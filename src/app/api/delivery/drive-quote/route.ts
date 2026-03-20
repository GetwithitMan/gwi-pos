/**
 * Delivery Drive Quote — Get a delivery quote from DoorDash Drive / Uber Direct / Grubhub Connect
 *
 * POST /api/delivery/drive-quote
 * Body: { locationId, employeeId, platform: 'doordash' | 'ubereats' | 'grubhub',
 *         dropoffAddress, dropoffPhone, dropoffName, orderValueCents, pickupTime? }
 *
 * Returns a DeliveryQuote with fee, ETA, and quote ID that can be used to create the delivery.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getPlatformClient } from '@/lib/delivery/clients/platform-registry'
import type { DeliveryPlatformId, CreateDeliveryRequest } from '@/lib/delivery/clients/types'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      employeeId,
      platform,
      dropoffAddress,
      dropoffPhone,
      dropoffName,
      orderValueCents,
      pickupTime,
    } = body as {
      locationId: string
      employeeId: string
      platform: DeliveryPlatformId
      dropoffAddress: string
      dropoffPhone: string
      dropoffName: string
      orderValueCents: number
      pickupTime?: string
    }

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!platform) {
      return NextResponse.json({ error: 'Platform is required' }, { status: 400 })
    }

    if (!dropoffAddress || !dropoffPhone || !dropoffName) {
      return NextResponse.json(
        { error: 'dropoffAddress, dropoffPhone, and dropoffName are required' },
        { status: 400 },
      )
    }

    if (!orderValueCents || orderValueCents <= 0) {
      return NextResponse.json({ error: 'orderValueCents must be a positive number' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Load settings and get platform client
    const settings = parseSettings(await getLocationSettings(locationId))
    const client = getPlatformClient(platform, settings)

    if (!client) {
      return NextResponse.json(
        { error: `Platform "${platform}" is not enabled or credentials are missing` },
        { status: 400 },
      )
    }

    if (!client.getDeliveryQuote) {
      return NextResponse.json(
        { error: `Platform "${platform}" does not support delivery quotes (DaaS not enabled)` },
        { status: 400 },
      )
    }

    // Load pickup info from the location
    const locationRows = await db.$queryRawUnsafe<Array<{ name: string; settings: unknown }>>(
      `SELECT name, settings FROM "Location" WHERE id = $1`,
      locationId,
    )

    if (!locationRows.length) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const location = locationRows[0]
    const locationSettings = (location.settings || {}) as Record<string, unknown>
    const receipt = (locationSettings.receipt || {}) as Record<string, unknown>

    // Extract pickup address from receipt header text or fall back to location name
    const pickupAddress = (receipt.headerText as string) || location.name || ''
    const pickupPhone = (receipt.phone as string) || ''

    // Split dropoff name into first/last
    const nameParts = dropoffName.trim().split(/\s+/)
    const firstName = nameParts[0] || dropoffName
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

    // Build the delivery request
    const deliveryRequest: CreateDeliveryRequest = {
      pickupAddress,
      pickupBusinessName: location.name,
      pickupPhoneNumber: pickupPhone,
      pickupTime: pickupTime || undefined,
      dropoffAddress,
      dropoffPhoneNumber: dropoffPhone,
      dropoffContactFirstName: firstName,
      dropoffContactLastName: lastName,
      orderValue: orderValueCents,
      externalOrderId: `quote-${Date.now()}`, // Temporary ID for quote; real order ID used on create
    }

    const quote = await client.getDeliveryQuote(deliveryRequest)

    return NextResponse.json({ data: quote })
  } catch (error) {
    console.error('[POST /api/delivery/drive-quote] Error:', error)
    return NextResponse.json({ error: 'Failed to get delivery quote' }, { status: 500 })
  }
})

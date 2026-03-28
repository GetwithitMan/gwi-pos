/**
 * Delivery Drive Quote — Get a delivery quote from DoorDash Drive / Uber Direct / Grubhub Connect
 *
 * POST /api/delivery/drive-quote
 * Body: { locationId, employeeId, platform: 'doordash' | 'ubereats' | 'grubhub',
 *         dropoffAddress, dropoffPhone, dropoffName, orderValueCents, pickupTime? }
 *
 * Returns a DeliveryQuote with fee, ETA, and quote ID that can be used to create the delivery.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { getPlatformClient } from '@/lib/delivery/clients/platform-registry'
import type { DeliveryPlatformId, CreateDeliveryRequest } from '@/lib/delivery/clients/types'
import { err, notFound, ok } from '@/lib/api-response'

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
      return err('Location ID is required')
    }

    if (!platform) {
      return err('Platform is required')
    }

    if (!dropoffAddress || !dropoffPhone || !dropoffName) {
      return err('dropoffAddress, dropoffPhone, and dropoffName are required')
    }

    if (!orderValueCents || orderValueCents <= 0) {
      return err('orderValueCents must be a positive number')
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Load settings and get platform client
    const settings = parseSettings(await getLocationSettings(locationId))
    const client = getPlatformClient(platform, settings)

    if (!client) {
      return err(`Platform "${platform}" is not enabled or credentials are missing`)
    }

    if (!client.getDeliveryQuote) {
      return err(`Platform "${platform}" does not support delivery quotes (DaaS not enabled)`)
    }

    // Load pickup info from the location
    const locationRows = await db.$queryRawUnsafe<Array<{ name: string; settings: unknown }>>(
      `SELECT name, settings FROM "Location" WHERE id = $1`,
      locationId,
    )

    if (!locationRows.length) {
      return notFound('Location not found')
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

    return ok(quote)
  } catch (error) {
    console.error('[POST /api/delivery/drive-quote] Error:', error)
    return err('Failed to get delivery quote', 500)
  }
})

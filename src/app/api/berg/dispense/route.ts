import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { MenuItemRepository } from '@/lib/repositories'
import { withVenue } from '@/lib/with-venue'
import { validateBridgeHMAC, decryptBridgeSecret } from '@/lib/berg/hmac'
import { resolvePlu } from '@/lib/berg/plu-resolver'
import { getBusinessDateForTimestamp } from '@/lib/business-day'
import { isItemTaxInclusive } from '@/lib/order-calculations'
import { createHash } from 'crypto'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('berg-dispense')

// Default 500ms — tight enough that real double-pours (>500ms apart) aren't deduplicated,
// but wide enough to absorb ECU retries on no-response. Tunable via env var.
// Monitor "deduplicated" events in the health report — a high rate suggests the window is too wide.
const BERG_IDEMPOTENCY_WINDOW_MS = parseInt(process.env.BERG_IDEMPOTENCY_WINDOW_MS || '500', 10)

type BergUnmatchedType =
  | 'NO_ORDER_ACKED'
  | 'NO_ORDER_NAKED'
  | 'UNKNOWN_PLU_ACKED'
  | 'UNKNOWN_PLU_NAKED'
  | 'LOG_ONLY'

interface DispenseBody {
  deviceId: string
  pluNumber: number
  rawPacket: string
  modifierBytes?: string | null
  trailerBytes?: string | null
  lrcReceived: string
  lrcCalculated: string
  lrcValid: boolean
  parseStatus: string
  receivedAt: string
}

/**
 * Find the most recent open order on the terminal linked to a Berg device.
 * BergDevice.terminalId stores a Terminal.id — orders reference terminals
 * via offlineTerminalId (the terminal that created the order).
 *
 * NOTE: If multiple orders are open on the same terminal, returns the most recently
 * updated one. There is no way for the ECU to specify which tab a pour belongs to.
 * This is a known limitation — the terminal-per-device model assumes one active tab.
 */
async function findOpenOrderForTerminal(
  locationId: string,
  terminalId: string,
): Promise<{ order: import('@prisma/client').Order | null; multipleOpen: boolean }> {
  // Look up the terminal name to match against offlineTerminalId
  const terminal = await db.terminal.findUnique({
    where: { id: terminalId },
    select: { id: true, name: true },
  })
  if (!terminal) return { order: null, multipleOpen: false }

  // Orders track terminal via offlineTerminalId (Terminal.id) or tableId
  const openOrders = await db.order.findMany({
    where: {
      locationId,
      offlineTerminalId: terminal.id,
      status: { in: ['open', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 2, // only need to know if > 1
  })

  return {
    order: openOrders[0] ?? null,
    multipleOpen: openOrders.length > 1,
  }
}

export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  const startMs = Date.now()
  let body: DispenseBody
  let rawBodyText: string
  try {
    rawBodyText = await request.text()
    body = JSON.parse(rawBodyText) as DispenseBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { deviceId, pluNumber, rawPacket, modifierBytes, trailerBytes, lrcReceived, lrcCalculated, lrcValid, parseStatus, receivedAt } = body

  if (!deviceId || pluNumber === undefined || !rawPacket) {
    return NextResponse.json({ error: 'deviceId, pluNumber, rawPacket required' }, { status: 400 })
  }

  // Load device for HMAC validation
  const device = await db.bergDevice.findFirst({
    where: { id: deviceId, isActive: true },
  })

  if (!device) {
    return NextResponse.json({ error: 'Unknown device' }, { status: 404 })
  }

  // Venue isolation: verify device belongs to the venue this request was routed to
  const requestSlug = request.headers.get('x-venue-slug')
  if (requestSlug) {
    const venueLocation = await db.location.findFirst({
      where: { id: device.locationId },
      select: { slug: true },
    })
    if (!venueLocation || venueLocation.slug !== requestSlug) {
      console.error(`[berg/dispense] Device ${deviceId} locationId mismatch — device slug: ${venueLocation?.slug}, request slug: ${requestSlug}`)
      return NextResponse.json({ error: 'Device not found' }, { status: 404 })
    }
  }

  // HMAC validation (fail-closed: reject if secret exists but can't validate)
  if (device.bridgeSecretHash || device.bridgeSecretEncrypted) {
    // Resolve the plain secret: encrypted DB field first, then legacy env var
    let plainSecret: string | null = null

    if (device.bridgeSecretEncrypted) {
      try {
        plainSecret = decryptBridgeSecret(device.bridgeSecretEncrypted)
      } catch (err) {
        console.error(`[berg/dispense] Failed to decrypt secret for device ${deviceId}:`, err)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else {
      // Legacy fallback: GWI_BRIDGE_SECRETS JSON env var.
      // bridgeSecretEncrypted being null here means either:
      //   (a) BRIDGE_MASTER_KEY was never set, so encryption was skipped at device creation, OR
      //   (b) Secret was rotated while BRIDGE_MASTER_KEY was absent — hash updated but encrypted field not.
      // In case (b) the new plaintext secret must be added to GWI_BRIDGE_SECRETS manually.
      const bridgeSecretsEnv = process.env.GWI_BRIDGE_SECRETS
      if (!bridgeSecretsEnv) {
        console.error(
          `[berg/dispense] No bridgeSecretEncrypted for device ${deviceId} and GWI_BRIDGE_SECRETS not set. ` +
          `If the secret was recently rotated without BRIDGE_MASTER_KEY, add the new plaintext secret to ` +
          `GWI_BRIDGE_SECRETS={"${deviceId}":"<new-secret>"} or set BRIDGE_MASTER_KEY and re-rotate.`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      try {
        const secrets: Record<string, string> = JSON.parse(bridgeSecretsEnv)
        plainSecret = secrets[deviceId] ?? null
      } catch {
        console.error('[berg/dispense] GWI_BRIDGE_SECRETS is not valid JSON — rejecting')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    if (!plainSecret) {
      console.error(`[berg/dispense] No secret resolved for device ${deviceId} — rejecting`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const hmacHeaders = {
      authorization: request.headers.get('Authorization'),
      ts: request.headers.get('x-berg-ts'),
      bodySha256: request.headers.get('x-berg-body-sha256'),
    }

    // Verify body SHA256 matches actual body (prevents body substitution attacks)
    const actualBodyHash = createHash('sha256').update(rawBodyText).digest('hex')
    const claimedBodyHash = hmacHeaders.bodySha256
    if (claimedBodyHash && claimedBodyHash !== actualBodyHash) {
      console.error(`[berg/dispense] Body hash mismatch for device ${deviceId}: claimed=${claimedBodyHash} actual=${actualBodyHash}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = validateBridgeHMAC(hmacHeaders, deviceId, plainSecret)
    if (!result.valid) {
      console.error(`[berg/dispense] HMAC failed for device ${deviceId}: ${result.reason}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const receivedAtDate = receivedAt ? new Date(receivedAt) : new Date()

  // Idempotency key: SHA256(deviceId + rawPacket + floor(receivedAt / windowMs))
  const windowBucket = Math.floor(receivedAtDate.getTime() / BERG_IDEMPOTENCY_WINDOW_MS)
  const idempotencyKey = createHash('sha256')
    .update(`${deviceId}:${rawPacket}:${windowBucket}`)
    .digest('hex')

  // Check for duplicate within idempotency window
  const existing = await db.bergDispenseEvent.findUnique({ where: { idempotencyKey } })
  if (existing) {
    // Log deduplications so the health report can surface high rates as a warning.
    // A high rate may indicate the window is too wide, or the ECU is retrying aggressively.
    console.warn(`[berg/dispense] Deduplicated event for device ${deviceId} PLU ${pluNumber} (window ${BERG_IDEMPOTENCY_WINDOW_MS}ms)`)
    return NextResponse.json({ action: existing.status === 'NAK' || existing.status === 'NAK_TIMEOUT' ? 'NAK' : 'ACK', deduplicated: true })
  }

  // Bad LRC → NAK immediately
  if (!lrcValid) {
    await db.bergDispenseEvent.create({
      data: {
        locationId: device.locationId,
        deviceId,
        pluNumber: pluNumber ?? 0,
        rawPacket,
        modifierBytes: modifierBytes || null,
        trailerBytes: trailerBytes || null,
        parseStatus: (parseStatus as import('@prisma/client').BergParseStatus) || 'BAD_LRC',
        lrcReceived,
        lrcCalculated,
        lrcValid: false,
        status: 'NAK',
        ackTimeoutMs: device.ackTimeoutMs,
        idempotencyKey,
        receivedAt: receivedAtDate,
        acknowledgedAt: new Date(),
        ackLatencyMs: Date.now() - startMs,
      },
    })
    return NextResponse.json({ action: 'NAK', reason: 'BAD_LRC' })
  }

  // Load location settings for businessDate calculation
  const location = await db.location.findUnique({
    where: { id: device.locationId },
    select: { settings: true },
  })
  const settings = location?.settings as Record<string, unknown> | null
  const dayStartTime = (settings?.dayStartTime as string) || '04:00'
  const taxSettings = settings?.tax as { taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean } | undefined
  const taxIncSettings = {
    taxInclusiveLiquor: taxSettings?.taxInclusiveLiquor ?? false,
    taxInclusiveFood: taxSettings?.taxInclusiveFood ?? false,
  }

  const businessDateStr = getBusinessDateForTimestamp(receivedAtDate, dayStartTime)
  const businessDate = new Date(businessDateStr + 'T00:00:00')

  // Resolve PLU (pass modifierBytes for pour-size variant resolution)
  const resolvedPlu = pluNumber !== null
    ? await resolvePlu(pluNumber, deviceId, device.locationId, modifierBytes)
    : null

  const { pourReleaseMode, autoRingMode, timeoutPolicy, ackTimeoutMs } = device

  // ===== BEST_EFFORT mode =====
  if (pourReleaseMode === 'BEST_EFFORT') {
    // Write the event synchronously BEFORE sending ACK — prevents idempotency race.
    // Order/OrderItem resolution happens async after ACK.
    const event = await db.bergDispenseEvent.create({
      data: {
        locationId: device.locationId,
        deviceId,
        pluMappingId: resolvedPlu?.mappingId || null,
        pluNumber: pluNumber ?? 0,
        rawPacket,
        modifierBytes: modifierBytes || null,
        trailerBytes: trailerBytes || null,
        parseStatus: 'OK' as const,
        lrcReceived,
        lrcCalculated,
        lrcValid: true,
        status: 'ACK_BEST_EFFORT' as const,
        pourSizeOz: resolvedPlu?.pourSizeOz ? String(resolvedPlu.pourSizeOz) : null,
        variantKey: resolvedPlu?.variantKey ?? null,
        variantLabel: resolvedPlu?.variantLabel ?? null,
        resolutionStatus: resolvedPlu?.resolutionStatus ?? 'NONE',
        ackTimeoutMs,
        businessDate,
        idempotencyKey,
        receivedAt: receivedAtDate,
        acknowledgedAt: new Date(),
        ackLatencyMs: Date.now() - startMs,
        postProcessStatus: 'PENDING',
      },
    })

    void emitToLocation(device.locationId, 'hardware:changed', { locationId: device.locationId }).catch(err => log.warn({ err }, 'socket emit failed'))

    // Fire-and-forget: resolve order linkage and auto-ring (3 attempts, 1s apart)
    void (async () => {
      const MAX_ATTEMPTS = 3
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          let orderId: string | null = null
          let orderItemId: string | null = null
          let unmatchedType: BergUnmatchedType | null = null
          let errorReason: string | null = null
          let pourCost: import('@prisma/client').Prisma.Decimal | null = null

          if (resolvedPlu === null) {
            unmatchedType = 'UNKNOWN_PLU_ACKED'
          } else if (autoRingMode === 'AUTO_RING' || autoRingMode === 'OFF') {
            const result = device.terminalId
              ? await findOpenOrderForTerminal(device.locationId, device.terminalId)
              : { order: null, multipleOpen: false }

            // H5: If device requires single open order and multiple are open, skip auto-ring
            if (result.multipleOpen && device.autoRingOnlyWhenSingleOpenOrder) {
              unmatchedType = 'NO_ORDER_ACKED'
              errorReason = 'MULTIPLE_OPEN_ORDERS'
              // Still look up price for dollar exposure
              if (resolvedPlu?.menuItemId) {
                const menuItem = await MenuItemRepository.getMenuItemByIdWithSelect(resolvedPlu.menuItemId, device.locationId, {
                  price: true,
                })
                if (menuItem) pourCost = menuItem.price
              }
            } else if (result.order && autoRingMode === 'AUTO_RING' && resolvedPlu?.menuItemId) {
              const menuItem = await MenuItemRepository.getMenuItemByIdWithInclude(resolvedPlu.menuItemId, device.locationId, {
                category: { select: { categoryType: true } },
              })
              if (menuItem) {
                const oi = await db.orderItem.create({
                  data: {
                    locationId: device.locationId,
                    orderId: result.order.id,
                    menuItemId: menuItem.id,
                    name: menuItem.name,
                    price: menuItem.price,
                    quantity: 1,
                    status: 'active',
                    isTaxInclusive: isItemTaxInclusive(menuItem.category?.categoryType, taxIncSettings),
                  },
                })
                orderId = result.order.id
                orderItemId = oi.id
                pourCost = menuItem.price
                // Surface ambiguous tab selection — ring succeeded but operator should be aware
                if (result.multipleOpen) errorReason = 'MULTIPLE_OPEN_ORDERS'
              }
            } else if (!result.order) {
              // Still look up price for dollar exposure even when no order found
              if (resolvedPlu?.menuItemId) {
                const menuItem = await MenuItemRepository.getMenuItemByIdWithSelect(resolvedPlu.menuItemId, device.locationId, {
                  price: true,
                })
                if (menuItem) pourCost = menuItem.price
              }
              unmatchedType = 'NO_ORDER_ACKED'
            }
          }

          // Update event with resolved order linkage, cost, and post-process status
          await db.bergDispenseEvent.update({
            where: { id: event.id },
            data: { orderId, orderItemId, unmatchedType, errorReason, pourCost, postProcessStatus: 'DONE' },
          })

          await db.bergDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
          break // success — exit retry loop
        } catch (err) {
          if (attempt < MAX_ATTEMPTS) {
            console.warn(`[berg/dispense] Order resolution attempt ${attempt}/${MAX_ATTEMPTS} failed for event ${event.id}, retrying in 1s:`, err)
            await new Promise(resolve => setTimeout(resolve, 1000))
          } else {
            console.error(`[berg/dispense] Order resolution failed after ${MAX_ATTEMPTS} attempts for event ${event.id} (device ${deviceId} PLU ${pluNumber}). Event exists in DB but orderId/orderItemId may be null.`, err)
            // Mark post-process as failed after all retries exhausted
            await db.bergDispenseEvent.update({
              where: { id: event.id },
              data: { postProcessStatus: 'FAILED', postProcessError: err instanceof Error ? err.message : String(err) },
            }).catch(err => log.warn({ err }, 'Background task failed'))
          }
        }
      }
    })()

    return NextResponse.json({ action: 'ACK' })
  }

  // ===== REQUIRES_OPEN_ORDER mode =====
  const deadline = Date.now() + ackTimeoutMs
  let orderId: string | null = null
  let orderItemId: string | null = null
  let orderFound = false
  let pourCostResolved: import('@prisma/client').Prisma.Decimal | null = null

  let multipleOpenDetected = false

  if (resolvedPlu !== null) {
    // Look for open order on linked terminal
    const result = device.terminalId
      ? await findOpenOrderForTerminal(device.locationId, device.terminalId)
      : { order: null, multipleOpen: false }

    multipleOpenDetected = result.multipleOpen

    // H5: If device requires single open order and multiple are open, treat as no order
    if (result.order && !(result.multipleOpen && device.autoRingOnlyWhenSingleOpenOrder)) {
      orderFound = true
      orderId = result.order.id

      if (autoRingMode === 'AUTO_RING' && resolvedPlu.menuItemId) {
        const menuItem = await MenuItemRepository.getMenuItemByIdWithInclude(resolvedPlu.menuItemId, device.locationId, {
          category: { select: { categoryType: true } },
        })
        if (menuItem) {
          const oi = await db.orderItem.create({
            data: {
              locationId: device.locationId,
              orderId: result.order.id,
              menuItemId: menuItem.id,
              name: menuItem.name,
              price: menuItem.price,
              quantity: 1,
              status: 'active',
              isTaxInclusive: isItemTaxInclusive(menuItem.category?.categoryType, taxIncSettings),
            },
          })
          orderItemId = oi.id
          pourCostResolved = menuItem.price
        }
      }
    }
  }

  const elapsed = Date.now() - startMs
  const timedOut = elapsed >= ackTimeoutMs || Date.now() > deadline

  let action: 'ACK' | 'NAK'
  let status: 'ACK' | 'NAK' | 'ACK_TIMEOUT' | 'NAK_TIMEOUT'
  let unmatchedType: BergUnmatchedType | null = null
  let errorReason: string | null = null

  if (resolvedPlu === null) {
    // Unknown PLU
    if (timedOut && timeoutPolicy === 'ACK_ON_TIMEOUT') {
      action = 'ACK'; status = 'ACK_TIMEOUT'; unmatchedType = 'UNKNOWN_PLU_ACKED'; errorReason = 'UNKNOWN_PLU'
    } else {
      action = 'NAK'; status = 'NAK_TIMEOUT'; unmatchedType = 'UNKNOWN_PLU_NAKED'; errorReason = 'UNKNOWN_PLU'
    }
  } else if (!orderFound) {
    const reason = multipleOpenDetected ? 'MULTIPLE_OPEN_ORDERS' : 'NO_OPEN_ORDER'
    if (timedOut && timeoutPolicy === 'ACK_ON_TIMEOUT') {
      action = 'ACK'; status = 'ACK_TIMEOUT'; unmatchedType = 'NO_ORDER_ACKED'; errorReason = reason
    } else {
      action = 'NAK'; status = 'NAK_TIMEOUT'; unmatchedType = 'NO_ORDER_NAKED'; errorReason = reason
    }
  } else {
    action = 'ACK'; status = 'ACK'
  }

  const ackLatencyMs = Date.now() - startMs

  await db.bergDispenseEvent.create({
    data: {
      locationId: device.locationId,
      deviceId,
      pluMappingId: resolvedPlu?.mappingId || null,
      pluNumber: pluNumber ?? 0,
      rawPacket,
      modifierBytes: modifierBytes || null,
      trailerBytes: trailerBytes || null,
      parseStatus: 'OK',
      lrcReceived,
      lrcCalculated,
      lrcValid: true,
      status,
      unmatchedType,
      pourSizeOz: resolvedPlu?.pourSizeOz ? String(resolvedPlu.pourSizeOz) : null,
      variantKey: resolvedPlu?.variantKey ?? null,
      variantLabel: resolvedPlu?.variantLabel ?? null,
      resolutionStatus: resolvedPlu?.resolutionStatus ?? 'NONE',
      pourCost: pourCostResolved,
      orderId,
      orderItemId,
      ackTimeoutMs,
      errorReason,
      businessDate,
      idempotencyKey,
      receivedAt: receivedAtDate,
      acknowledgedAt: new Date(),
      ackLatencyMs,
      postProcessStatus: 'DONE',
    },
  })

  void db.bergDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }).catch(err => log.warn({ err }, 'Background task failed'))

  void emitToLocation(device.locationId, 'hardware:changed', { locationId: device.locationId }).catch(err => log.warn({ err }, 'socket emit failed'))
  if (orderItemId) {
    void emitToLocation(device.locationId, 'orders:list-changed', { trigger: 'mutation', locationId: device.locationId }).catch(err => log.warn({ err }, 'socket emit failed'))
  }

  return NextResponse.json({ action, reason: errorReason || undefined, orderItemId: orderItemId || undefined })
}))

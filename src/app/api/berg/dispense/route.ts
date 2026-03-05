import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { validateBridgeHMAC } from '@/lib/berg/hmac'
import { resolvePlu } from '@/lib/berg/plu-resolver'
import { getBusinessDateForTimestamp } from '@/lib/business-day'
import { createHash } from 'crypto'

const BERG_IDEMPOTENCY_WINDOW_MS = parseInt(process.env.BERG_IDEMPOTENCY_WINDOW_MS || '1000', 10)

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
 */
async function findOpenOrderForTerminal(locationId: string, terminalId: string) {
  // Look up the terminal name to match against offlineTerminalId
  const terminal = await db.terminal.findUnique({
    where: { id: terminalId },
    select: { id: true, name: true },
  })
  if (!terminal) return null

  // Orders track terminal via offlineTerminalId (Terminal.id) or tableId
  return db.order.findFirst({
    where: {
      locationId,
      offlineTerminalId: terminal.id,
      status: { in: ['open', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
  })
}

export const POST = withVenue(async function POST(request: NextRequest) {
  const startMs = Date.now()
  let body: DispenseBody

  try {
    body = await request.json()
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

  // HMAC validation
  if (device.bridgeSecretHash) {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Full HMAC validation requires plaintext secret accessible at runtime.
    // The bridge stores it in GWI_BRIDGE_SECRETS env var as JSON: { deviceId: secret }.
    const bridgeSecretsEnv = process.env.GWI_BRIDGE_SECRETS
    if (bridgeSecretsEnv) {
      try {
        const secrets: Record<string, string> = JSON.parse(bridgeSecretsEnv)
        const plainSecret = secrets[deviceId]
        if (plainSecret) {
          const result = validateBridgeHMAC(authHeader, deviceId, plainSecret)
          if (!result.valid) {
            console.error(`[berg/dispense] HMAC failed for device ${deviceId}: ${result.reason}`)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
        }
      } catch {
        // Secrets env not parseable — log and continue (fail open in Sprint A)
        console.warn('[berg/dispense] Could not parse GWI_BRIDGE_SECRETS env')
      }
    }
  }

  const receivedAtDate = receivedAt ? new Date(receivedAt) : new Date()

  // Idempotency key: SHA256(deviceId + rawPacket + floor(receivedAt / windowMs))
  const windowBucket = Math.floor(receivedAtDate.getTime() / BERG_IDEMPOTENCY_WINDOW_MS)
  const idempotencyKey = createHash('sha256')
    .update(`${deviceId}:${rawPacket}:${windowBucket}`)
    .digest('hex')

  // Check for duplicate
  const existing = await db.bergDispenseEvent.findUnique({ where: { idempotencyKey } })
  if (existing) {
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

  const businessDateStr = getBusinessDateForTimestamp(receivedAtDate, dayStartTime)
  const businessDate = new Date(businessDateStr + 'T00:00:00')

  // Resolve PLU
  const resolvedPlu = pluNumber !== null
    ? await resolvePlu(pluNumber, deviceId, device.locationId)
    : null

  const { pourReleaseMode, autoRingMode, timeoutPolicy, ackTimeoutMs } = device

  // ===== BEST_EFFORT mode =====
  if (pourReleaseMode === 'BEST_EFFORT') {
    // ACK immediately — do NOT block on DB work
    const eventData = {
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
      ackTimeoutMs,
      businessDate,
      idempotencyKey,
      receivedAt: receivedAtDate,
      acknowledgedAt: new Date(),
      ackLatencyMs: Date.now() - startMs,
    }

    // Fire-and-forget: resolve order and ring if AUTO_RING
    void (async () => {
      try {
        let orderId: string | null = null
        let orderItemId: string | null = null
        let unmatchedType: BergUnmatchedType | null = null

        if (resolvedPlu === null) {
          unmatchedType = 'UNKNOWN_PLU_ACKED'
        } else if (autoRingMode === 'AUTO_RING' || autoRingMode === 'OFF') {
          const order = device.terminalId
            ? await findOpenOrderForTerminal(device.locationId, device.terminalId)
            : null

          if (order && autoRingMode === 'AUTO_RING' && resolvedPlu?.menuItemId) {
            // Create OrderItem
            const menuItem = await db.menuItem.findUnique({ where: { id: resolvedPlu.menuItemId } })
            if (menuItem) {
              const oi = await db.orderItem.create({
                data: {
                  locationId: device.locationId,
                  orderId: order.id,
                  menuItemId: menuItem.id,
                  name: menuItem.name,
                  price: menuItem.price,
                  quantity: 1,
                  status: 'active',
                },
              })
              orderId = order.id
              orderItemId = oi.id
            }
          } else if (!order) {
            unmatchedType = 'NO_ORDER_ACKED'
          }
        }

        await db.bergDispenseEvent.create({
          data: {
            ...eventData,
            pourSizeOz: eventData.pourSizeOz,
            orderId,
            orderItemId,
            unmatchedType,
          },
        })

        // Update device lastSeenAt
        await db.bergDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
      } catch (err) {
        console.error('[berg/dispense] Async post-ACK processing failed:', err)
      }
    })()

    return NextResponse.json({ action: 'ACK' })
  }

  // ===== REQUIRES_OPEN_ORDER mode =====
  const deadline = Date.now() + ackTimeoutMs
  let orderId: string | null = null
  let orderItemId: string | null = null
  let orderFound = false

  if (resolvedPlu !== null) {
    // Look for open order on linked terminal
    const order = device.terminalId
      ? await findOpenOrderForTerminal(device.locationId, device.terminalId)
      : null

    if (order) {
      orderFound = true
      orderId = order.id

      if (autoRingMode === 'AUTO_RING' && resolvedPlu.menuItemId) {
        const menuItem = await db.menuItem.findUnique({ where: { id: resolvedPlu.menuItemId } })
        if (menuItem) {
          const oi = await db.orderItem.create({
            data: {
              locationId: device.locationId,
              orderId: order.id,
              menuItemId: menuItem.id,
              name: menuItem.name,
              price: menuItem.price,
              quantity: 1,
              status: 'active',
            },
          })
          orderItemId = oi.id
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
    if (timedOut && timeoutPolicy === 'ACK_ON_TIMEOUT') {
      action = 'ACK'; status = 'ACK_TIMEOUT'; unmatchedType = 'NO_ORDER_ACKED'; errorReason = 'NO_OPEN_ORDER'
    } else {
      action = 'NAK'; status = 'NAK_TIMEOUT'; unmatchedType = 'NO_ORDER_NAKED'; errorReason = 'NO_OPEN_ORDER'
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
      orderId,
      orderItemId,
      ackTimeoutMs,
      errorReason,
      businessDate,
      idempotencyKey,
      receivedAt: receivedAtDate,
      acknowledgedAt: new Date(),
      ackLatencyMs,
    },
  })

  void db.bergDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }).catch(console.error)

  return NextResponse.json({ action, reason: errorReason || undefined, orderItemId: orderItemId || undefined })
})

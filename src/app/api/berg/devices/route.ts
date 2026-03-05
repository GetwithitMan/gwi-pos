import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { generateBridgeSecret, encryptBridgeSecret } from '@/lib/berg/hmac'
import { createHash } from 'crypto'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('employeeId') || ''

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const devices = await db.bergDevice.findMany({
      where: { locationId },
      orderBy: { createdAt: 'asc' },
    })

    // Never return bridgeSecretHash
    return NextResponse.json({
      devices: devices.map(({ bridgeSecretHash: _, ...d }) => d),
    })
  } catch (err) {
    console.error('[berg/devices GET]', err)
    return NextResponse.json({ error: 'Failed to load devices' }, { status: 500 })
  }
})

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, name, model, portName, baudRate, terminalId, interfaceMethod, pourReleaseMode, timeoutPolicy, autoRingMode, ackTimeoutMs, deductInventoryWhenNoOrder, isPluBased } = body
    const requestingEmployeeId = body.employeeId || ''

    if (!locationId || !name || !portName) {
      return NextResponse.json({ error: 'locationId, name, and portName are required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Generate secret — shown once, then only hash stored
    const plainSecret = generateBridgeSecret()
    const secretHash = createHash('sha256').update(plainSecret).digest('hex')

    const createInput = {
      locationId,
      name,
      model: (model || 'MODEL_1504_704') as 'MODEL_1504_704' | 'LASER' | 'ALL_BOTTLE_ABID' | 'TAP2' | 'FLOW_MONITOR',
      portName,
      baudRate: baudRate || 9600,
      terminalId: terminalId || null,
      interfaceMethod: (interfaceMethod || 'DIRECT_RING_UP') as 'DIRECT_RING_UP' | 'PRE_CHECK' | 'FILE_POSTING' | 'RING_AND_SLING',
      pourReleaseMode: (pourReleaseMode || 'BEST_EFFORT') as 'BEST_EFFORT' | 'REQUIRES_OPEN_ORDER',
      timeoutPolicy: (timeoutPolicy || 'ACK_ON_TIMEOUT') as 'ACK_ON_TIMEOUT' | 'NAK_ON_TIMEOUT',
      autoRingMode: (autoRingMode || 'AUTO_RING') as 'OFF' | 'AUTO_RING',
      ackTimeoutMs: ackTimeoutMs || 3000,
      deductInventoryWhenNoOrder: deductInventoryWhenNoOrder || false,
      isPluBased: isPluBased !== false,
      bridgeSecretHash: secretHash,
      ...(process.env.BRIDGE_MASTER_KEY
        ? (() => {
            const { encrypted, keyVersion } = encryptBridgeSecret(plainSecret)
            return { bridgeSecretEncrypted: encrypted, bridgeSecretKeyVersion: keyVersion }
          })()
        : (() => { console.warn('[berg/devices POST] BRIDGE_MASTER_KEY not set — skipping bridgeSecretEncrypted'); return {} })()),
    }

    const device = await db.bergDevice.create({ data: createInput })

    const { bridgeSecretHash: _, ...deviceOut } = device
    return NextResponse.json({
      device: deviceOut,
      bridgeSecret: plainSecret, // returned ONCE — never again
      warning: 'Save this secret now — it cannot be retrieved again.',
    }, { status: 201 })
  } catch (err) {
    console.error('[berg/devices POST]', err)
    return NextResponse.json({ error: 'Failed to create device' }, { status: 500 })
  }
})

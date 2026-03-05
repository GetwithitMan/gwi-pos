import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { generateBridgeSecret, encryptBridgeSecret } from '@/lib/berg/hmac'
import { createHash } from 'crypto'

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, name, portName, baudRate, terminalId, model, interfaceMethod, pourReleaseMode, timeoutPolicy, autoRingMode, ackTimeoutMs, deductInventoryWhenNoOrder, isPluBased, isActive, autoRingOnlyWhenSingleOpenOrder } = body
    const requestingEmployeeId = body.employeeId || ''

    const auth = await requirePermission(requestingEmployeeId, locationId || '', PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const existing = await db.bergDevice.findFirst({ where: { id, locationId } })
    if (!existing) return NextResponse.json({ error: 'Device not found' }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (portName !== undefined) data.portName = portName
    if (baudRate !== undefined) data.baudRate = Number(baudRate)
    if (terminalId !== undefined) data.terminalId = terminalId || null
    if (model !== undefined) data.model = model
    if (interfaceMethod !== undefined) data.interfaceMethod = interfaceMethod
    if (pourReleaseMode !== undefined) data.pourReleaseMode = pourReleaseMode
    if (timeoutPolicy !== undefined) data.timeoutPolicy = timeoutPolicy
    if (autoRingMode !== undefined) data.autoRingMode = autoRingMode
    if (ackTimeoutMs !== undefined) data.ackTimeoutMs = Number(ackTimeoutMs)
    if (deductInventoryWhenNoOrder !== undefined) data.deductInventoryWhenNoOrder = Boolean(deductInventoryWhenNoOrder)
    if (isPluBased !== undefined) data.isPluBased = Boolean(isPluBased)
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    if (autoRingOnlyWhenSingleOpenOrder !== undefined) data.autoRingOnlyWhenSingleOpenOrder = Boolean(autoRingOnlyWhenSingleOpenOrder)

    const device = await db.bergDevice.update({ where: { id }, data })
    const { bridgeSecretHash: _, ...deviceData } = device
    return NextResponse.json({ device: deviceData })
  } catch (err) {
    console.error('[berg/devices/[id] PUT]', err)
    return NextResponse.json({ error: 'Failed to update device' }, { status: 500 })
  }
})

export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { confirmDeviceId, locationId } = body
    const requestingEmployeeId = body.employeeId || ''

    if (!confirmDeviceId || confirmDeviceId !== id) {
      return NextResponse.json({ error: 'confirmDeviceId must match the device ID in the URL' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId || '', PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const existing = await db.bergDevice.findFirst({ where: { id, isActive: true } })
    if (!existing) return NextResponse.json({ error: 'Device not found' }, { status: 404 })

    const newSecret = generateBridgeSecret()
    const newHash = createHash('sha256').update(newSecret).digest('hex')

    const updateData: Record<string, unknown> = { bridgeSecretHash: newHash }
    if (process.env.BRIDGE_MASTER_KEY) {
      try {
        const { encrypted, keyVersion } = encryptBridgeSecret(newSecret)
        updateData.bridgeSecretEncrypted = encrypted
        updateData.bridgeSecretKeyVersion = keyVersion
      } catch (encErr) {
        console.error('[berg/devices PATCH] Failed to re-encrypt rotated secret:', encErr)
        return NextResponse.json({ error: 'Secret rotation failed — encryption error' }, { status: 500 })
      }
    }
    await db.bergDevice.update({ where: { id }, data: updateData })

    return NextResponse.json({
      bridgeSecret: newSecret,
      warning: 'Save this secret now — it cannot be retrieved again.',
      encryptedUpdated: Boolean(process.env.BRIDGE_MASTER_KEY),
    })
  } catch (err) {
    console.error('[berg/devices/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to rotate secret' }, { status: 500 })
  }
})

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || ''
    const requestingEmployeeId = request.nextUrl.searchParams.get('employeeId') || ''

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const existing = await db.bergDevice.findFirst({ where: { id, locationId } })
    if (!existing) return NextResponse.json({ error: 'Device not found' }, { status: 404 })

    await db.bergDevice.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[berg/devices/[id] DELETE]', err)
    return NextResponse.json({ error: 'Failed to deactivate device' }, { status: 500 })
  }
})

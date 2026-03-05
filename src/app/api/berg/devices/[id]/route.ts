import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, name, portName, baudRate, terminalId, model, interfaceMethod, pourReleaseMode, timeoutPolicy, autoRingMode, ackTimeoutMs, deductInventoryWhenNoOrder, isPluBased, isActive } = body
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

    const device = await db.bergDevice.update({ where: { id }, data })
    const { bridgeSecretHash: _, ...deviceData } = device
    return NextResponse.json({ device: deviceData })
  } catch (err) {
    console.error('[berg/devices/[id] PUT]', err)
    return NextResponse.json({ error: 'Failed to update device' }, { status: 500 })
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

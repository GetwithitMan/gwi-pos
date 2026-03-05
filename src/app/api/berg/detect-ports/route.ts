import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId') || ''
    const requestingEmployeeId = searchParams.get('employeeId') || ''

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // serialport is NUC-only — guard for Vercel/cloud environments
    if (process.env.BERG_ENABLED !== 'true') {
      return NextResponse.json({ ports: [], message: 'Berg hardware not enabled on this deployment' })
    }

    const { SerialPort } = await import('serialport')
    const ports = await SerialPort.list()
    return NextResponse.json({ ports })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[berg/detect-ports]', err)
    return NextResponse.json({ ports: [], error: error?.message || 'Failed to list serial ports' })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateTheoreticalUsage } from '@/lib/inventory-calculations'
import { theoreticalUsageQuerySchema, validateRequest } from '@/lib/validations'

// GET - Calculate theoretical usage based on sales
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse and validate query parameters
    const queryParams = {
      locationId: searchParams.get('locationId'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      department: searchParams.get('department') || undefined,
    }

    const validation = validateRequest(theoreticalUsageQuerySchema, queryParams)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { locationId, startDate, endDate, department } = validation.data

    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Parse dates
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    // Calculate theoretical usage using shared utility
    const result = await calculateTheoreticalUsage({
      locationId,
      startDate: start,
      endDate: end,
      department,
    })

    return NextResponse.json({ report: result })
  } catch (error) {
    console.error('Theoretical usage report error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

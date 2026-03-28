import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { generatePayrollData } from '@/lib/payroll/payroll-export'
import { formatPayrollExport } from '@/lib/payroll/csv-exporter'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('payroll-export')

// GET /api/payroll/export — preview payroll data for a date range
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('employeeId')

    if (!locationId || !startDateStr || !endDateStr) {
      return err('locationId, startDate, and endDate are required')
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.REPORTS_EXPORT,
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr + 'T23:59:59')

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return err('Invalid date format')
    }

    if (endDate < startDate) {
      return err('endDate must be after startDate')
    }

    const records = await generatePayrollData(db as never, locationId, startDate, endDate)

    // Compute totals
    const totals = records.reduce(
      (acc, r) => ({
        totalRegularHours: acc.totalRegularHours + r.regularHours,
        totalOvertimeHours: acc.totalOvertimeHours + r.overtimeHours,
        totalTips: acc.totalTips + r.totalTipCompensation,
        totalCommission: acc.totalCommission + r.commissionEarned,
        totalGrossPay: acc.totalGrossPay + r.grossPay,
        employeeCount: acc.employeeCount + 1,
      }),
      {
        totalRegularHours: 0,
        totalOvertimeHours: 0,
        totalTips: 0,
        totalCommission: 0,
        totalGrossPay: 0,
        employeeCount: 0,
      },
    )

    return ok({
        startDate: startDateStr,
        endDate: endDateStr,
        records,
        totals: {
          ...totals,
          totalRegularHours: Math.round(totals.totalRegularHours * 100) / 100,
          totalOvertimeHours: Math.round(totals.totalOvertimeHours * 100) / 100,
          totalTips: Math.round(totals.totalTips * 100) / 100,
          totalCommission: Math.round(totals.totalCommission * 100) / 100,
          totalGrossPay: Math.round(totals.totalGrossPay * 100) / 100,
        },
      })
  } catch (error) {
    console.error('Failed to generate payroll preview:', error)
    return err('Failed to generate payroll data', 500)
  }
})

// POST /api/payroll/export — generate a formatted payroll export file
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, startDate: startDateStr, endDate: endDateStr, format } = body as {
      locationId: string
      startDate: string
      endDate: string
      format: 'csv' | 'adp' | 'gusto' | 'paychex'
    }

    if (!locationId || !startDateStr || !endDateStr) {
      return err('locationId, startDate, and endDate are required')
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_EXPORT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const exportFormat = format || 'csv'
    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr + 'T23:59:59')

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return err('Invalid date format')
    }

    const records = await generatePayrollData(db as never, locationId, startDate, endDate)
    const csvData = formatPayrollExport(records, exportFormat, startDateStr, endDateStr)

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId || 'system',
        action: 'payroll_export',
        entityType: 'payroll',
        entityId: `${startDateStr}_${endDateStr}`,
        details: {
          format: exportFormat,
          startDate: startDateStr,
          endDate: endDateStr,
          employeeCount: records.length,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        format: exportFormat,
        startDate: startDateStr,
        endDate: endDateStr,
        employeeCount: records.length,
        fileContent: csvData,
        fileName: `payroll-${exportFormat}-${startDateStr}-to-${endDateStr}.csv`,
      })
  } catch (error) {
    console.error('Failed to generate payroll export:', error)
    return err('Failed to generate payroll export', 500)
  }
})

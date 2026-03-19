import { NextRequest, NextResponse } from 'next/server'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { getLocationId } from '@/lib/location-cache'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireAnyPermission, getActorFromRequest } from '@/lib/api-auth'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'

// GET - Get employee payment preferences
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const employee = await EmployeeRepository.getEmployeeByIdWithSelect(id, locationId, {
      id: true,
      locationId: true,
      firstName: true,
      lastName: true,
      displayName: true,
      hourlyRate: true,

      // Address
      address: true,
      city: true,
      state: true,
      zipCode: true,

      // Tax Info
      federalFilingStatus: true,
      federalAllowances: true,
      additionalFederalWithholding: true,
      stateFilingStatus: true,
      stateAllowances: true,
      additionalStateWithholding: true,
      isExemptFromFederalTax: true,
      isExemptFromStateTax: true,

      // Payment Method
      paymentMethod: true,
      bankName: true,
      bankRoutingNumber: true,
      bankAccountNumber: true,
      bankAccountType: true,
      bankAccountLast4: true,

      // YTD
      ytdGrossEarnings: true,
      ytdTaxesWithheld: true,
      ytdNetPay: true,
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Require payroll or staff wages permission — bank account info is highly sensitive
    const actor = await getActorFromRequest(request)
    const resolvedActorId = actor.employeeId
    const authResult = await requireAnyPermission(resolvedActorId, employee.locationId, [PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.STAFF_EDIT_WAGES])
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

    // Mask sensitive data — strip locationId (added for auth only)
    const { locationId: _loc, ...employeeData } = employee
    const safeEmployee = {
      ...employeeData,
      hourlyRate: employee.hourlyRate ? Number(employee.hourlyRate) : null,
      additionalFederalWithholding: employee.additionalFederalWithholding
        ? Number(employee.additionalFederalWithholding)
        : null,
      additionalStateWithholding: employee.additionalStateWithholding
        ? Number(employee.additionalStateWithholding)
        : null,
      ytdGrossEarnings: employee.ytdGrossEarnings
        ? Number(employee.ytdGrossEarnings)
        : null,
      ytdTaxesWithheld: employee.ytdTaxesWithheld
        ? Number(employee.ytdTaxesWithheld)
        : null,
      ytdNetPay: employee.ytdNetPay ? Number(employee.ytdNetPay) : null,
      // Don't return full bank account info
      bankRoutingNumber: employee.bankRoutingNumber ? '****' : null,
      bankAccountNumber: null, // Never return full account number
    }

    return NextResponse.json({ data: { employee: safeEmployee } })
  } catch (error) {
    console.error('Failed to fetch employee payment info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch employee payment info' },
      { status: 500 }
    )
  }
})

// PUT - Update employee payment preferences
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const employee = await EmployeeRepository.getEmployeeById(id, locationId)
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Require payroll or staff wages permission — updating bank account info is highly sensitive
    const actor = await getActorFromRequest(request)
    const resolvedActorId = actor.employeeId
    const authResult = await requireAnyPermission(resolvedActorId, employee.locationId, [PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.STAFF_EDIT_WAGES])
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

    const updateData: Record<string, unknown> = {}

    // Address fields
    if ('address' in body) updateData.address = body.address
    if ('city' in body) updateData.city = body.city
    if ('state' in body) updateData.state = body.state
    if ('zipCode' in body) updateData.zipCode = body.zipCode

    // Tax fields
    if ('federalFilingStatus' in body) updateData.federalFilingStatus = body.federalFilingStatus
    if ('federalAllowances' in body) updateData.federalAllowances = body.federalAllowances
    if ('additionalFederalWithholding' in body) {
      updateData.additionalFederalWithholding = body.additionalFederalWithholding
    }
    if ('stateFilingStatus' in body) updateData.stateFilingStatus = body.stateFilingStatus
    if ('stateAllowances' in body) updateData.stateAllowances = body.stateAllowances
    if ('additionalStateWithholding' in body) {
      updateData.additionalStateWithholding = body.additionalStateWithholding
    }
    if ('isExemptFromFederalTax' in body) {
      updateData.isExemptFromFederalTax = body.isExemptFromFederalTax
    }
    if ('isExemptFromStateTax' in body) {
      updateData.isExemptFromStateTax = body.isExemptFromStateTax
    }

    // Payment fields
    if ('paymentMethod' in body) updateData.paymentMethod = body.paymentMethod
    if ('bankName' in body) updateData.bankName = body.bankName
    if ('bankAccountType' in body) updateData.bankAccountType = body.bankAccountType

    // Only update bank details if provided (security - don't want to accidentally clear them)
    if (body.bankRoutingNumber) {
      // Validate routing number (9 digits)
      if (!/^\d{9}$/.test(body.bankRoutingNumber)) {
        return NextResponse.json(
          { error: 'Routing number must be 9 digits' },
          { status: 400 }
        )
      }
      updateData.bankRoutingNumber = body.bankRoutingNumber
    }

    if (body.bankAccountNumber) {
      // Validate account number (basic check)
      if (!/^\d{4,17}$/.test(body.bankAccountNumber)) {
        return NextResponse.json(
          { error: 'Invalid account number format' },
          { status: 400 }
        )
      }
      updateData.bankAccountNumber = body.bankAccountNumber
      updateData.bankAccountLast4 = body.bankAccountNumber.slice(-4)
    }

    // Update employee (tenant-scoped) then re-fetch for response
    await EmployeeRepository.updateEmployee(id, locationId, updateData as any)
    const updated = await EmployeeRepository.getEmployeeById(id, locationId)
    if (!updated) {
      return NextResponse.json({ error: 'Employee not found after update' }, { status: 500 })
    }

    // Real-time cross-terminal update
    void emitToLocation(employee.locationId, 'employees:changed', { action: 'updated', employeeId: id }).catch(() => {})

    return NextResponse.json({ data: {
      message: 'Payment preferences updated',
      employee: {
        id: updated.id,
        paymentMethod: updated.paymentMethod,
      },
    } })
  } catch (error) {
    console.error('Failed to update employee payment info:', error)
    return NextResponse.json(
      { error: 'Failed to update employee payment info' },
      { status: 500 }
    )
  }
})

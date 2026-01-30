import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateTaxes, TaxCalculationInput } from '@/lib/payroll/tax-calculator'

// GET - Get payroll period details with pay stubs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const period = await db.payrollPeriod.findUnique({
      where: { id },
      include: {
        payStubs: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                role: { select: { name: true } },
              },
            },
          },
        },
      },
    })

    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }

    return NextResponse.json({
      period: {
        id: period.id,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        periodType: period.periodType,
        status: period.status,
        closedAt: period.closedAt?.toISOString() || null,
        paidAt: period.paidAt?.toISOString() || null,
        totals: {
          regularHours: Number(period.totalRegularHours || 0),
          overtimeHours: Number(period.totalOvertimeHours || 0),
          wages: Number(period.totalWages || 0),
          tips: Number(period.totalTips || 0),
          commissions: Number(period.totalCommissions || 0),
          bankedTips: Number(period.totalBankedTips || 0),
          grandTotal: Number(period.grandTotal || 0),
        },
        notes: period.notes,
      },
      payStubs: period.payStubs.map(stub => ({
        id: stub.id,
        employee: {
          id: stub.employee.id,
          name: stub.employee.displayName || `${stub.employee.firstName} ${stub.employee.lastName}`,
          role: stub.employee.role.name,
        },
        regularHours: Number(stub.regularHours),
        overtimeHours: Number(stub.overtimeHours),
        hourlyRate: Number(stub.hourlyRate),
        regularPay: Number(stub.regularPay),
        overtimePay: Number(stub.overtimePay),
        declaredTips: Number(stub.declaredTips),
        tipSharesGiven: Number(stub.tipSharesGiven),
        tipSharesReceived: Number(stub.tipSharesReceived),
        bankedTipsCollected: Number(stub.bankedTipsCollected),
        netTips: Number(stub.netTips),
        commissionTotal: Number(stub.commissionTotal),
        grossPay: Number(stub.grossPay),
        deductions: stub.deductions,
        netPay: Number(stub.netPay),
        status: stub.status,
        paymentMethod: stub.paymentMethod,
        paidAt: stub.paidAt?.toISOString() || null,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch payroll period:', error)
    return NextResponse.json({ error: 'Failed to fetch payroll period' }, { status: 500 })
  }
}

// PUT - Process/close payroll period
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, closedBy } = body as { action: 'process' | 'close' | 'pay'; closedBy?: string }

    const period = await db.payrollPeriod.findUnique({
      where: { id },
      include: { location: true },
    })

    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }

    // Get payroll settings for tax calculation
    const payrollSettings = await db.payrollSettings.findUnique({
      where: { locationId: period.locationId },
    })

    if (action === 'process') {
      // Generate pay stubs for all employees
      const employees = await db.employee.findMany({
        where: { locationId: period.locationId, isActive: true },
        include: { role: true },
      })

      // Delete existing pay stubs for this period (to regenerate)
      await db.payStub.deleteMany({ where: { payrollPeriodId: id } })

      let totalRegularHours = 0
      let totalOvertimeHours = 0
      let totalWages = 0
      let totalTips = 0
      let totalCommissions = 0
      let totalBankedTips = 0
      let grandTotal = 0

      for (const employee of employees) {
        // Get time entries for this period
        const timeEntries = await db.timeClockEntry.findMany({
          where: {
            employeeId: employee.id,
            clockIn: {
              gte: period.periodStart,
              lte: period.periodEnd,
            },
            clockOut: { not: null },
          },
        })

        // Get closed shifts for tips
        const shifts = await db.shift.findMany({
          where: {
            employeeId: employee.id,
            status: 'closed',
            startedAt: {
              gte: period.periodStart,
              lte: period.periodEnd,
            },
          },
        })

        // Get tip shares
        const tipSharesGiven = await db.tipShare.findMany({
          where: {
            fromEmployeeId: employee.id,
            createdAt: {
              gte: period.periodStart,
              lte: period.periodEnd,
            },
          },
        })

        const tipSharesReceived = await db.tipShare.findMany({
          where: {
            toEmployeeId: employee.id,
            createdAt: {
              gte: period.periodStart,
              lte: period.periodEnd,
            },
          },
        })

        // Get banked tips collected
        const bankedTips = await db.tipBank.findMany({
          where: {
            employeeId: employee.id,
            status: 'collected',
            collectedAt: {
              gte: period.periodStart,
              lte: period.periodEnd,
            },
          },
        })

        // Get commission from orders
        const orders = await db.order.findMany({
          where: {
            employeeId: employee.id,
            status: { in: ['completed', 'paid'] },
            createdAt: {
              gte: period.periodStart,
              lte: period.periodEnd,
            },
            commissionTotal: { gt: 0 },
          },
        })

        // Calculate totals
        const regularHours = timeEntries.reduce((sum, e) => sum + Number(e.regularHours || 0), 0)
        const overtimeHours = timeEntries.reduce((sum, e) => sum + Number(e.overtimeHours || 0), 0)
        const breakMinutes = timeEntries.reduce((sum, e) => sum + (e.breakMinutes || 0), 0)
        const hourlyRate = Number(employee.hourlyRate || 0)

        const regularPay = Math.round(regularHours * hourlyRate * 100) / 100
        const overtimePay = Math.round(overtimeHours * hourlyRate * 1.5 * 100) / 100
        const totalWagesEmp = regularPay + overtimePay

        const declaredTips = shifts.reduce((sum, s) => sum + Number(s.tipsDeclared || 0), 0)
        const tipSharesGivenTotal = tipSharesGiven.reduce((sum, ts) => sum + Number(ts.amount), 0)
        const tipSharesReceivedTotal = tipSharesReceived.reduce((sum, ts) => sum + Number(ts.amount), 0)
        const bankedTipsCollected = bankedTips.reduce((sum, bt) => sum + Number(bt.amount), 0)
        const netTipsEmp = declaredTips - tipSharesGivenTotal + tipSharesReceivedTotal + bankedTipsCollected

        const commissionTotal = orders.reduce((sum, o) => sum + Number(o.commissionTotal), 0)

        const grossPay = Math.round((totalWagesEmp + netTipsEmp + commissionTotal) * 100) / 100

        // Calculate taxes if we have payroll settings
        let deductions: Record<string, number> = {}
        let netPay = grossPay

        if (grossPay > 0) {
          // Determine pay frequency
          const payFrequency = (period.periodType as TaxCalculationInput['payFrequency']) || 'biweekly'

          const taxInput: TaxCalculationInput = {
            grossPay,
            payFrequency,
            filingStatus: (employee.federalFilingStatus as 'single' | 'married' | 'head_of_household') || 'single',
            federalAllowances: employee.federalAllowances || 0,
            stateCode: payrollSettings?.stateTaxState || undefined,
            additionalWithholding: Number(employee.additionalStateWithholding || 0),
            isExemptFromFederal: employee.isExemptFromFederalTax || false,
            isExemptFromState: employee.isExemptFromStateTax || false,
            ytdGrossWages: Number(employee.ytdGrossWages || 0),
          }

          const taxes = calculateTaxes(taxInput)

          deductions = {
            federalTax: taxes.federalTax,
            stateTax: taxes.stateTax,
            localTax: taxes.localTax,
            socialSecurity: taxes.socialSecurity,
            medicare: taxes.medicare,
          }

          netPay = taxes.netPay
        }

        // Only create pay stub if there's any activity
        if (regularHours > 0 || declaredTips > 0 || commissionTotal > 0 || tipSharesReceivedTotal > 0 || bankedTipsCollected > 0) {
          await db.payStub.create({
            data: {
              locationId: period.locationId,
              payrollPeriodId: id,
              employeeId: employee.id,
              regularHours,
              overtimeHours,
              breakMinutes,
              hourlyRate,
              regularPay,
              overtimePay,
              declaredTips,
              tipSharesGiven: tipSharesGivenTotal,
              tipSharesReceived: tipSharesReceivedTotal,
              bankedTipsCollected,
              netTips: netTipsEmp,
              commissionTotal,
              grossPay,
              deductions,
              netPay,
              shiftCount: shifts.length,
              shiftIds: shifts.map(s => s.id),
              timeEntryIds: timeEntries.map(te => te.id),
              paymentMethod: employee.paymentMethod,
              status: 'pending',
            },
          })

          // Update running totals
          totalRegularHours += regularHours
          totalOvertimeHours += overtimeHours
          totalWages += totalWagesEmp
          totalTips += netTipsEmp
          totalCommissions += commissionTotal
          totalBankedTips += bankedTipsCollected
          grandTotal += grossPay
        }
      }

      // Update period totals
      await db.payrollPeriod.update({
        where: { id },
        data: {
          status: 'processing',
          totalRegularHours,
          totalOvertimeHours,
          totalWages,
          totalTips,
          totalCommissions,
          totalBankedTips,
          grandTotal,
        },
      })

      return NextResponse.json({
        message: 'Payroll processed successfully',
        totals: {
          regularHours: totalRegularHours,
          overtimeHours: totalOvertimeHours,
          wages: totalWages,
          tips: totalTips,
          commissions: totalCommissions,
          bankedTips: totalBankedTips,
          grandTotal,
        },
      })
    }

    if (action === 'close') {
      // Close the payroll period
      await db.payrollPeriod.update({
        where: { id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedBy,
        },
      })

      // Approve all pay stubs
      await db.payStub.updateMany({
        where: { payrollPeriodId: id },
        data: { status: 'approved' },
      })

      return NextResponse.json({ message: 'Payroll period closed' })
    }

    if (action === 'pay') {
      // Mark period as paid and update employee YTD
      const payStubs = await db.payStub.findMany({
        where: { payrollPeriodId: id },
      })

      for (const stub of payStubs) {
        // Update pay stub
        await db.payStub.update({
          where: { id: stub.id },
          data: {
            status: 'paid',
            paidAt: new Date(),
          },
        })

        // Update employee YTD
        const deductions = (stub.deductions || {}) as Record<string, number>
        await db.employee.update({
          where: { id: stub.employeeId },
          data: {
            ytdGrossWages: { increment: Number(stub.grossPay) },
            ytdFederalTax: { increment: deductions.federalTax || 0 },
            ytdStateTax: { increment: deductions.stateTax || 0 },
            ytdLocalTax: { increment: deductions.localTax || 0 },
            ytdSocialSecurity: { increment: deductions.socialSecurity || 0 },
            ytdMedicare: { increment: deductions.medicare || 0 },
            ytdTips: { increment: Number(stub.netTips) },
            ytdCommission: { increment: Number(stub.commissionTotal) },
            ytdNetPay: { increment: Number(stub.netPay) },
            ytdLastUpdated: new Date(),
          },
        })
      }

      // Update period
      await db.payrollPeriod.update({
        where: { id },
        data: {
          status: 'paid',
          paidAt: new Date(),
        },
      })

      return NextResponse.json({ message: 'Payroll marked as paid, YTD updated' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Failed to update payroll period:', error)
    return NextResponse.json({ error: 'Failed to update payroll period' }, { status: 500 })
  }
}

// DELETE - Delete payroll period (only if open)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const period = await db.payrollPeriod.findUnique({ where: { id } })
    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }

    if (period.status !== 'open') {
      return NextResponse.json(
        { error: 'Can only delete open payroll periods' },
        { status: 400 }
      )
    }

    // Delete pay stubs first
    await db.payStub.deleteMany({ where: { payrollPeriodId: id } })

    // Delete period
    await db.payrollPeriod.delete({ where: { id } })

    return NextResponse.json({ message: 'Payroll period deleted' })
  } catch (error) {
    console.error('Failed to delete payroll period:', error)
    return NextResponse.json({ error: 'Failed to delete payroll period' }, { status: 500 })
  }
}

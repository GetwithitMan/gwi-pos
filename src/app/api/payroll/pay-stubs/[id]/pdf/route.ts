import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generatePayStubPDF, PayStubData } from '@/lib/payroll/pay-stub-pdf'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fetch pay stub with all related data
    const payStub = await db.payStub.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            hourlyRate: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            paymentMethod: true,
            bankAccountLast4: true,
            ytdGrossEarnings: true,
            ytdTaxesWithheld: true,
            ytdNetPay: true,
          },
        },
        payrollPeriod: {
          select: {
            periodStart: true,
            periodEnd: true,
            paidAt: true,
          },
        },
        location: {
          include: {
            organization: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    })

    if (!payStub) {
      return NextResponse.json({ error: 'Pay stub not found' }, { status: 404 })
    }

    // Build employee address
    const employeeAddress = [
      payStub.employee.address,
      payStub.employee.city,
      payStub.employee.state,
      payStub.employee.zipCode,
    ]
      .filter(Boolean)
      .join(', ')

    // Build pay stub data
    const payStubData: PayStubData = {
      companyName: payStub.location.organization?.name || payStub.location.name,
      companyAddress: payStub.location.address || undefined,
      companyPhone: payStub.location.phone || undefined,

      employeeName:
        payStub.employee.displayName ||
        `${payStub.employee.firstName} ${payStub.employee.lastName}`,
      employeeId: payStub.employee.id.slice(-8).toUpperCase(),
      employeeAddress: employeeAddress || undefined,
      paymentMethod: payStub.employee.paymentMethod || 'check',
      last4BankAccount: payStub.employee.bankAccountLast4 || undefined,

      payPeriodStart: payStub.payrollPeriod.periodStart.toISOString(),
      payPeriodEnd: payStub.payrollPeriod.periodEnd.toISOString(),
      payDate: payStub.payrollPeriod.paidAt?.toISOString() || new Date().toISOString(),
      checkNumber: payStub.checkNumber || undefined,

      earnings: [
        {
          description: 'Regular Hours',
          hours: Number(payStub.regularHours) || 0,
          rate: Number(payStub.hourlyRate) || 0,
          amount: Number(payStub.regularPay) || 0,
        },
      ],

      tips: Number(payStub.netTips) || 0,
      commission: Number(payStub.commissionTotal) || 0,
      bankedTips: Number(payStub.bankedTipsCollected) || 0,

      deductions: [
        {
          description: 'Federal Income Tax',
          amount: Number(payStub.federalTax) || 0,
        },
        {
          description: 'State Income Tax',
          amount: Number(payStub.stateTax) || 0,
        },
        {
          description: 'Social Security Tax',
          amount: Number(payStub.socialSecurityTax) || 0,
        },
        {
          description: 'Medicare Tax',
          amount: Number(payStub.medicareTax) || 0,
        },
      ].filter((d) => d.amount > 0),

      grossPay: Number(payStub.grossPay) || 0,
      totalDeductions: Number(payStub.totalDeductions) || 0,
      netPay: Number(payStub.netPay) || 0,

      ytdGross: Number(payStub.employee.ytdGrossEarnings) || 0,
      ytdTaxes: Number(payStub.employee.ytdTaxesWithheld) || 0,
      ytdNet: Number(payStub.employee.ytdNetPay) || 0,
    }

    // Add overtime if present
    const overtimeHours = Number(payStub.overtimeHours) || 0
    if (overtimeHours > 0) {
      const overtimeRate = (Number(payStub.hourlyRate) || 0) * 1.5
      payStubData.earnings.push({
        description: 'Overtime Hours (1.5x)',
        hours: overtimeHours,
        rate: overtimeRate,
        amount: Number(payStub.overtimePay) || 0,
      })
    }

    // Generate PDF
    const pdfBuffer = await generatePayStubPDF(payStubData)

    // Return PDF
    const employeeName = payStubData.employeeName.replace(/[^a-zA-Z0-9]/g, '_')
    const periodEnd = payStub.payrollPeriod.periodEnd.toISOString().split('T')[0]
    const filename = `PayStub_${employeeName}_${periodEnd}.pdf`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Failed to generate pay stub PDF:', error)
    return NextResponse.json(
      { error: 'Failed to generate pay stub PDF' },
      { status: 500 }
    )
  }
})

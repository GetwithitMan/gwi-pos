import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get pending tips for an employee
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params

    // Get all pending tip shares for this employee
    const pendingTips = await db.tipShare.findMany({
      where: {
        toEmployeeId: employeeId,
        status: 'pending',
      },
      include: {
        fromEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        rule: {
          select: {
            percentage: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Get banked tips for this employee
    const bankedTips = await db.tipBank.findMany({
      where: {
        employeeId,
        status: 'pending',
      },
      include: {
        tipShare: {
          include: {
            fromEmployee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Calculate totals
    const pendingTotal = pendingTips.reduce((sum, t) => sum + Number(t.amount), 0)
    const bankedTotal = bankedTips.reduce((sum, t) => sum + Number(t.amount), 0)

    return NextResponse.json({
      pending: {
        tips: pendingTips.map(tip => ({
          id: tip.id,
          amount: Number(tip.amount),
          shareType: tip.shareType,
          fromEmployee: tip.fromEmployee.displayName ||
            `${tip.fromEmployee.firstName} ${tip.fromEmployee.lastName}`,
          percentage: tip.rule ? Number(tip.rule.percentage) : null,
          createdAt: tip.createdAt.toISOString(),
        })),
        total: Math.round(pendingTotal * 100) / 100,
      },
      banked: {
        tips: bankedTips.map(tip => ({
          id: tip.id,
          amount: Number(tip.amount),
          source: tip.source,
          fromEmployee: tip.tipShare?.fromEmployee
            ? tip.tipShare.fromEmployee.displayName ||
              `${tip.tipShare.fromEmployee.firstName} ${tip.tipShare.fromEmployee.lastName}`
            : 'Unknown',
          createdAt: tip.createdAt.toISOString(),
        })),
        total: Math.round(bankedTotal * 100) / 100,
      },
      grandTotal: Math.round((pendingTotal + bankedTotal) * 100) / 100,
    })
  } catch (error) {
    console.error('Failed to fetch pending tips:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pending tips' },
      { status: 500 }
    )
  }
}

// POST - Collect pending tips
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const body = await request.json()
    const { action } = body as { action: 'collect' | 'collect_all' }

    const now = new Date()

    if (action === 'collect' || action === 'collect_all' || action === 'accept' || action === 'accept_all') {
      // Update all pending tip shares to accepted (employee acknowledged)
      const updatedPendingShares = await db.tipShare.updateMany({
        where: {
          toEmployeeId: employeeId,
          status: 'pending',
        },
        data: {
          status: 'accepted',
          collectedAt: now, // Using collectedAt for accepted timestamp
        },
      })

      // Update all banked tip shares to accepted
      const updatedBankedShares = await db.tipShare.updateMany({
        where: {
          toEmployeeId: employeeId,
          status: 'banked',
        },
        data: {
          status: 'accepted',
          collectedAt: now,
        },
      })

      // Update all pending tip bank entries to accepted
      const updatedTipBank = await db.tipBank.updateMany({
        where: {
          employeeId: employeeId,
          status: 'pending',
        },
        data: {
          status: 'accepted',
          collectedAt: now,
        },
      })

      const totalAccepted = updatedPendingShares.count + updatedBankedShares.count

      return NextResponse.json({
        message: `Accepted ${totalAccepted} tip share(s) - will be added to payroll`,
        acceptedCount: totalAccepted,
        pendingSharesAccepted: updatedPendingShares.count,
        bankedSharesAccepted: updatedBankedShares.count,
        tipBankEntriesAccepted: updatedTipBank.count,
        acceptedAt: now.toISOString(),
      })
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to collect tips:', error)
    return NextResponse.json(
      { error: 'Failed to collect tips' },
      { status: 500 }
    )
  }
}

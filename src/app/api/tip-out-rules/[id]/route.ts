import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET: Get a single tip-out rule
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const rule = await db.tipOutRule.findUnique({
      where: { id },
      include: {
        fromRole: {
          select: { id: true, name: true, isTipped: true }
        },
        toRole: {
          select: { id: true, name: true, isTipped: true }
        }
      }
    })

    if (!rule) {
      return NextResponse.json(
        { error: 'Tip-out rule not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      data: {
        ...rule,
        percentage: Number(rule.percentage),
        maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
        effectiveDate: rule.effectiveDate?.toISOString() || null,
        expiresAt: rule.expiresAt?.toISOString() || null,
      }
    })
  } catch (error) {
    console.error('Error fetching tip-out rule:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tip-out rule' },
      { status: 500 }
    )
  }
})

// PUT: Update a tip-out rule
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { percentage, isActive, basisType, salesCategoryIds, maxPercentage, effectiveDate, expiresAt } = body

    // Check if rule exists
    const existingRule = await db.tipOutRule.findUnique({
      where: { id }
    })

    if (!existingRule) {
      return NextResponse.json(
        { error: 'Tip-out rule not found' },
        { status: 404 }
      )
    }

    // Valid basisType values
    const VALID_BASIS_TYPES = ['tips_earned', 'food_sales', 'bar_sales', 'total_sales', 'net_sales']

    // Validate basisType if provided
    if (basisType !== undefined && !VALID_BASIS_TYPES.includes(basisType)) {
      return NextResponse.json(
        { error: `Invalid basisType. Must be one of: ${VALID_BASIS_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate maxPercentage if provided
    if (maxPercentage !== undefined && maxPercentage !== null) {
      const maxPctNum = Number(maxPercentage)
      if (isNaN(maxPctNum) || maxPctNum < 0 || maxPctNum > 100) {
        return NextResponse.json(
          { error: 'maxPercentage must be between 0 and 100' },
          { status: 400 }
        )
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {}

    if (percentage !== undefined) {
      const percentageNum = Number(percentage)
      if (isNaN(percentageNum) || percentageNum <= 0 || percentageNum > 100) {
        return NextResponse.json(
          { error: 'Percentage must be between 0 and 100' },
          { status: 400 }
        )
      }
      updateData.percentage = percentageNum
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive)
    }

    if (basisType !== undefined) updateData.basisType = basisType
    if (salesCategoryIds !== undefined) updateData.salesCategoryIds = salesCategoryIds
    if (maxPercentage !== undefined) {
      updateData.maxPercentage = maxPercentage !== null ? Number(maxPercentage) : null
    }
    if (effectiveDate !== undefined) {
      updateData.effectiveDate = effectiveDate !== null ? new Date(effectiveDate) : null
    }
    if (expiresAt !== undefined) {
      updateData.expiresAt = expiresAt !== null ? new Date(expiresAt) : null
    }

    const rule = await db.tipOutRule.update({
      where: { id },
      data: updateData,
      include: {
        fromRole: {
          select: { id: true, name: true, isTipped: true }
        },
        toRole: {
          select: { id: true, name: true, isTipped: true }
        }
      }
    })

    return NextResponse.json({
      data: {
        ...rule,
        percentage: Number(rule.percentage),
        maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
        effectiveDate: rule.effectiveDate?.toISOString() || null,
        expiresAt: rule.expiresAt?.toISOString() || null,
      }
    })
  } catch (error) {
    console.error('Error updating tip-out rule:', error)
    return NextResponse.json(
      { error: 'Failed to update tip-out rule' },
      { status: 500 }
    )
  }
})

// DELETE: Delete a tip-out rule
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if rule exists
    const existingRule = await db.tipOutRule.findUnique({
      where: { id }
    })

    if (!existingRule) {
      return NextResponse.json(
        { error: 'Tip-out rule not found' },
        { status: 404 }
      )
    }

    // Check if rule has been used in any tip shares or ledger entries (Skill 273)
    // Check both legacy TipShare and new TipLedgerEntry for historical usage
    const [usedInShares, usedInLedger] = await Promise.all([
      db.tipShare.count({ where: { ruleId: id } }),
      db.tipLedgerEntry.count({ where: { sourceType: 'ROLE_TIPOUT', sourceId: id, deletedAt: null } }),
    ])

    if (usedInShares > 0 || usedInLedger > 0) {
      // Instead of deleting, deactivate it
      await db.tipOutRule.update({
        where: { id },
        data: { isActive: false }
      })
      return NextResponse.json({ data: {
        message: 'Tip-out rule has been deactivated (it has historical tip data)'
      } })
    }

    // Soft delete the rule
    await db.tipOutRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: {
      message: 'Tip-out rule deleted successfully'
    } })
  } catch (error) {
    console.error('Error deleting tip-out rule:', error)
    return NextResponse.json(
      { error: 'Failed to delete tip-out rule' },
      { status: 500 }
    )
  }
})

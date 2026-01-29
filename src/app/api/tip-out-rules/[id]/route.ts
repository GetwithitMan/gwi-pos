import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET: Get a single tip-out rule
export async function GET(
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
        percentage: Number(rule.percentage)
      }
    })
  } catch (error) {
    console.error('Error fetching tip-out rule:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tip-out rule' },
      { status: 500 }
    )
  }
}

// PUT: Update a tip-out rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { percentage, isActive } = body

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

    // Build update data
    const updateData: { percentage?: number; isActive?: boolean } = {}

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
        percentage: Number(rule.percentage)
      }
    })
  } catch (error) {
    console.error('Error updating tip-out rule:', error)
    return NextResponse.json(
      { error: 'Failed to update tip-out rule' },
      { status: 500 }
    )
  }
}

// DELETE: Delete a tip-out rule
export async function DELETE(
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

    // Check if rule has been used in any tip shares
    const usedInShares = await db.tipShare.count({
      where: { ruleId: id }
    })

    if (usedInShares > 0) {
      // Instead of deleting, deactivate it
      await db.tipOutRule.update({
        where: { id },
        data: { isActive: false }
      })
      return NextResponse.json({
        message: 'Tip-out rule has been deactivated (it has historical tip shares)'
      })
    }

    // Delete the rule
    await db.tipOutRule.delete({
      where: { id }
    })

    return NextResponse.json({
      message: 'Tip-out rule deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting tip-out rule:', error)
    return NextResponse.json(
      { error: 'Failed to delete tip-out rule' },
      { status: 500 }
    )
  }
}

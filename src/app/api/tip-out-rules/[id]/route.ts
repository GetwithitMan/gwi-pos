import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

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
      return notFound('Tip-out rule not found')
    }

    return ok({
        ...rule,
        percentage: Number(rule.percentage),
        maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
        effectiveDate: rule.effectiveDate?.toISOString() || null,
        expiresAt: rule.expiresAt?.toISOString() || null,
      })
  } catch (error) {
    console.error('Error fetching tip-out rule:', error)
    return err('Failed to fetch tip-out rule', 500)
  }
})

// PUT: Update a tip-out rule
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
      return notFound('Tip-out rule not found')
    }

    // Valid basisType values
    const VALID_BASIS_TYPES = ['tips_earned', 'food_sales', 'bar_sales', 'total_sales', 'net_sales']

    // Validate basisType if provided
    if (basisType !== undefined && !VALID_BASIS_TYPES.includes(basisType)) {
      return err(`Invalid basisType. Must be one of: ${VALID_BASIS_TYPES.join(', ')}`)
    }

    // Validate maxPercentage if provided
    if (maxPercentage !== undefined && maxPercentage !== null) {
      const maxPctNum = Number(maxPercentage)
      if (isNaN(maxPctNum) || maxPctNum < 0 || maxPctNum > 100) {
        return err('maxPercentage must be between 0 and 100')
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {}

    if (percentage !== undefined) {
      const percentageNum = Number(percentage)
      if (isNaN(percentageNum) || percentageNum <= 0 || percentageNum > 100) {
        return err('Percentage must be between 0 and 100')
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

    updateData.lastMutatedBy = process.env.VERCEL ? 'cloud' : 'local'

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

    void notifyDataChanged({ locationId: existingRule.locationId, domain: 'tip-out-rules', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
        ...rule,
        percentage: Number(rule.percentage),
        maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
        effectiveDate: rule.effectiveDate?.toISOString() || null,
        expiresAt: rule.expiresAt?.toISOString() || null,
      })
  } catch (error) {
    console.error('Error updating tip-out rule:', error)
    return err('Failed to update tip-out rule', 500)
  }
}))

// DELETE: Delete a tip-out rule
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
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
      return notFound('Tip-out rule not found')
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
        data: { isActive: false, lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' }
      })
      return ok({
        message: 'Tip-out rule has been deactivated (it has historical tip data)'
      })
    }

    // Soft delete the rule
    await db.tipOutRule.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
    })

    void notifyDataChanged({ locationId: existingRule.locationId, domain: 'tip-out-rules', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({
      message: 'Tip-out rule deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting tip-out rule:', error)
    return err('Failed to delete tip-out rule', 500)
  }
}))

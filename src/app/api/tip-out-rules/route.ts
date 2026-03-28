import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { created, err, ok } from '@/lib/api-response'

// Valid basisType values
const VALID_BASIS_TYPES = ['tips_earned', 'food_sales', 'bar_sales', 'total_sales', 'net_sales'] as const

// GET: List all tip-out rules for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeExpired = searchParams.get('includeExpired') === 'true'

    if (!locationId) {
      return err('Location ID is required')
    }

    // Build where clause: filter expired rules by default
    const where: Record<string, unknown> = { locationId }
    if (!includeExpired) {
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } }
      ]
    }

    const rules = await db.tipOutRule.findMany({
      where,
      include: {
        fromRole: {
          select: { id: true, name: true, isTipped: true }
        },
        toRole: {
          select: { id: true, name: true, isTipped: true }
        }
      },
      orderBy: [
        { fromRole: { name: 'asc' } },
        { toRole: { name: 'asc' } }
      ]
    })

    // Convert Decimal to number and DateTime to ISO string for JSON serialization
    const serializedRules = rules.map(rule => ({
      ...rule,
      percentage: Number(rule.percentage),
      maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
      effectiveDate: rule.effectiveDate?.toISOString() || null,
      expiresAt: rule.expiresAt?.toISOString() || null,
    }))

    return ok(serializedRules)
  } catch (error) {
    console.error('Error fetching tip-out rules:', error)
    return err('Failed to fetch tip-out rules', 500)
  }
})

// POST: Create a new tip-out rule
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, fromRoleId, toRoleId, percentage, basisType, salesCategoryIds, maxPercentage, effectiveDate, expiresAt } = body

    // Validation
    if (!locationId || !fromRoleId || !toRoleId || percentage === undefined) {
      return err('Missing required fields: locationId, fromRoleId, toRoleId, percentage')
    }

    // Require tips.manage_rules permission — modifying tip-out rules is a manager action
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? body.employeeId
    const authResult = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.TIPS_MANAGE_RULES)
    if (!authResult.authorized) return err(authResult.error, authResult.status)

    if (fromRoleId === toRoleId) {
      return err('From role and to role cannot be the same')
    }

    const percentageNum = Number(percentage)
    if (isNaN(percentageNum) || percentageNum <= 0 || percentageNum > 100) {
      return err('Percentage must be between 0 and 100')
    }

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

    // Check if rule already exists
    const existingRule = await db.tipOutRule.findUnique({
      where: {
        locationId_fromRoleId_toRoleId: {
          locationId,
          fromRoleId,
          toRoleId
        }
      }
    })

    if (existingRule) {
      return err('A tip-out rule already exists for this role combination', 409)
    }

    // Build create data with new fields
    const createData = {
      locationId,
      fromRoleId,
      toRoleId,
      percentage: percentageNum,
      ...(basisType !== undefined && { basisType }),
      ...(salesCategoryIds !== undefined && { salesCategoryIds }),
      ...(maxPercentage !== undefined && maxPercentage !== null && { maxPercentage: Number(maxPercentage) }),
      ...(effectiveDate !== undefined && effectiveDate !== null && { effectiveDate: new Date(effectiveDate) }),
      ...(expiresAt !== undefined && expiresAt !== null && { expiresAt: new Date(expiresAt) }),
      lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
    }

    // Create the rule
    const rule = await db.tipOutRule.create({
      data: createData,
      include: {
        fromRole: {
          select: { id: true, name: true, isTipped: true }
        },
        toRole: {
          select: { id: true, name: true, isTipped: true }
        }
      }
    })

    void notifyDataChanged({ locationId, domain: 'tip-out-rules', action: 'created', entityId: rule.id })
    void pushUpstream()

    return created({
        ...rule,
        percentage: Number(rule.percentage),
        maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
        effectiveDate: rule.effectiveDate?.toISOString() || null,
        expiresAt: rule.expiresAt?.toISOString() || null,
      })
  } catch (error) {
    console.error('Error creating tip-out rule:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return err(`Failed to create tip-out rule: ${errorMessage}`, 500)
  }
})

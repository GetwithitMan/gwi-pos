import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Valid basisType values
const VALID_BASIS_TYPES = ['tips_earned', 'food_sales', 'bar_sales', 'total_sales', 'net_sales'] as const

// GET: List all tip-out rules for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeExpired = searchParams.get('includeExpired') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
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

    return NextResponse.json({ data: serializedRules })
  } catch (error) {
    console.error('Error fetching tip-out rules:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tip-out rules' },
      { status: 500 }
    )
  }
}

// POST: Create a new tip-out rule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId, fromRoleId, toRoleId, percentage, basisType, salesCategoryIds, maxPercentage, effectiveDate, expiresAt } = body

    // Validation
    if (!locationId || !fromRoleId || !toRoleId || percentage === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: locationId, fromRoleId, toRoleId, percentage' },
        { status: 400 }
      )
    }

    if (fromRoleId === toRoleId) {
      return NextResponse.json(
        { error: 'From role and to role cannot be the same' },
        { status: 400 }
      )
    }

    const percentageNum = Number(percentage)
    if (isNaN(percentageNum) || percentageNum <= 0 || percentageNum > 100) {
      return NextResponse.json(
        { error: 'Percentage must be between 0 and 100' },
        { status: 400 }
      )
    }

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
      return NextResponse.json(
        { error: 'A tip-out rule already exists for this role combination' },
        { status: 409 }
      )
    }

    // Build create data with new fields
    const createData: Record<string, unknown> = {
      locationId,
      fromRoleId,
      toRoleId,
      percentage: percentageNum,
    }
    if (basisType !== undefined) createData.basisType = basisType
    if (salesCategoryIds !== undefined) createData.salesCategoryIds = salesCategoryIds
    if (maxPercentage !== undefined && maxPercentage !== null) createData.maxPercentage = Number(maxPercentage)
    if (effectiveDate !== undefined && effectiveDate !== null) createData.effectiveDate = new Date(effectiveDate)
    if (expiresAt !== undefined && expiresAt !== null) createData.expiresAt = new Date(expiresAt)

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

    return NextResponse.json({
      data: {
        ...rule,
        percentage: Number(rule.percentage),
        maxPercentage: rule.maxPercentage ? Number(rule.maxPercentage) : null,
        effectiveDate: rule.effectiveDate?.toISOString() || null,
        expiresAt: rule.expiresAt?.toISOString() || null,
      }
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating tip-out rule:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to create tip-out rule: ${errorMessage}` },
      { status: 500 }
    )
  }
}

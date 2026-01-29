import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET: List all tip-out rules for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const rules = await db.tipOutRule.findMany({
      where: { locationId },
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

    // Convert Decimal to number for JSON serialization
    const serializedRules = rules.map(rule => ({
      ...rule,
      percentage: Number(rule.percentage)
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
    const { locationId, fromRoleId, toRoleId, percentage } = body

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

    // Create the rule
    const rule = await db.tipOutRule.create({
      data: {
        locationId,
        fromRoleId,
        toRoleId,
        percentage: percentageNum
      },
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

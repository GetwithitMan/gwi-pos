import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List house accounts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = { locationId }

    if (status) {
      where.status = status
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { contactName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ]
    }

    const accounts = await db.houseAccount.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          }
        },
        _count: {
          select: { transactions: true }
        }
      }
    })

    return NextResponse.json(accounts.map(account => ({
      ...account,
      creditLimit: Number(account.creditLimit),
      currentBalance: Number(account.currentBalance),
    })))
  } catch (error) {
    console.error('Failed to fetch house accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch house accounts' },
      { status: 500 }
    )
  }
}

// POST - Create a new house account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      contactName,
      email,
      phone,
      address,
      creditLimit,
      paymentTerms,
      billingCycle,
      taxExempt,
      taxId,
      customerId,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'Location ID and account name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate name at location
    const existing = await db.houseAccount.findUnique({
      where: {
        locationId_name: { locationId, name }
      }
    })

    if (existing) {
      return NextResponse.json(
        { error: 'An account with this name already exists' },
        { status: 400 }
      )
    }

    const account = await db.houseAccount.create({
      data: {
        locationId,
        name,
        contactName,
        email,
        phone,
        address,
        creditLimit: creditLimit || 0,
        paymentTerms: paymentTerms || 30,
        billingCycle: billingCycle || 'monthly',
        taxExempt: taxExempt || false,
        taxId,
        customerId,
        status: 'active',
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          }
        }
      }
    })

    return NextResponse.json({
      ...account,
      creditLimit: Number(account.creditLimit),
      currentBalance: Number(account.currentBalance),
    }, { status: 201 })
  } catch (error) {
    console.error('Failed to create house account:', error)
    return NextResponse.json(
      { error: 'Failed to create house account' },
      { status: 500 }
    )
  }
}

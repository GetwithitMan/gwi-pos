import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get a single house account
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId')

    const account = await db.houseAccount.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        transactions: { take: 50, orderBy: { createdAt: 'desc' } },
      },
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    return NextResponse.json({
      account: {
        ...account,
        creditLimit: Number(account.creditLimit),
        currentBalance: Number(account.currentBalance),
        transactions: account.transactions.map(t => ({
          ...t,
          amount: Number(t.amount),
        })),
      },
    })
  } catch (error) {
    console.error('Failed to fetch account:', error)
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 })
  }
}

// PUT - Update a house account
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const locationId = body.locationId || request.nextUrl.searchParams.get('locationId')
    const existing = await db.houseAccount.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const account = await db.houseAccount.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.contactName !== undefined && { contactName: body.contactName }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.address !== undefined && { address: body.address }),
        ...(body.creditLimit !== undefined && { creditLimit: body.creditLimit }),
        ...(body.paymentTerms !== undefined && { paymentTerms: body.paymentTerms }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.taxExempt !== undefined && { taxExempt: body.taxExempt }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    })

    return NextResponse.json({
      account: { ...account, creditLimit: Number(account.creditLimit), currentBalance: Number(account.currentBalance) },
    })
  } catch (error) {
    console.error('Failed to update account:', error)
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}

// DELETE - Close/delete a house account
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId')

    const account = await db.houseAccount.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
      include: { _count: { select: { transactions: true } } },
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Check for outstanding balance
    if (Number(account.currentBalance) !== 0) {
      return NextResponse.json(
        { error: 'Cannot delete account with outstanding balance' },
        { status: 409 }
      )
    }

    // If has transactions, close instead of delete
    if (account._count.transactions > 0) {
      await db.houseAccount.update({
        where: { id },
        data: { status: 'closed' },
      })
      return NextResponse.json({ success: true, message: 'Account closed (has transaction history)' })
    }

    await db.houseAccount.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete account:', error)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}

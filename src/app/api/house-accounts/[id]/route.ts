import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get a single house account
export const GET = withVenue(async function GET(
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
      return notFound('Account not found')
    }

    return ok({
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
    return err('Failed to fetch account', 500)
  }
})

// PUT - Update a house account
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
      return notFound('Account not found')
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
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'house-accounts', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      account: { ...account, creditLimit: Number(account.creditLimit), currentBalance: Number(account.currentBalance) },
    })
  } catch (error) {
    console.error('Failed to update account:', error)
    return err('Failed to update account', 500)
  }
}))

// DELETE - Close/delete a house account
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
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
      return notFound('Account not found')
    }

    // Check for outstanding balance
    if (Number(account.currentBalance) !== 0) {
      return err('Cannot delete account with outstanding balance', 409)
    }

    // If has transactions, close instead of delete
    if (account._count.transactions > 0) {
      await db.houseAccount.update({
        where: { id },
        data: { status: 'closed', lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' },
      })
      void notifyDataChanged({ locationId: account.locationId, domain: 'house-accounts', action: 'deleted', entityId: id })
      void pushUpstream()
      return ok({ success: true, message: 'Account closed (has transaction history)' })
    }

    await db.houseAccount.update({ where: { id }, data: { deletedAt: new Date(), lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local' } })
    void notifyDataChanged({ locationId: account.locationId, domain: 'house-accounts', action: 'deleted', entityId: id })
    void pushUpstream()
    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete account:', error)
    return err('Failed to delete account', 500)
  }
}))

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'

// GET - List house accounts (no admin perm needed — read-only POS query)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId') || await getLocationId()
    const status = sp.get('status')
    const search = sp.get('search')

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

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
})

// POST - Create a new house account
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
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
      requestingEmployeeId: bodyEmployeeId,
    } = body

    const actor = await getActorFromRequest(request)
    const requestingEmployeeId = actor.employeeId ?? bodyEmployeeId
    const locationId = body.locationId || actor.locationId || await getLocationId()

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.CUSTOMERS_HOUSE_ACCOUNTS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!name) {
      return NextResponse.json(
        { error: 'Account name is required' },
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
        paymentTerms: paymentTerms ?? 30,
        billingCycle: billingCycle || 'monthly',
        taxExempt: taxExempt || false,
        taxId,
        customerId,
        status: 'pending',
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
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

    void notifyDataChanged({ locationId, domain: 'house-accounts', action: 'created', entityId: account.id })
    void pushUpstream()

    return NextResponse.json({ data: {
      ...account,
      creditLimit: Number(account.creditLimit),
      currentBalance: Number(account.currentBalance),
    } }, { status: 201 })
  } catch (error) {
    console.error('Failed to create house account:', error)
    return NextResponse.json(
      { error: 'Failed to create house account' },
      { status: 500 }
    )
  }
})

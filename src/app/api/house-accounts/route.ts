import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { created, err, ok } from '@/lib/api-response'

// ── Zod schema for POST /api/house-accounts ─────────────────────────
const CreateHouseAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required').max(200),
  contactName: z.string().max(200).optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  creditLimit: z.number().nonnegative().optional(),
  paymentTerms: z.number().int().positive().optional(),
  billingCycle: z.enum(['monthly', 'weekly', 'bi-weekly']).optional(),
  taxExempt: z.boolean().optional(),
  taxId: z.string().max(50).optional().nullable(),
  customerId: z.string().min(1).optional().nullable(),
  locationId: z.string().min(1).optional(),
  requestingEmployeeId: z.string().min(1).optional(),
}).passthrough()

// GET - List house accounts (no admin perm needed — read-only POS query)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId') || await getLocationId()
    const status = sp.get('status')
    const search = sp.get('search')

    if (!locationId) return err('locationId required')

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

    return ok(accounts.map(account => ({
      ...account,
      creditLimit: Number(account.creditLimit),
      currentBalance: Number(account.currentBalance),
    })))
  } catch (error) {
    console.error('Failed to fetch house accounts:', error)
    return err('Failed to fetch house accounts', 500)
  }
})

// POST - Create a new house account
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const parseResult = CreateHouseAccountSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

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

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.CUSTOMERS_HOUSE_ACCOUNTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Check for duplicate name at location
    const existing = await db.houseAccount.findUnique({
      where: {
        locationId_name: { locationId, name }
      }
    })

    if (existing) {
      return err('An account with this name already exists')
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

    return created({
      ...account,
      creditLimit: Number(account.creditLimit),
      currentBalance: Number(account.currentBalance),
    })
  } catch (error) {
    console.error('Failed to create house account:', error)
    return err('Failed to create house account', 500)
  }
})

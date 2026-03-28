import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get single vendor
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const vendor = await db.vendor.findUnique({
      where: { id },
      include: {
        defaultForItems: {
          where: { deletedAt: null },
          select: { id: true, name: true, category: true },
        },
        invoices: {
          take: 10,
          orderBy: { invoiceDate: 'desc' },
          select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true },
        },
      },
    })

    if (!vendor || vendor.deletedAt) {
      return notFound('Vendor not found')
    }

    return ok({ vendor })
  } catch (error) {
    console.error('Get vendor error:', error)
    return err('Failed to fetch vendor', 500)
  }
})

// PUT - Update vendor
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.vendor.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Vendor not found')
    }

    const updateData: Record<string, unknown> = {}
    const allowedFields = ['name', 'accountNum', 'phone', 'email', 'address', 'notes', 'paymentTerms', 'isActive']

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const vendor = await db.vendor.update({
      where: { id },
      data: updateData,
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ vendor })
  } catch (error) {
    console.error('Update vendor error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return err('Vendor with this name already exists')
    }
    return err('Failed to update vendor', 500)
  }
}))

// DELETE - Soft delete vendor
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.vendor.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return notFound('Vendor not found')
    }

    await db.vendor.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'inventory', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Delete vendor error:', error)
    return err('Failed to delete vendor', 500)
  }
}))

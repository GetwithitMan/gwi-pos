import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { vendor } })
  } catch (error) {
    console.error('Get vendor error:', error)
    return NextResponse.json({ error: 'Failed to fetch vendor' }, { status: 500 })
  }
})

// PUT - Update vendor
export const PUT = withVenue(async function PUT(
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
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
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

    return NextResponse.json({ data: { vendor } })
  } catch (error) {
    console.error('Update vendor error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Vendor with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
  }
})

// DELETE - Soft delete vendor
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.vendor.findUnique({
      where: { id },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    await db.vendor.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Delete vendor error:', error)
    return NextResponse.json({ error: 'Failed to delete vendor' }, { status: 500 })
  }
})

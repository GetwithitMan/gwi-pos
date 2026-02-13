import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { generateFakeTransactionId, calculatePreAuthExpiration } from '@/lib/payment'
import { withVenue } from '@/lib/with-venue'

// GET - Get tab details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const tab = await db.order.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          include: {
            menuItem: {
              select: { id: true, name: true },
            },
            modifiers: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        payments: {
          orderBy: { processedAt: 'asc' },
        },
        location: true,
      },
    })

    if (!tab) {
      return NextResponse.json(
        { error: 'Tab not found' },
        { status: 404 }
      )
    }

    if (tab.orderType !== 'bar_tab') {
      return NextResponse.json(
        { error: 'Order is not a bar tab' },
        { status: 400 }
      )
    }

    const paidAmount = tab.payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    return NextResponse.json({
      id: tab.id,
      tabName: tab.tabName || `Tab #${tab.orderNumber}`,
      orderNumber: tab.orderNumber,
      status: tab.status,
      employee: {
        id: tab.employee.id,
        name: tab.employee.displayName || `${tab.employee.firstName} ${tab.employee.lastName}`,
      },
      items: tab.items.map(item => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
        modifiers: item.modifiers.map(mod => ({
          id: mod.id,
          name: mod.name,
          price: Number(mod.price),
          preModifier: mod.preModifier,
        })),
        itemTotal: Number(item.itemTotal),
        createdAt: item.createdAt.toISOString(),
      })),
      subtotal: Number(tab.subtotal),
      discountTotal: Number(tab.discountTotal),
      taxTotal: Number(tab.taxTotal),
      tipTotal: Number(tab.tipTotal),
      total: Number(tab.total),
      // Pre-auth info
      hasPreAuth: !!tab.preAuthId,
      preAuth: tab.preAuthId ? {
        id: tab.preAuthId,
        cardBrand: tab.preAuthCardBrand,
        last4: tab.preAuthLast4,
        amount: tab.preAuthAmount ? Number(tab.preAuthAmount) : null,
        expiresAt: tab.preAuthExpiresAt?.toISOString(),
        isExpired: tab.preAuthExpiresAt ? tab.preAuthExpiresAt < new Date() : false,
      } : null,
      // Payment status
      paidAmount,
      remainingBalance: Math.max(0, Number(tab.total) - paidAmount),
      isFullyPaid: paidAmount >= Number(tab.total) - 0.01,
      payments: tab.payments.map(p => ({
        id: p.id,
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        status: p.status,
        processedAt: p.processedAt.toISOString(),
      })),
      openedAt: tab.openedAt.toISOString(),
      paidAt: tab.paidAt?.toISOString() || null,
    })
  } catch (error) {
    console.error('Failed to fetch tab:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tab' },
      { status: 500 }
    )
  }
})

// PUT - Update tab (name, pre-auth)
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { tabName, preAuth, releasePreAuth } = body as {
      tabName?: string
      preAuth?: {
        cardBrand: string
        cardLast4: string
        amount?: number
      }
      releasePreAuth?: boolean
    }

    const tab = await db.order.findUnique({
      where: { id },
      include: { location: true },
    })

    if (!tab) {
      return NextResponse.json(
        { error: 'Tab not found' },
        { status: 404 }
      )
    }

    if (tab.orderType !== 'bar_tab') {
      return NextResponse.json(
        { error: 'Order is not a bar tab' },
        { status: 400 }
      )
    }

    if (tab.status === 'paid' || tab.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot update a closed tab' },
        { status: 400 }
      )
    }

    const settings = parseSettings(tab.location.settings)
    const updateData: Record<string, unknown> = {}

    // Update tab name
    if (tabName !== undefined) {
      updateData.tabName = tabName || null
    }

    // Release pre-auth
    if (releasePreAuth) {
      updateData.preAuthId = null
      updateData.preAuthAmount = null
      updateData.preAuthLast4 = null
      updateData.preAuthCardBrand = null
      updateData.preAuthExpiresAt = null
    }
    // Add/update pre-auth
    else if (preAuth && preAuth.cardLast4) {
      if (!/^\d{4}$/.test(preAuth.cardLast4)) {
        return NextResponse.json(
          { error: 'Invalid card last 4 digits' },
          { status: 400 }
        )
      }

      updateData.preAuthId = generateFakeTransactionId()
      updateData.preAuthAmount = preAuth.amount || settings.payments.defaultPreAuthAmount
      updateData.preAuthLast4 = preAuth.cardLast4
      updateData.preAuthCardBrand = preAuth.cardBrand || 'visa'
      updateData.preAuthExpiresAt = calculatePreAuthExpiration(settings.payments.preAuthExpirationDays)
    }

    const updated = await db.order.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      },
    })

    return NextResponse.json({
      id: updated.id,
      tabName: updated.tabName || `Tab #${updated.orderNumber}`,
      orderNumber: updated.orderNumber,
      status: updated.status,
      employee: {
        id: updated.employee.id,
        name: updated.employee.displayName || `${updated.employee.firstName} ${updated.employee.lastName}`,
      },
      hasPreAuth: !!updated.preAuthId,
      preAuth: updated.preAuthId ? {
        cardBrand: updated.preAuthCardBrand,
        last4: updated.preAuthLast4,
        amount: updated.preAuthAmount ? Number(updated.preAuthAmount) : null,
        expiresAt: updated.preAuthExpiresAt?.toISOString(),
      } : null,
    })
  } catch (error) {
    console.error('Failed to update tab:', error)
    return NextResponse.json(
      { error: 'Failed to update tab' },
      { status: 500 }
    )
  }
})

// DELETE - Void/cancel tab (only if no items)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const tab = await db.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
      },
    })

    if (!tab) {
      return NextResponse.json(
        { error: 'Tab not found' },
        { status: 404 }
      )
    }

    if (tab.orderType !== 'bar_tab') {
      return NextResponse.json(
        { error: 'Order is not a bar tab' },
        { status: 400 }
      )
    }

    // Can only delete if no items and no payments
    if (tab.items.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete tab with items. Void the tab instead.' },
        { status: 400 }
      )
    }

    if (tab.payments.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete tab with payments' },
        { status: 400 }
      )
    }

    await db.order.update({ where: { id }, data: { deletedAt: new Date() } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete tab:', error)
    return NextResponse.json(
      { error: 'Failed to delete tab' },
      { status: 500 }
    )
  }
})

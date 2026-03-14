import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { buildSpiritTiersFromItem } from '@/lib/spirit-tiers'
import { authenticateTerminal } from '@/lib/terminal-auth'

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const { searchParams } = new URL(request.url)
  const sinceParam = searchParams.get('since')
  if (!sinceParam) {
    return NextResponse.json({ error: 'since parameter required' }, { status: 400 })
  }
  const since = new Date(Number(sinceParam))
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid since timestamp' }, { status: 400 })
  }

  const [menuItems, categories, employees, tables, orderTypes, orders, pricingOptionGroups] = await Promise.all([
    db.menuItem.findMany({
      where: { locationId, updatedAt: { gt: since } },
      include: {
        ownedModifierGroups: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            modifiers: {
              where: { deletedAt: null, isActive: true },
              orderBy: { sortOrder: 'asc' },
              include: {
                linkedBottleProduct: {
                  select: { id: true, name: true, tier: true, pourCost: true },
                },
              },
            },
          },
        },
      },
    }),
    db.category.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.employee.findMany({ where: { locationId, updatedAt: { gt: since } }, include: { role: { select: { id: true, name: true, permissions: true } } } }),
    db.table.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.orderType.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.order.findMany({ where: { locationId, updatedAt: { gt: since }, status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] }, deletedAt: null }, include: { items: { include: { modifiers: true, itemDiscounts: true } }, payments: true }, take: 100, orderBy: { updatedAt: 'desc' } }),
    db.pricingOptionGroup.findMany({ where: { locationId, updatedAt: { gt: since }, deletedAt: null }, include: { options: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } } }),
  ])

  // Convert Decimal fields to numbers for Android clients
  const mappedMenuItems = menuItems.map(item => ({
    ...item,
    price: item.price != null ? Number(item.price) : null,
    cost: item.cost != null ? Number(item.cost) : null,
    pricePerWeightUnit: item.pricePerWeightUnit != null ? Number(item.pricePerWeightUnit) : null,
    spiritTiers: buildSpiritTiersFromItem(item),
  }))

  const mappedOrders = orders.map(order => ({
    ...order,
    subtotal: Number(order.subtotal ?? 0),
    taxTotal: Number(order.taxTotal ?? 0),
    tipTotal: Number(order.tipTotal ?? 0),
    discountTotal: Number(order.discountTotal ?? 0),
    total: Number(order.total ?? 0),
    paidAmount: order.payments.reduce((sum, p) => sum + Number(p.totalAmount ?? 0), 0),
    items: order.items.map(item => ({
      ...item,
      price: Number(item.price ?? 0),
      itemTotal: Number(item.itemTotal ?? 0),
      costAtSale: item.costAtSale != null ? Number(item.costAtSale) : null,
      weight: item.weight != null ? Number(item.weight) : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      grossWeight: item.grossWeight != null ? Number(item.grossWeight) : null,
      tareWeight: item.tareWeight != null ? Number(item.tareWeight) : null,
      modifiers: item.modifiers.map(mod => ({
        ...mod,
        price: Number(mod.price ?? 0),
      })),
      itemDiscounts: (item.itemDiscounts ?? []).map(d => ({
        ...d,
        amount: Number(d.amount ?? 0),
        percent: d.percent != null ? Number(d.percent) : null,
      })),
    })),
    payments: (order.payments ?? []).map(p => ({
      ...p,
      amount: Number(p.amount ?? 0),
      tipAmount: Number(p.tipAmount ?? 0),
      totalAmount: Number(p.totalAmount ?? 0),
      paymentMethod: p.paymentMethod ?? 'unknown',
    })),
  }))

  const mappedPricingOptionGroups = pricingOptionGroups.map(group => ({
    ...group,
    options: group.options.map(opt => ({
      ...opt,
      price: opt.price != null ? Number(opt.price) : null,
      priceCC: opt.priceCC != null ? Number(opt.priceCC) : null,
    })),
  }))

  return NextResponse.json({
    data: { menuItems: mappedMenuItems, categories, employees, tables, orderTypes, orders: mappedOrders, pricingOptionGroups: mappedPricingOptionGroups, syncVersion: Date.now(), hasMore: orders.length >= 100 },
  })
})

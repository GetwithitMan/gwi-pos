import { NextRequest } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { buildSpiritTiersFromItem } from '@/lib/spirit-tiers'
import { authenticateTerminal } from '@/lib/terminal-auth'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const { searchParams } = new URL(request.url)
  const sinceParam = searchParams.get('since')
  if (!sinceParam) {
    return err('since parameter required')
  }
  const since = new Date(Number(sinceParam))
  if (isNaN(since.getTime())) {
    return err('Invalid since timestamp')
  }

  const [menuItems, categories, employees, tables, orderTypes, orders, pricingOptionGroups, sharedModifierGroups, deltaModifierGroups] = await Promise.all([
    adminDb.menuItem.findMany({
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
    adminDb.employee.findMany({ where: { locationId, updatedAt: { gt: since } }, include: { role: { select: { id: true, name: true, permissions: true } } } }),
    db.table.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    db.orderType.findMany({ where: { locationId, updatedAt: { gt: since } } }),
    adminDb.order.findMany({ where: { locationId, updatedAt: { gt: since }, status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] }, deletedAt: null }, include: { items: { include: { modifiers: true, itemDiscounts: true } }, payments: true }, take: 100, orderBy: { updatedAt: 'desc' } }),
    db.pricingOptionGroup.findMany({ where: { locationId, updatedAt: { gt: since }, deletedAt: null }, include: { options: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } } }),
    // Spirit-only global modifier groups (menuItemId: null, isSpiritGroup) — for upsell
    db.modifierGroup.findMany({
      where: { locationId, menuItemId: null, isSpiritGroup: true, deletedAt: null, updatedAt: { gt: since } },
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
      orderBy: { sortOrder: 'asc' },
    }),
    // All modifier groups updated since last sync (covers mid-shift price/config changes)
    db.modifierGroup.findMany({
      where: { locationId, deletedAt: null, updatedAt: { gt: since } },
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
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  // Map modifier group decimal fields
  const mappedModifierGroups = deltaModifierGroups.map(group => ({
    ...group,
    modifiers: group.modifiers.map(mod => ({
      ...mod,
      price: mod.price != null ? Number(mod.price) : null,
      extraPrice: mod.extraPrice != null ? Number(mod.extraPrice) : null,
      cost: mod.cost != null ? Number(mod.cost) : null,
    })),
  }))

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
    inclusiveTaxRate: Number(order.inclusiveTaxRate) || 0,
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
        isNoneSelection: mod.isNoneSelection ?? false,
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

  return ok({ menuItems: mappedMenuItems, categories, employees, tables, orderTypes, orders: mappedOrders, pricingOptionGroups: mappedPricingOptionGroups, sharedModifierGroups, modifierGroups: mappedModifierGroups, syncVersion: Date.now(), hasMore: orders.length >= 100 })
}))

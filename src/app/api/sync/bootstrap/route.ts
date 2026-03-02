import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

async function authenticateTerminal(request: NextRequest): Promise<{ terminal: { id: string; locationId: string; name: string }; error?: never } | { terminal?: never; error: NextResponse }> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return { error: NextResponse.json({ error: 'Authorization required' }, { status: 401 }) }
  }
  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { id: true, locationId: true, name: true },
  })
  if (!terminal) {
    return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
  }
  return { terminal }
}

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const [categories, employees, tables, orderTypes, location, paymentReaders, printers, sections, floorPlanElements] = await Promise.all([
    db.category.findMany({
      where: { locationId, deletedAt: null },
      include: {
        menuItems: {
          where: { deletedAt: null, isActive: true },
          include: {
            ownedModifierGroups: {
              where: { deletedAt: null },
              include: { modifiers: { where: { deletedAt: null } } },
              orderBy: { sortOrder: 'asc' },
            },
            pricingOptionGroups: {
              where: { deletedAt: null },
              include: { options: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
              orderBy: { sortOrder: 'asc' },
            },
            ingredients: {
              where: { deletedAt: null },
              include: {
                ingredient: {
                  select: { id: true, name: true, allowNo: true, allowLite: true, allowExtra: true, allowOnSide: true, extraPrice: true },
                },
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    db.employee.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      include: { role: { select: { id: true, name: true, permissions: true } } },
    }),
    db.table.findMany({ where: { locationId, deletedAt: null } }),
    db.orderType.findMany({ where: { locationId, deletedAt: null } }),
    db.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, settings: true, timezone: true },
    }),
    db.paymentReader.findMany({ where: { locationId, deletedAt: null } }),
    db.printer.findMany({ where: { locationId, deletedAt: null } }),
    db.section.findMany({ where: { locationId, deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
    db.floorPlanElement.findMany({
      where: { locationId, deletedAt: null, isVisible: true, elementType: 'entertainment' },
      select: {
        id: true, name: true, elementType: true, visualType: true,
        linkedMenuItemId: true, sectionId: true,
        posX: true, posY: true, width: true, height: true, rotation: true,
        fillColor: true, opacity: true, status: true, currentOrderId: true,
      },
    }),
  ])

  const settings = (location?.settings || {}) as Record<string, unknown>
  const taxRate = ((settings?.tax as Record<string, unknown>)?.defaultRate as number ?? 0) / 100

  // Convert Decimal fields to numbers for Android clients
  const mappedCategories = categories.map(cat => ({
    ...cat,
    menuItems: cat.menuItems.map(item => ({
      ...item,
      price: item.price != null ? Number(item.price) : null,
      cost: item.cost != null ? Number(item.cost) : null,
      pricePerWeightUnit: item.pricePerWeightUnit != null ? Number(item.pricePerWeightUnit) : null,
      pricingOptionGroups: (item as any).pricingOptionGroups?.map((group: any) => ({
        ...group,
        options: group.options?.map((opt: any) => ({
          ...opt,
          price: opt.price != null ? Number(opt.price) : null,
          priceCC: opt.priceCC != null ? Number(opt.priceCC) : null,
        })),
      })),
      ingredientLinks: (item as any).ingredients?.map((link: any) => ({
        id: link.id,
        ingredientId: link.ingredientId,
        name: link.ingredient.name,
        isIncluded: link.isIncluded,
        // Per-item overrides; fall back to ingredient defaults
        allowNo: link.allowNo ?? link.ingredient.allowNo,
        allowLite: link.allowLite ?? link.ingredient.allowLite,
        allowExtra: link.allowExtra ?? link.ingredient.allowExtra,
        allowOnSide: link.allowOnSide ?? link.ingredient.allowOnSide,
        extraPrice: link.extraPrice != null ? Number(link.extraPrice) : (link.ingredient.extraPrice != null ? Number(link.ingredient.extraPrice) : null),
        sortOrder: link.sortOrder,
      })) ?? [],
    })),
  }))

  return NextResponse.json({
    data: {
      menu: { categories: mappedCategories },
      employees: employees.map(e => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, displayName: e.displayName, pin: e.pin, locationId: e.locationId, role: e.role, posLayoutSettings: e.posLayoutSettings ?? null })),
      tables,
      orderTypes,
      taxRate,
      locationSettings: settings,
      paymentReaders,
      printers,
      sections: sections.map(s => ({ id: s.id, name: s.name, color: s.color, sortOrder: s.sortOrder })),
      floorPlanElements,
      syncVersion: Date.now(),
    },
  })
})

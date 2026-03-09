import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { buildSpiritTiersFromItem, normalizeModifier } from '@/lib/spirit-tiers'
import { parseSettings } from '@/lib/settings'
import { authenticateTerminal } from '@/lib/terminal-auth'

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const [categories, employees, tables, orderTypes, location, paymentReaders, printers, sections, floorPlanElements, cfdSettings, taxRules] = await Promise.all([
    db.category.findMany({
      where: { locationId, deletedAt: null },
      include: {
        menuItems: {
          where: { deletedAt: null, isActive: true },
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
    db.cfdSettings.findFirst({ where: { locationId, deletedAt: null } }),
    db.taxRule.findMany({
      where: { locationId, isActive: true, deletedAt: null, isInclusive: false },
      select: { rate: true },
    }),
  ])

  // Collect child modifier groups via BFS (supports unlimited nesting depth).
  // ownedModifierGroups only carries top-level groups; child groups are referenced
  // by Modifier.childModifierGroupId and must be fetched separately so Android
  // can cache them in Room for on-demand lookup.
  const fetchedGroupIds = new Set<string>(
    categories.flatMap(cat =>
      cat.menuItems.flatMap(item =>
        (item as any).ownedModifierGroups?.map((g: any) => g.id as string) ?? []
      )
    )
  )
  let wave: string[] = []
  categories.forEach(cat => {
    cat.menuItems.forEach(item => {
      ;(item as any).ownedModifierGroups?.forEach((g: any) => {
        g.modifiers?.forEach((m: any) => {
          if (m.childModifierGroupId && !fetchedGroupIds.has(m.childModifierGroupId)) {
            wave.push(m.childModifierGroupId)
            fetchedGroupIds.add(m.childModifierGroupId)
          }
        })
      })
    })
  })
  const childModifierGroups: any[] = []
  while (wave.length > 0) {
    const groups = await db.modifierGroup.findMany({
      where: { id: { in: wave }, deletedAt: null },
      include: { modifiers: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    })
    const nextWave: string[] = []
    for (const g of groups) {
      // Normalize Decimal price fields on each modifier
      const mappedMods = g.modifiers.map((m: any) => normalizeModifier(m))
      childModifierGroups.push({ ...g, modifiers: mappedMods })
      g.modifiers.forEach((m: any) => {
        if (m.childModifierGroupId && !fetchedGroupIds.has(m.childModifierGroupId)) {
          nextWave.push(m.childModifierGroupId)
          fetchedGroupIds.add(m.childModifierGroupId)
        }
      })
    }
    wave = nextWave
  }

  // parseSettings applies mergeWithDefaults — this corrects dualPricing.enabled from the stored
  // raw JSON (which may have legacy enabled:false) and derives it from cashDiscountPercent.
  const settings = parseSettings(location?.settings) as unknown as Record<string, unknown>
  // Compute effective tax rate from non-inclusive TaxRule records (same logic as GET /api/settings).
  // Rates are stored as decimals (e.g. 0.07 for 7%). Sum and send as decimal fraction to Android.
  const effectiveTaxRate = taxRules.reduce((sum, r) => sum + Number(r.rate), 0)
  const taxRate = effectiveTaxRate > 0 ? effectiveTaxRate : ((settings?.tax as Record<string, unknown>)?.defaultRate as number ?? 0) / 100

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
      spiritTiers: buildSpiritTiersFromItem(item),
      hasOtherModifiers: (item as any).ownedModifierGroups?.filter((mg: any) => !mg.isSpiritGroup).length > 0,
    })),
  }))

  return NextResponse.json({
    data: {
      menu: { categories: mappedCategories, childModifierGroups },
      // PIN hash intentionally excluded — Android must use POST /api/auth/verify-pin instead of local bcrypt compare.
      // Coordinated removal: update Android before deploying this change to production.
      employees: employees.map(e => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, displayName: e.displayName, locationId: e.locationId, role: e.role, posLayoutSettings: e.posLayoutSettings ?? null })),
      tables,
      orderTypes,
      taxRate,
      locationSettings: settings,
      paymentReaders,
      printers,
      sections: sections.map(s => ({ id: s.id, name: s.name, color: s.color, sortOrder: s.sortOrder })),
      floorPlanElements,
      syncVersion: Date.now(),
      terminalConfig: {
        terminalId: auth.terminal.id,
        locationId: auth.terminal.locationId,
        cfdTerminalId: auth.terminal.cfdTerminalId ?? null,
        defaultMode: auth.terminal.defaultMode ?? null,
        receiptPrinterId: auth.terminal.receiptPrinterId ?? null,
        kitchenPrinterId: auth.terminal.kitchenPrinterId ?? null,
        barPrinterId: auth.terminal.barPrinterId ?? null,
        isTestMode: (() => {
          const p = (settings as any)?.payments
          return p?.datacapEnvironment ? p.datacapEnvironment === 'cert' : (p?.testMode ?? false)
        })(),
      },
      cfdSettings: cfdSettings ? {
        tipMode: cfdSettings.tipMode,
        tipStyle: cfdSettings.tipStyle,
        tipOptions: cfdSettings.tipOptions,
        tipShowNoTip: cfdSettings.tipShowNoTip,
        signatureEnabled: cfdSettings.signatureEnabled,
        signatureThresholdCents: cfdSettings.signatureThresholdCents,
        receiptEmailEnabled: cfdSettings.receiptEmailEnabled,
        receiptSmsEnabled: cfdSettings.receiptSmsEnabled,
        receiptPrintEnabled: cfdSettings.receiptPrintEnabled,
        receiptTimeoutSeconds: cfdSettings.receiptTimeoutSeconds,
        tabMode: cfdSettings.tabMode,
        tabPreAuthAmountCents: cfdSettings.tabPreAuthAmountCents,
        idlePromoEnabled: cfdSettings.idlePromoEnabled,
        idleWelcomeText: cfdSettings.idleWelcomeText,
      } : null,
    },
  })
})

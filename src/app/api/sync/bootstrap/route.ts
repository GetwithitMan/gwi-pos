import { NextRequest } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { buildSpiritTiersFromItem, normalizeModifier } from '@/lib/spirit-tiers'
import { parseSettings } from '@/lib/settings'
import { authenticateTerminal } from '@/lib/terminal-auth'
import { notFound, ok } from '@/lib/api-response'

// ─── Types ────────────────────────────────────────────────────────────────────
type BootstrapSection = 'menu' | 'employees' | 'orders' | 'settings' | 'operational'

interface BootstrapOptions {
  sections: Set<BootstrapSection> | null  // null = all sections
  menuCursor: string | null
  ordersCursor: string | null
  menuPageSize: number
  ordersPageSize: number
}

// ─── Sync bootstrap cache ─────────────────────────────────────────────────────
// Caches the heavy bootstrap query for 5s to prevent redundant DB hits when
// multiple Android devices boot simultaneously.
const syncBootstrapCache = new Map<string, { data: any; expiry: number }>()
// 5s TTL balances freshness with DB load — reduced from 15s to ensure
// deleted/updated menu items propagate within one business-meaningful window
const SYNC_BOOTSTRAP_TTL = 5_000

// Inflight promise coalescing: prevents bootstrap stampede where 10 concurrent
// requests before cache populates would fire 160 queries on a 25-connection pool.
// Same pattern as inflightSettings in location-cache.ts.
const inflightBootstrap = new Map<string, Promise<any>>()

// Allow up to 120s for bootstrap on Vercel (Neon queries can be slow on cold starts)
export const maxDuration = 120

// Default page sizes
const DEFAULT_MENU_PAGE_SIZE = 200
const DEFAULT_ORDERS_PAGE_SIZE = 100

// ─── Parse query params ───────────────────────────────────────────────────────
function parseBootstrapOptions(request: NextRequest): BootstrapOptions {
  const url = request.nextUrl
  const sectionsParam = url.searchParams.get('sections')
  const menuCursor = url.searchParams.get('menuCursor')
  const ordersCursor = url.searchParams.get('ordersCursor')

  let sections: Set<BootstrapSection> | null = null
  if (sectionsParam) {
    const valid: BootstrapSection[] = ['menu', 'employees', 'orders', 'settings', 'operational']
    const requested = sectionsParam.split(',').filter(s => valid.includes(s as BootstrapSection)) as BootstrapSection[]
    if (requested.length > 0) sections = new Set(requested)
  }

  return {
    sections,
    menuCursor,
    ordersCursor,
    menuPageSize: DEFAULT_MENU_PAGE_SIZE,
    ordersPageSize: DEFAULT_ORDERS_PAGE_SIZE,
  }
}

function shouldFetch(opts: BootstrapOptions, section: BootstrapSection): boolean {
  return opts.sections === null || opts.sections.has(section)
}

// ─── Topping enrichment helpers ───────────────────────────────────────────────
const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

function buildToppingCategoryMap(pizzaToppings: Array<{ name: string; category: string }>, locationId: string) {
  const toppingCategoryMap = new Map<string, string>()
  if (pizzaToppings.length > 0) {
    const seenNames = new Map<string, string>()
    for (const t of pizzaToppings) {
      const norm = normalizeName(t.name)
      if (seenNames.has(norm) && seenNames.get(norm) !== t.category) {
        console.warn(`[bootstrap] duplicate topping name '${t.name}' (norm: '${norm}') categories: '${seenNames.get(norm)}' vs '${t.category}' locationId=${locationId}`)
      }
      seenNames.set(norm, t.category)
      toppingCategoryMap.set(norm, t.category)
    }
  }
  return toppingCategoryMap
}

function makeEnrichModifier(toppingCategoryMap: Map<string, string>) {
  return (m: any) => normalizeModifier({
    ...m,
    toppingCategory: toppingCategoryMap.get(normalizeName(m.name ?? '')) ?? null,
  })
}

// ─── Domain: Menu ─────────────────────────────────────────────────────────────
async function fetchMenuData(
  locationId: string,
  opts: BootstrapOptions,
) {
  // Fetch categories with menu items, modifier groups, pricing options, ingredients
  // Use select to limit fields transferred over the wire
  const cursorClause = opts.menuCursor ? { cursor: { id: opts.menuCursor }, skip: 1 } : {}

  const [categories, pizzaToppings] = await Promise.all([
    db.category.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true, name: true, sortOrder: true, isActive: true, categoryType: true,
        color: true, locationId: true, deletedAt: true,
        createdAt: true, updatedAt: true,
        menuItems: {
          where: { deletedAt: null, isActive: true },
          select: {
            id: true, name: true, price: true, cost: true, sortOrder: true,
            isActive: true, itemType: true, categoryId: true, locationId: true,
            pourSizes: true, pricePerWeightUnit: true, soldByWeight: true,
            weightUnit: true, defaultPourSize: true, description: true,
            deletedAt: true, createdAt: true, updatedAt: true,
            ownedModifierGroups: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true, name: true, minSelections: true, maxSelections: true,
                sortOrder: true, isSpiritGroup: true, locationId: true,
                menuItemId: true, deletedAt: true, createdAt: true, updatedAt: true,
                allowStacking: true, isRequired: true,
                modifiers: {
                  where: { deletedAt: null, isActive: true },
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    id: true, name: true, price: true, sortOrder: true,
                    isActive: true, modifierGroupId: true, locationId: true,
                    linkedMenuItemId: true, linkedBottleProductId: true,
                    childModifierGroupId: true, spiritTier: true,
                    extraPrice: true, isDefault: true, deletedAt: true,
                    createdAt: true, updatedAt: true,
                    priceType: true,
                    linkedBottleProduct: {
                      select: { id: true, name: true, tier: true, pourCost: true },
                    },
                  },
                },
              },
            },
            pricingOptionGroups: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true, name: true, sortOrder: true, menuItemId: true,
                deletedAt: true, createdAt: true, updatedAt: true,
                options: {
                  where: { deletedAt: null },
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    id: true, label: true, price: true, priceCC: true,
                    sortOrder: true, groupId: true,
                    deletedAt: true, createdAt: true, updatedAt: true,
                  },
                },
              },
            },
            ingredients: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true, ingredientId: true, isIncluded: true, sortOrder: true,
                allowNo: true, allowLite: true, allowExtra: true, allowOnSide: true,
                extraPrice: true,
                ingredient: {
                  select: {
                    id: true, name: true, allowNo: true, allowLite: true,
                    allowExtra: true, allowOnSide: true, extraPrice: true,
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
          take: opts.menuCursor ? opts.menuPageSize : undefined,
          ...cursorClause,
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    // Pizza toppings: category enrichment for Android topping filter tabs
    db.pizzaTopping.findMany({
      where: { locationId, isActive: true, deletedAt: null },
      select: { name: true, category: true },
    }),
  ])

  const toppingCategoryMap = buildToppingCategoryMap(pizzaToppings, locationId)
  const enrichModifier = makeEnrichModifier(toppingCategoryMap)

  // Fetch spirit-only global modifier groups (menuItemId IS NULL, isSpiritGroup) —
  // these are spirit upgrade groups created via the liquor builder for upsell.
  // Regular shared modifier groups are migrated to templates and excluded here.
  const sharedModifierGroups = await db.modifierGroup.findMany({
    where: { locationId, menuItemId: null, isSpiritGroup: true, deletedAt: null },
    select: {
      id: true, name: true, minSelections: true, maxSelections: true,
      sortOrder: true, isSpiritGroup: true, locationId: true,
      menuItemId: true, deletedAt: true, createdAt: true, updatedAt: true,
      allowStacking: true, isRequired: true,
      modifiers: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true, name: true, price: true, sortOrder: true,
          isActive: true, modifierGroupId: true, locationId: true,
          linkedMenuItemId: true, linkedBottleProductId: true,
          childModifierGroupId: true, spiritTier: true,
          extraPrice: true, isDefault: true, deletedAt: true,
          createdAt: true, updatedAt: true,
          priceType: true,
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  // ─── BFS child modifier groups ──────────────────────────────────────────────
  // Collect child modifier groups via BFS (supports unlimited nesting depth).
  // ownedModifierGroups only carries top-level groups; child groups are referenced
  // by Modifier.childModifierGroupId and must be fetched separately so Android
  // can cache them in Room for on-demand lookup.
  const fetchedGroupIds = new Set<string>(
    categories.flatMap(cat =>
      cat.menuItems.flatMap(item =>
        item.ownedModifierGroups?.map((g: any) => g.id as string) ?? []
      )
    )
  )
  let wave: string[] = []
  categories.forEach(cat => {
    cat.menuItems.forEach(item => {
      item.ownedModifierGroups?.forEach((g: any) => {
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
      select: {
        id: true, name: true, minSelections: true, maxSelections: true,
        sortOrder: true, isSpiritGroup: true, locationId: true,
        menuItemId: true, deletedAt: true, createdAt: true, updatedAt: true,
        allowStacking: true, isRequired: true,
        modifiers: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true, name: true, price: true, sortOrder: true,
            isActive: true, modifierGroupId: true, locationId: true,
            linkedMenuItemId: true, linkedBottleProductId: true,
            childModifierGroupId: true, spiritTier: true,
            extraPrice: true, isDefault: true, deletedAt: true,
            createdAt: true, updatedAt: true,
            priceType: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })
    const nextWave: string[] = []
    for (const g of groups) {
      const mappedMods = g.modifiers.map((m: any) => enrichModifier(m))
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
        allowNo: link.allowNo ?? link.ingredient.allowNo,
        allowLite: link.allowLite ?? link.ingredient.allowLite,
        allowExtra: link.allowExtra ?? link.ingredient.allowExtra,
        allowOnSide: link.allowOnSide ?? link.ingredient.allowOnSide,
        extraPrice: link.extraPrice != null ? Number(link.extraPrice) : (link.ingredient.extraPrice != null ? Number(link.ingredient.extraPrice) : null),
        sortOrder: link.sortOrder,
      })) ?? [],
      spiritTiers: buildSpiritTiersFromItem(item),
      hasOtherModifiers: (item as any).ownedModifierGroups?.filter((mg: any) => !mg.isSpiritGroup).length > 0,
      ownedModifierGroups: (item as any).ownedModifierGroups?.map((g: any) => ({
        ...g,
        modifiers: g.modifiers?.map((m: any) => enrichModifier(m)) ?? [],
      })) ?? [],
    })),
  }))

  // Determine hasMore for paginated menu: if any category has exactly menuPageSize items
  // and a cursor was provided, there may be more items
  const hasMoreMenu = opts.menuCursor
    ? categories.some(cat => cat.menuItems.length >= opts.menuPageSize)
    : false

  return {
    menu: {
      categories: mappedCategories,
      childModifierGroups: [
        ...childModifierGroups,
        ...sharedModifierGroups.map(g => ({
          ...g,
          modifiers: g.modifiers.map((m: any) => enrichModifier(m)),
        })),
      ],
      hasMore: hasMoreMenu,
    },
    // Return raw categories for tax-inclusive derivation
    _rawCategories: categories,
  }
}

// ─── Domain: Employees ────────────────────────────────────────────────────────
async function fetchEmployeeData(locationId: string) {
  const employees = await adminDb.employee.findMany({
    where: { locationId, deletedAt: null, isActive: true },
    select: {
      id: true, firstName: true, lastName: true, displayName: true,
      locationId: true, posLayoutSettings: true,
      role: { select: { id: true, name: true, permissions: true } },
    },
  })

  return employees.map(e => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.displayName,
    locationId: e.locationId,
    role: e.role,
    posLayoutSettings: e.posLayoutSettings ?? null,
  }))
}

// ─── Domain: Operational State ────────────────────────────────────────────────
// Tables, order types, sections, floor plan elements
async function fetchOperationalState(locationId: string) {
  const [tables, orderTypes, sections, floorPlanElements] = await Promise.all([
    db.table.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true, name: true, sectionId: true, locationId: true,
        capacity: true, status: true,
        deletedAt: true, createdAt: true, updatedAt: true,
      },
    }),
    db.orderType.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true, name: true, locationId: true, isActive: true,
        sortOrder: true, deletedAt: true, createdAt: true, updatedAt: true,
      },
    }),
    db.section.findMany({
      where: { locationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, name: true, color: true, sortOrder: true,
        assignments: { select: { employeeId: true } },
      },
    }),
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

  return {
    tables,
    orderTypes,
    sections: sections.map(s => ({
      id: s.id,
      name: s.name,
      color: s.color,
      sortOrder: s.sortOrder,
      assignedEmployeeIds: s.assignments.map(a => a.employeeId),
    })),
    floorPlanElements,
  }
}

// ─── Domain: Settings & Config ────────────────────────────────────────────────
// Location settings, tax rules, CFD settings, payment readers, printers,
// discount rules, void reasons, comp reasons
async function fetchSettingsAndConfig(
  locationId: string,
  rawCategories: Array<{ id: string; categoryType: string | null }>,
) {
  const [location, taxRules, cfdSettings, paymentReaders, printers, discountRules, voidReasons, compReasons] = await Promise.all([
    db.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, settings: true, timezone: true },
    }),
    db.taxRule.findMany({
      where: { locationId, isActive: true, deletedAt: null },
      select: {
        id: true, name: true, rate: true, appliesTo: true,
        categoryIds: true, itemIds: true, isInclusive: true,
        priority: true, isCompounded: true, isActive: true,
      },
      orderBy: { priority: 'asc' },
    }),
    db.cfdSettings.findFirst({ where: { locationId, deletedAt: null } }),
    db.paymentReader.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true, name: true, locationId: true, ipAddress: true,
        serialNumber: true, deviceType: true, terminalId: true,
        isActive: true, deletedAt: true, createdAt: true, updatedAt: true,
      },
    }),
    db.printer.findMany({
      where: { locationId, deletedAt: null },
      select: {
        id: true, name: true, locationId: true, printerType: true,
        ipAddress: true, port: true,
        isActive: true, deletedAt: true, createdAt: true, updatedAt: true,
      },
    }),
    db.discountRule.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, displayText: true, description: true,
        discountType: true, triggerConfig: true, discountConfig: true,
        scheduleConfig: true, priority: true, isStackable: true,
        requiresApproval: true, maxPerOrder: true, isActive: true,
        isAutomatic: true, isEmployeeDiscount: true,
      },
    }),
    db.voidReason.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, description: true,
        deductInventory: true, requiresManager: true,
        isActive: true, sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    db.compReason.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, description: true,
        deductInventory: true, requiresManager: true,
        isActive: true, sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  // parseSettings applies mergeWithDefaults — corrects dualPricing.enabled
  const settings = parseSettings(location?.settings) as unknown as Record<string, unknown>

  // ─── Tax-Inclusive Pricing Derivation ──────────────────────────────────────
  const LIQUOR_CATEGORY_TYPES = ['liquor', 'drinks']
  const FOOD_CATEGORY_TYPES = ['food', 'pizza', 'combos']

  const inclusiveTaxRules = taxRules.filter(r => r.isInclusive)
  const nonInclusiveTaxRules = taxRules.filter(r => !r.isInclusive)

  const effectiveTaxRate = nonInclusiveTaxRules.reduce((sum, r) => sum + Number(r.rate), 0)

  const categoryTypeMap = new Map<string, string | null>()
  for (const cat of rawCategories) {
    categoryTypeMap.set(cat.id, cat.categoryType)
  }

  let taxInclusiveLiquor = false
  let taxInclusiveFood = false

  for (const rule of inclusiveTaxRules) {
    if (rule.appliesTo === 'all') {
      taxInclusiveLiquor = true
      taxInclusiveFood = true
      break
    }
    if (rule.appliesTo === 'category' && rule.categoryIds) {
      const ruleCategories = rule.categoryIds as string[]
      for (const catId of ruleCategories) {
        const catType = categoryTypeMap.get(catId)
        if (catType && LIQUOR_CATEGORY_TYPES.includes(catType)) taxInclusiveLiquor = true
        if (catType && FOOD_CATEGORY_TYPES.includes(catType)) taxInclusiveFood = true
      }
    }
  }

  const taxSettings = (settings.tax ?? {}) as Record<string, unknown>
  settings.tax = {
    ...taxSettings,
    taxInclusiveLiquor,
    taxInclusiveFood,
    ...(effectiveTaxRate > 0 ? { defaultRate: effectiveTaxRate * 100 } : {}),
  }

  const inclusiveTaxRate = inclusiveTaxRules.reduce((sum, r) => sum + Number(r.rate), 0)
  const taxRate = ((settings.tax as Record<string, unknown>)?.defaultRate as number ?? 0) / 100

  return {
    location,
    locationSettings: settings,
    taxRate,
    inclusiveTaxRate,
    taxRules: taxRules.map(r => ({
      id: r.id,
      name: r.name,
      rate: Number(r.rate),
      ratePercent: Number(r.rate) * 100,
      appliesTo: r.appliesTo,
      categoryIds: r.categoryIds,
      itemIds: r.itemIds,
      isInclusive: r.isInclusive,
      priority: r.priority,
      isCompounded: r.isCompounded,
      isActive: r.isActive,
    })),
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
    paymentReaders,
    printers,
    discountRules: discountRules.map((r: any) => ({
      id: r.id,
      name: r.name,
      displayText: r.displayText,
      description: r.description,
      discountType: r.discountType,
      triggerConfig: r.triggerConfig,
      discountConfig: r.discountConfig,
      scheduleConfig: r.scheduleConfig,
      priority: r.priority,
      isStackable: r.isStackable,
      requiresApproval: r.requiresApproval,
      maxPerOrder: r.maxPerOrder,
      isActive: r.isActive,
      isAutomatic: r.isAutomatic,
      isEmployeeDiscount: r.isEmployeeDiscount,
    })),
    voidReasons,
    compReasons,
  }
}

// ─── Domain: Open Orders ──────────────────────────────────────────────────────
async function fetchOpenOrders(locationId: string, opts: BootstrapOptions) {
  const openOrders = await adminDb.order.findMany({
    where: {
      locationId,
      status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] },
      deletedAt: null,
    },
    take: opts.ordersPageSize,
    ...(opts.ordersCursor ? { cursor: { id: opts.ordersCursor }, skip: 1 } : {}),
    include: {
      items: {
        where: { deletedAt: null },
        select: {
          id: true, menuItemId: true, name: true, price: true,
          quantity: true, itemTotal: true, specialNotes: true,
          seatNumber: true, courseNumber: true, courseStatus: true,
          isHeld: true, firedAt: true, isCompleted: true, completedAt: true,
          kitchenStatus: true, status: true,
          blockTimeMinutes: true, blockTimeStartedAt: true, blockTimeExpiresAt: true,
          delayMinutes: true, delayStartedAt: true,
          soldByWeight: true, weight: true, weightUnit: true, unitPrice: true,
          isTaxInclusive: true, categoryType: true,
          pricingOptionId: true, pricingOptionLabel: true,
          modifiers: {
            select: {
              id: true, modifierId: true, name: true, price: true,
              depth: true, preModifier: true, isNoneSelection: true,
            },
          },
          ingredientModifications: {
            select: {
              id: true, ingredientId: true, ingredientName: true,
              modificationType: true, priceAdjustment: true,
              swappedToModifierId: true, swappedToModifierName: true,
            },
          },
        },
      },
      payments: {
        where: { deletedAt: null },
        select: {
          id: true, status: true, paymentMethod: true,
          totalAmount: true, tipAmount: true,
        },
      },
      table: { select: { id: true, name: true } },
      employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // ─── lastEventSequence for open orders ──────────────────────────────────────
  const orderIds = openOrders.map((o: any) => o.id)
  const lastEventSeqMap = new Map<string, number>()
  if (orderIds.length > 0) {
    try {
      const snapshots = await adminDb.orderSnapshot.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, lastEventSequence: true },
      })
      for (const snap of snapshots) {
        lastEventSeqMap.set(snap.id, snap.lastEventSequence)
      }
    } catch {
      try {
        const rows = await adminDb.$queryRawUnsafe<Array<{ orderId: string; maxSeq: number }>>(
          `SELECT "orderId", MAX("serverSequence") as "maxSeq"
           FROM "order_events"
           WHERE "orderId" = ANY($1::text[])
           GROUP BY "orderId"`,
          orderIds
        )
        for (const row of rows) {
          lastEventSeqMap.set(row.orderId, Number(row.maxSeq))
        }
      } catch {
        console.warn(`[bootstrap] Could not resolve lastEventSequence for open orders (locationId=${locationId})`)
      }
    }
  }

  const hasMoreOrders = openOrders.length >= opts.ordersPageSize

  const mappedOrders = openOrders.map((order: any) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    status: order.status,
    tableId: order.tableId,
    tableName: order.table?.name || null,
    tabName: order.tabName,
    guestCount: order.guestCount,
    employeeId: order.employeeId,
    employeeName: order.employee?.displayName || `${order.employee?.firstName || ''} ${order.employee?.lastName || ''}`.trim(),
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal),
    taxTotal: Number(order.taxTotal),
    tipTotal: Number(order.tipTotal),
    total: Number(order.total),
    inclusiveTaxRate: Number(order.inclusiveTaxRate) || 0,
    notes: order.notes || null,
    createdAt: order.createdAt?.toISOString?.() || order.createdAt,
    version: order.version ?? null,
    lastEventSequence: lastEventSeqMap.get(order.id) ?? 0,
    items: order.items.map((item: any) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: Number(item.price),
      quantity: item.quantity,
      itemTotal: Number(item.itemTotal),
      specialNotes: item.specialNotes || null,
      seatNumber: item.seatNumber ?? null,
      courseNumber: item.courseNumber ?? null,
      courseStatus: item.courseStatus ?? null,
      isHeld: item.isHeld ?? false,
      firedAt: item.firedAt?.toISOString?.() || null,
      isCompleted: item.isCompleted ?? false,
      completedAt: item.completedAt?.toISOString?.() || null,
      kitchenStatus: item.kitchenStatus ?? null,
      status: item.status || 'active',
      blockTimeMinutes: item.blockTimeMinutes ?? null,
      blockTimeStartedAt: item.blockTimeStartedAt?.toISOString?.() || null,
      blockTimeExpiresAt: item.blockTimeExpiresAt?.toISOString?.() || null,
      delayMinutes: item.delayMinutes ?? null,
      delayStartedAt: item.delayStartedAt?.toISOString?.() || null,
      soldByWeight: item.soldByWeight ?? false,
      weight: item.weight != null ? Number(item.weight) : null,
      weightUnit: item.weightUnit ?? null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      isTaxInclusive: item.isTaxInclusive ?? false,
      categoryType: item.categoryType ?? null,
      pricingOptionId: item.pricingOptionId ?? null,
      pricingOptionLabel: item.pricingOptionLabel ?? null,
      modifiers: item.modifiers.map((mod: any) => ({
        id: mod.id,
        modifierId: mod.modifierId,
        name: mod.name,
        price: Number(mod.price),
        depth: mod.depth || 0,
        preModifier: mod.preModifier || null,
        isNoneSelection: mod.isNoneSelection ?? false,
      })),
      ingredientModifications: item.ingredientModifications?.map((ing: any) => ({
        id: ing.id,
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName,
        modificationType: ing.modificationType,
        priceAdjustment: Number(ing.priceAdjustment || 0),
        swappedToModifierId: ing.swappedToModifierId || null,
        swappedToModifierName: ing.swappedToModifierName || null,
      })) || [],
    })),
    payments: order.payments.map((p: any) => ({
      id: p.id,
      status: p.status,
      paymentMethod: p.paymentMethod,
      totalAmount: Number(p.totalAmount),
      tipAmount: Number(p.tipAmount || 0),
    })),
  }))

  return { openOrders: mappedOrders, hasMoreOrders }
}

// ─── Terminal Config Builder ──────────────────────────────────────────────────
function buildTerminalConfig(
  terminal: any,
  scaleConfig: any,
  isTestMode: boolean,
) {
  return {
    terminalId: terminal.id,
    locationId: terminal.locationId,
    cfdTerminalId: terminal.cfdTerminalId ?? null,
    defaultMode: terminal.defaultMode ?? null,
    receiptPrinterId: terminal.receiptPrinterId ?? null,
    kitchenPrinterId: terminal.kitchenPrinterId ?? null,
    barPrinterId: terminal.barPrinterId ?? null,
    isTestMode,
    scaleConfig: scaleConfig ? {
      id: scaleConfig.id,
      connectionType: scaleConfig.connectionType,
      networkHost: scaleConfig.networkHost ?? null,
      networkPort: scaleConfig.networkPort ?? null,
      name: scaleConfig.name,
    } : null,
  }
}

// ─── Main GET handler ─────────────────────────────────────────────────────────
export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const opts = parseBootstrapOptions(request)
  const hasPagination = opts.menuCursor !== null || opts.ordersCursor !== null
  const hasFilters = opts.sections !== null || hasPagination

  // Diagnostic: log locationId + terminal info for debugging cellular bootstrap
  const isCellular = request.headers.get('x-cellular-authenticated') === '1'
  const venueSlug = request.headers.get('x-venue-slug')
  if (isCellular) {
    console.info(`[bootstrap] cellular terminal=${auth.terminal.id} locationId=${locationId} venueSlug=${venueSlug}`)
  }

  // Fetch scale config if terminal is bound to a scale
  const scaleConfig = auth.terminal.scaleId ? await db.scale.findUnique({
    where: { id: auth.terminal.scaleId },
    select: { id: true, connectionType: true, networkHost: true, networkPort: true, name: true },
  }) : null

  // ─── Cache path: only for default (unfiltered, unpaginated) requests ──────
  // Filtered/paginated requests bypass the cache since they return partial data.
  if (!hasFilters) {
    const syncCacheKey = `sync-bootstrap-${locationId}`
    const cachedBootstrap = syncBootstrapCache.get(syncCacheKey)
    if (cachedBootstrap && Date.now() < cachedBootstrap.expiry) {
      const cachedData = { ...cachedBootstrap.data }
      cachedData.terminalConfig = buildTerminalConfig(
        auth.terminal, scaleConfig,
        cachedData.terminalConfig?.isTestMode ?? false,
      )
      cachedData.syncVersion = Date.now()
      return ok(cachedData)
    }

    // Inflight promise coalescing
    const inflightKey = `bootstrap-${locationId}`
    const existingInflight = inflightBootstrap.get(inflightKey)
    if (existingInflight) {
      const inflightData = await existingInflight
      const personalizedData = { ...inflightData }
      personalizedData.terminalConfig = buildTerminalConfig(
        auth.terminal, scaleConfig,
        personalizedData.terminalConfig?.isTestMode ?? false,
      )
      personalizedData.syncVersion = Date.now()
      return ok(personalizedData)
    }

    // Create inflight promise
    const bootstrapPromise = (async () => {
      const responseData = await buildFullResponse(locationId, opts, auth.terminal, scaleConfig, isCellular, venueSlug)

      // Cache the response
      syncBootstrapCache.set(syncCacheKey, { data: responseData, expiry: Date.now() + SYNC_BOOTSTRAP_TTL })
      // Evict stale entries
      if (syncBootstrapCache.size > 20) {
        const now = Date.now()
        for (const [key, entry] of syncBootstrapCache) {
          if (now >= entry.expiry) syncBootstrapCache.delete(key)
        }
      }

      return responseData
    })().finally(() => {
      inflightBootstrap.delete(inflightKey)
    })

    // MUST set before awaiting so concurrent requests find the inflight promise
    inflightBootstrap.set(inflightKey, bootstrapPromise)

    const finalData = await bootstrapPromise
    return ok(finalData)
  }

  // ─── Filtered/paginated path: no caching ──────────────────────────────────
  const responseData = await buildFullResponse(locationId, opts, auth.terminal, scaleConfig, isCellular, venueSlug)
  return ok(responseData)
})

// ─── Build the full response ──────────────────────────────────────────────────
// Orchestrates all domain fetchers based on requested sections.
async function buildFullResponse(
  locationId: string,
  opts: BootstrapOptions,
  terminal: any,
  scaleConfig: any,
  isCellular: boolean,
  venueSlug: string | null,
) {
  // Fire all domain fetches in parallel where possible.
  // Menu and settings share a dependency (rawCategories for tax derivation),
  // so menu must complete before settings can finalize tax flags.
  // We handle this by always fetching menu when settings is requested.
  const needMenu = shouldFetch(opts, 'menu') || shouldFetch(opts, 'settings')
  const needEmployees = shouldFetch(opts, 'employees')
  const needOperational = shouldFetch(opts, 'operational')
  const needOrders = shouldFetch(opts, 'orders')

  // Phase 1: Parallel fetch of menu + employees + operational + orders
  const [menuResult, employees, operational, ordersResult] = await Promise.all([
    needMenu ? fetchMenuData(locationId, opts) : null,
    needEmployees ? fetchEmployeeData(locationId) : null,
    needOperational ? fetchOperationalState(locationId) : null,
    needOrders ? fetchOpenOrders(locationId, opts) : null,
  ])

  // Phase 2: Settings depends on rawCategories from menu
  const rawCategories = menuResult?._rawCategories ?? []
  const settingsResult = shouldFetch(opts, 'settings')
    ? await fetchSettingsAndConfig(locationId, rawCategories)
    : null

  // Cellular diagnostics
  if (isCellular) {
    const totalItems = menuResult?.menu.categories.reduce((n: number, c: any) => n + c.menuItems.length, 0) ?? 0
    const catCount = menuResult?.menu.categories.length ?? 0
    const empCount = employees?.length ?? 0
    console.info(`[bootstrap] cellular result: ${catCount} categories, ${totalItems} items, ${empCount} employees, location=${settingsResult?.location?.id ?? locationId}`)

    if (settingsResult && !settingsResult.location) {
      console.error(`[bootstrap] FATAL: locationId=${locationId} not found in venue DB (slug=${venueSlug}). Likely posLocationId mismatch in MC.`)
      return notFound(`Bootstrap failed: locationId '${locationId}' not found in venue database '${venueSlug}'. Device must be re-paired after fixing posLocationId in Mission Control.`)
    }

    if (menuResult && menuResult.menu.categories.length === 0) {
      console.warn(`[bootstrap] WARNING: 0 categories for locationId=${locationId} in venue=${venueSlug} — menu may not be configured`)
    }
  }

  // Derive isTestMode from settings
  const settings = settingsResult?.locationSettings as any
  const isTestMode = (() => {
    if (!settings) return false
    const p = settings?.payments
    return p?.datacapEnvironment ? p.datacapEnvironment === 'cert' : (p?.testMode ?? false)
  })()

  // Build the response — always include all top-level keys for backward compatibility
  // When a section isn't requested, its value will be null/empty but the key is present
  const responseData: any = {
    // Menu section
    menu: menuResult ? {
      categories: menuResult.menu.categories,
      childModifierGroups: menuResult.menu.childModifierGroups,
      ...(menuResult.menu.hasMore ? { hasMore: true } : {}),
    } : shouldFetch(opts, 'menu') ? { categories: [], childModifierGroups: [] } : { categories: [], childModifierGroups: [] },

    // Employees section
    employees: employees ?? [],

    // Operational section
    tables: operational?.tables ?? [],
    orderTypes: operational?.orderTypes ?? [],
    sections: operational?.sections ?? [],
    floorPlanElements: operational?.floorPlanElements ?? [],

    // Settings section
    taxRate: settingsResult?.taxRate ?? 0,
    inclusiveTaxRate: settingsResult?.inclusiveTaxRate ?? 0,
    taxRules: settingsResult?.taxRules ?? [],
    locationSettings: settingsResult?.locationSettings ?? {},
    paymentReaders: settingsResult?.paymentReaders ?? [],
    printers: settingsResult?.printers ?? [],
    cfdSettings: settingsResult?.cfdSettings ?? null,
    discountRules: settingsResult?.discountRules ?? [],
    voidReasons: settingsResult?.voidReasons ?? [],
    compReasons: settingsResult?.compReasons ?? [],

    // Orders section
    openOrders: ordersResult?.openOrders ?? [],
    hasMoreOrders: ordersResult?.hasMoreOrders ?? false,

    // Always present
    syncVersion: Date.now(),
    terminalConfig: buildTerminalConfig(terminal, scaleConfig, isTestMode),
  }

  return responseData
}

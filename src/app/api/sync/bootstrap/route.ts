import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { buildSpiritTiersFromItem, normalizeModifier } from '@/lib/spirit-tiers'
import { parseSettings } from '@/lib/settings'
import { authenticateTerminal } from '@/lib/terminal-auth'

// ─── Sync bootstrap cache ─────────────────────────────────────────────────
// Same pattern as session/bootstrap's menu cache. Caches the heavy menu+categories
// query for 15s to prevent redundant DB hits when multiple Android devices boot simultaneously.
const syncBootstrapCache = new Map<string, { data: any; expiry: number }>()
const SYNC_BOOTSTRAP_TTL = 15_000 // 15 seconds

// Inflight promise coalescing: prevents bootstrap stampede where 10 concurrent
// requests before cache populates would fire 160 queries on a 25-connection pool.
// Same pattern as inflightSettings in location-cache.ts.
const inflightBootstrap = new Map<string, Promise<any>>()

// Allow up to 120s for bootstrap on Vercel (Neon queries can be slow on cold starts)
export const maxDuration = 120

export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  // Diagnostic: log locationId + terminal info for debugging cellular bootstrap
  const isCellular = request.headers.get('x-cellular-authenticated') === '1'
  const venueSlug = request.headers.get('x-venue-slug')
  if (isCellular) {
    console.info(`[bootstrap] cellular terminal=${auth.terminal.id} locationId=${locationId} venueSlug=${venueSlug}`)
  }

  // Fetch scale config if terminal is bound to a scale (needed for both cached and non-cached paths)
  const scaleConfig = auth.terminal.scaleId ? await db.scale.findUnique({
    where: { id: auth.terminal.scaleId },
    select: { id: true, connectionType: true, networkHost: true, networkPort: true, name: true },
  }) : null

  // Check sync bootstrap cache (15s TTL — prevents stampede when multiple devices boot)
  const syncCacheKey = `sync-bootstrap-${locationId}`
  const cachedBootstrap = syncBootstrapCache.get(syncCacheKey)
  if (cachedBootstrap && Date.now() < cachedBootstrap.expiry) {
    // Re-inject terminal-specific config into cached response
    const cachedData = { ...cachedBootstrap.data }
    cachedData.terminalConfig = {
      terminalId: auth.terminal.id,
      locationId: auth.terminal.locationId,
      cfdTerminalId: auth.terminal.cfdTerminalId ?? null,
      defaultMode: auth.terminal.defaultMode ?? null,
      receiptPrinterId: auth.terminal.receiptPrinterId ?? null,
      kitchenPrinterId: auth.terminal.kitchenPrinterId ?? null,
      barPrinterId: auth.terminal.barPrinterId ?? null,
      isTestMode: cachedData.terminalConfig?.isTestMode ?? false,
      scaleConfig: scaleConfig ? {
        id: scaleConfig.id,
        connectionType: scaleConfig.connectionType,
        networkHost: scaleConfig.networkHost ?? null,
        networkPort: scaleConfig.networkPort ?? null,
        name: scaleConfig.name,
      } : null,
    }
    cachedData.syncVersion = Date.now()
    return NextResponse.json({ data: cachedData })
  }

  // Inflight promise coalescing: if another request for this locationId is already
  // executing the heavy queries, await its result instead of firing a second set.
  // This prevents 10 concurrent bootstraps from issuing 160 queries on a 25-connection pool.
  const inflightKey = `bootstrap-${locationId}`
  const existingInflight = inflightBootstrap.get(inflightKey)
  if (existingInflight) {
    const inflightData = await existingInflight
    // Re-inject terminal-specific config into the coalesced result
    const personalizedData = { ...inflightData }
    personalizedData.terminalConfig = {
      terminalId: auth.terminal.id,
      locationId: auth.terminal.locationId,
      cfdTerminalId: auth.terminal.cfdTerminalId ?? null,
      defaultMode: auth.terminal.defaultMode ?? null,
      receiptPrinterId: auth.terminal.receiptPrinterId ?? null,
      kitchenPrinterId: auth.terminal.kitchenPrinterId ?? null,
      barPrinterId: auth.terminal.barPrinterId ?? null,
      isTestMode: personalizedData.terminalConfig?.isTestMode ?? false,
      scaleConfig: scaleConfig ? {
        id: scaleConfig.id,
        connectionType: scaleConfig.connectionType,
        networkHost: scaleConfig.networkHost ?? null,
        networkPort: scaleConfig.networkPort ?? null,
        name: scaleConfig.name,
      } : null,
    }
    personalizedData.syncVersion = Date.now()
    return NextResponse.json({ data: personalizedData })
  }

  // Create the inflight promise for this locationId — other concurrent requests will await it
  const bootstrapPromise = (async () => {

  const [categories, employees, tables, orderTypes, location, paymentReaders, printers, sections, floorPlanElements, cfdSettings, openOrders, taxRules, pizzaToppings, discountRules, voidReasons, compReasons] = await Promise.all([
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
    adminDb.employee.findMany({
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
    db.section.findMany({ where: { locationId, deletedAt: null }, orderBy: { sortOrder: 'asc' }, include: { assignments: { select: { employeeId: true } } } }),
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
    // Open orders: allows device to rebuild state after mid-service reboot
    // without relying solely on socket catch-up (which may miss events)
    adminDb.order.findMany({
      where: {
        locationId,
        status: { notIn: ['closed', 'voided', 'paid', 'cancelled'] },
        deletedAt: null,
      },
      take: 500,
      include: {
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: {
              select: {
                id: true,
                modifierId: true,
                name: true,
                price: true,
                depth: true,
                preModifier: true,
                isNoneSelection: true,
              },
            },
            ingredientModifications: {
              select: {
                id: true,
                ingredientId: true,
                ingredientName: true,
                modificationType: true,
                priceAdjustment: true,
                swappedToModifierId: true,
                swappedToModifierName: true,
              },
            },
          },
        },
        payments: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            paymentMethod: true,
            totalAmount: true,
            tipAmount: true,
          },
        },
        table: { select: { id: true, name: true } },
        employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // Tax rules: needed to derive tax-inclusive pricing flags for Android
    db.taxRule.findMany({
      where: { locationId, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        rate: true,
        appliesTo: true,
        categoryIds: true,
        itemIds: true,
        isInclusive: true,
        priority: true,
        isCompounded: true,
        isActive: true,
      },
      orderBy: { priority: 'asc' },
    }),
    // Pizza toppings: category enrichment for Android topping filter tabs
    db.pizzaTopping.findMany({
      where: { locationId, isActive: true, deletedAt: null },
      select: { name: true, category: true }
    }),
    // Discount rules: validation data for comp/void/discount operations on Android
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
    // Void reasons: required for item void operations on Android
    db.voidReason.findMany({
      where: { locationId, deletedAt: null, isActive: true },
      select: {
        id: true, name: true, description: true,
        deductInventory: true, requiresManager: true,
        isActive: true, sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    // Comp reasons: required for item comp operations on Android
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

  if (isCellular) {
    const totalItems = categories.reduce((n, c) => n + c.menuItems.length, 0)
    console.info(`[bootstrap] cellular result: ${categories.length} categories, ${totalItems} items, ${employees.length} employees, location=${location?.id ?? 'null'}`)

    // Sanity check: if location doesn't exist in this venue DB, fail loudly
    if (!location) {
      console.error(`[bootstrap] FATAL: locationId=${locationId} not found in venue DB (slug=${venueSlug}). Likely posLocationId mismatch in MC.`)
      return NextResponse.json({
        error: `Bootstrap failed: locationId '${locationId}' not found in venue database '${venueSlug}'. Device must be re-paired after fixing posLocationId in Mission Control.`,
      }, { status: 404 })
    }

    // Sanity check: if no categories found, warn (might be valid for empty venue, but usually wrong)
    if (categories.length === 0) {
      console.warn(`[bootstrap] WARNING: 0 categories for locationId=${locationId} in venue=${venueSlug} — menu may not be configured`)
    }
  }

  // ─── Pizza Topping Category Enrichment ──────────────────────────────────────
  // Enrich modifier objects with toppingCategory from PizzaTopping records.
  // Name-based matching (normalized: trim, lowercase, collapse whitespace).
  const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const toppingCategoryMap = new Map(
    pizzaToppings.map((t: any) => [normalizeName(t.name), t.category])
  )
  if (pizzaToppings.length > 0) {
    const seenNames = new Map<string, string>()
    for (const t of pizzaToppings) {
      const norm = normalizeName(t.name)
      if (seenNames.has(norm) && seenNames.get(norm) !== t.category) {
        console.warn(`[bootstrap] duplicate topping name '${t.name}' (norm: '${norm}') categories: '${seenNames.get(norm)}' vs '${t.category}' locationId=${locationId}`)
      }
      seenNames.set(norm, t.category)
    }
  }
  const enrichModifier = (m: any) => normalizeModifier({
    ...m,
    toppingCategory: toppingCategoryMap.get(normalizeName(m.name ?? '')) ?? null,
  })

  // Fetch shared/global modifier groups (menuItemId IS NULL) — these include
  // spirit upgrade groups created via the liquor builder that aren't tied to a
  // specific menu item. Without this, 5 of 6 spirit groups are invisible on Android.
  const sharedModifierGroups = await db.modifierGroup.findMany({
    where: { locationId, menuItemId: null, deletedAt: null },
    include: {
      modifiers: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

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

  // parseSettings applies mergeWithDefaults — this corrects dualPricing.enabled from the stored
  // raw JSON (which may have legacy enabled:false) and derives it from cashDiscountPercent.
  const settings = parseSettings(location?.settings) as unknown as Record<string, unknown>

  // ─── Tax-Inclusive Pricing Derivation ───────────────────────────────────────
  // Derive taxInclusiveLiquor/taxInclusiveFood from TaxRule records (same logic
  // as /api/settings GET). Without this, Android gets false/false from defaults
  // and shows "Tax $0.00" when inclusive pricing is enabled. (P0 fix)
  const LIQUOR_CATEGORY_TYPES = ['liquor', 'drinks']
  const FOOD_CATEGORY_TYPES = ['food', 'pizza', 'combos']

  const inclusiveTaxRules = taxRules.filter(r => r.isInclusive)
  const nonInclusiveTaxRules = taxRules.filter(r => !r.isInclusive)

  // Sum all non-inclusive rates (stored as decimals, e.g. 0.07 for 7%)
  const effectiveTaxRate = nonInclusiveTaxRules.reduce((sum, r) => sum + Number(r.rate), 0)

  // Build a categoryId → categoryType map from the already-fetched categories
  const categoryTypeMap = new Map<string, string | null>()
  for (const cat of categories) {
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

  // Inject derived tax flags + effective rate into settings so Android receives them
  const taxSettings = (settings.tax ?? {}) as Record<string, unknown>
  settings.tax = {
    ...taxSettings,
    taxInclusiveLiquor,
    taxInclusiveFood,
    // Override defaultRate with the effective non-inclusive rate (as percentage) if TaxRules exist
    ...(effectiveTaxRate > 0 ? { defaultRate: effectiveTaxRate * 100 } : {}),
  }

  // Also compute the inclusive tax rate (sum of inclusive rules) for Android to back out tax
  const inclusiveTaxRate = inclusiveTaxRules.reduce((sum, r) => sum + Number(r.rate), 0)

  // Tax rate for Android: MUST match what calculateOrderTotals() uses on the server
  // (settings.tax.defaultRate / 100) so that the Android reducer's locally-computed
  // taxTotal agrees with server-computed taxTotal. Previous code used the TaxRule sum
  // which could disagree with defaultRate, causing cash tax mismatches.
  const taxRate = ((settings.tax as Record<string, unknown>)?.defaultRate as number ?? 0) / 100

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
      ownedModifierGroups: (item as any).ownedModifierGroups?.map((g: any) => ({
        ...g,
        modifiers: g.modifiers?.map((m: any) => enrichModifier(m)) ?? [],
      })) ?? [],
    })),
  }))

  // ─── lastEventSequence for open orders ─────────────────────────────────────
  // Android needs this to start delta sync from the correct point instead of
  // seq=0 (which would re-request ALL events and cause duplicates).
  // Batch-query OrderSnapshot which stores the projected lastEventSequence.
  const orderIds = openOrders.map((o: any) => o.id)
  const lastEventSeqMap = new Map<string, number>()
  if (orderIds.length > 0) {
    try {
      // OrderSnapshot.id = orderId, so we can query directly
      const snapshots = await adminDb.orderSnapshot.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, lastEventSequence: true },
      })
      for (const snap of snapshots) {
        lastEventSeqMap.set(snap.id, snap.lastEventSequence)
      }
    } catch {
      // OrderSnapshot table may not exist in all venues yet — fall back to
      // MAX(serverSequence) from OrderEvent as a safety net
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
        // Neither source available — Android will fall back to seq=0
        console.warn(`[bootstrap] Could not resolve lastEventSequence for open orders (locationId=${locationId})`)
      }
    }
  }

  const responseData = {
      menu: {
        categories: mappedCategories,
        childModifierGroups: [
          ...childModifierGroups,
          // Include shared/global modifier groups (menuItemId IS NULL) — spirit upgrades
          ...sharedModifierGroups.map(g => ({
            ...g,
            modifiers: g.modifiers.map((m: any) => enrichModifier(m)),
          })),
        ],
      },
      // PIN hash intentionally excluded — Android must use POST /api/auth/verify-pin instead of local bcrypt compare.
      // Coordinated removal: update Android before deploying this change to production.
      employees: employees.map(e => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, displayName: e.displayName, locationId: e.locationId, role: e.role, posLayoutSettings: e.posLayoutSettings ?? null })),
      tables,
      orderTypes,
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
      locationSettings: settings,
      paymentReaders,
      printers,
      sections: sections.map(s => ({ id: s.id, name: s.name, color: s.color, sortOrder: s.sortOrder, assignedEmployeeIds: s.assignments.map(a => a.employeeId) })),
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
        scaleConfig: scaleConfig ? {
          id: scaleConfig.id,
          connectionType: scaleConfig.connectionType,
          networkHost: scaleConfig.networkHost ?? null,
          networkPort: scaleConfig.networkPort ?? null,
          name: scaleConfig.name,
        } : null,
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
      // Discount rules: validation data for comp/void/discount operations
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
      // Void/comp reasons: required for item void/comp operations
      voidReasons,
      compReasons,
      // Flag: true if there are more open orders beyond the 500 limit
      hasMoreOrders: openOrders.length >= 500,
      // Open orders: allows device to rebuild state after mid-service reboot
      // without relying solely on socket catch-up (which may miss events).
      // Includes items, modifiers, ingredient mods, and payments.
      openOrders: openOrders.map((order: any) => ({
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
        // lastEventSequence: allows Android to start delta sync from the correct
        // point instead of seq=0 (which would re-request ALL events, causing duplicates)
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
      })),
    }

  // Cache the response for 15s (terminal-specific config re-injected on hit)
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

  return NextResponse.json({ data: finalData })
})

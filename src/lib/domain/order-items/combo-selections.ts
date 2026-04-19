/**
 * Combo Selections — Phase 5 (Combo Pick N of M)
 *
 * Shared validator + creator helpers for OrderItemComboSelection rows, plus
 * the canonical Prisma include / wire mapper that every read path must adopt.
 *
 * Route-agnostic: no Next.js imports. Callers translate
 * ComboValidationError into HTTP responses.
 */

import { Prisma } from '@/generated/prisma/client'
import { randomUUID } from 'crypto'
import type { TxClient } from './types'

// ─── Error ──────────────────────────────────────────────────────────────────

export class ComboValidationError extends Error {
  status: number
  code: string
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'ComboValidationError'
    this.code = code
    this.status = status
  }
}

// ─── Input DTO ──────────────────────────────────────────────────────────────

/**
 * Wire-level combo selection payload. Mirrors Android's `ComboSelectionRequest`.
 * Server resolves menuItemId from the option; upchargeApplied is always
 * recomputed server-side (client value is advisory only).
 */
export interface ComboSelectionInput {
  id?: string | null
  comboComponentId?: string | null
  comboComponentOptionId?: string | null
  menuItemId?: string | null
  optionName?: string | null
  upchargeApplied?: number | null
  sortIndex?: number | null
}

// ─── Canonical Prisma Include ───────────────────────────────────────────────

/**
 * ORDER_ITEM_FULL_INCLUDE — the single include shape that every whole-OrderItem
 * read path MUST use. Hydrates enough for API responses, KDS snapshots, print
 * templates, reports, and Android projections.
 *
 * Keep this aligned with `mapOrderItemForWire()` below.
 */
export const ORDER_ITEM_FULL_INCLUDE = {
  menuItem: {
    select: {
      id: true,
      name: true,
      itemType: true,
      categoryId: true,
      category: { select: { id: true, name: true, categoryType: true } },
    },
  },
  modifiers: {
    where: { deletedAt: null },
  },
  ingredientModifications: {
    where: { deletedAt: null },
  },
  pizzaData: true,
  itemDiscounts: {
    where: { deletedAt: null },
    select: { id: true, amount: true, percent: true, reason: true },
  },
  comboSelections: {
    where: { deletedAt: null },
    orderBy: { sortIndex: 'asc' },
    include: {
      comboComponent: true,
      comboComponentOption: true,
      menuItem: {
        include: {
          recipe: {
            include: {
              ingredients: {
                include: {
                  inventoryItem: true,
                  prepItem: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.OrderItemInclude

// ─── Wire Mapper ────────────────────────────────────────────────────────────

export interface WireComboSelection {
  id: string
  comboComponentId: string | null
  comboComponentOptionId: string | null
  menuItemId: string
  optionName: string
  upchargeApplied: number
  sortIndex: number
}

export interface WireOrderItemExtras {
  comboSelections: WireComboSelection[]
}

/**
 * mapOrderItemForWire — serializes a Prisma OrderItem (hydrated with
 * ORDER_ITEM_FULL_INCLUDE) to the shape consumed by Android, KDS, print,
 * reports, and cached order views.
 *
 * Thin alias over `mapOrderItemForResponse` — kept as the single exported
 * wire entry point per the combo-refactor rule (one include, one mapper).
 * `comboSelections` is emitted directly by the underlying mapper.
 */
export function mapOrderItemForWire(
  item: Record<string, unknown>,
  correlationId?: string,
): Record<string, unknown> & WireOrderItemExtras {
  // Lazy import to avoid circular dep with api/order-response-mapper.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mapOrderItemForResponse } = require('@/lib/api/order-response-mapper') as typeof import('@/lib/api/order-response-mapper')
  return mapOrderItemForResponse(item as any, correlationId) as unknown as Record<string, unknown> & WireOrderItemExtras
}

// ─── Validator + Builder ────────────────────────────────────────────────────

export interface ValidateAndBuildArgs {
  prisma: TxClient
  locationId: string
  orderItemId: string
  menuItemId: string
  quantity: number
  selections?: ComboSelectionInput[] | null
  /**
   * Origin of the mutation for bidirectional sync echo detection.
   * Cellular terminals writing through Vercel → Neon MUST pass `'cloud'`.
   * NUC LAN writes default to `'local'`.
   * See CLAUDE.md: "Cloud routes mutating bidirectional models MUST set `lastMutatedBy: 'cloud'`".
   */
  mutationOrigin?: 'local' | 'cloud'
}

export interface ValidateAndBuildResult {
  price: number | null
  rowsToCreate: Prisma.OrderItemComboSelectionCreateManyInput[]
  templateAllowUpcharges: boolean
}

const ZERO = new Prisma.Decimal(0)

function toDecimal(n: number | string | Prisma.Decimal | null | undefined): Prisma.Decimal {
  if (n == null) return ZERO
  if (n instanceof Prisma.Decimal) return n
  return new Prisma.Decimal(n)
}

/**
 * validateAndBuildComboSelections — server-authoritative validator + creator.
 *
 * Rules (see docs/features/combos.md):
 *   - Empty/null `selections` = legacy classic combo; caller leaves OrderItem.price alone.
 *   - `selections.length > 0` AND `quantity !== 1` → 400.
 *   - Template must exist for (menuItemId, locationId, deletedAt=null).
 *   - Each selection's component must belong to the template.
 *   - Each selection's option must belong to the component, be available, not deleted.
 *   - Server resolves menuItemId from the option; rejects mismatched client-sent menuItemId.
 *   - upchargeApplied forced to server value when allowUpcharges=true; else 0.
 *   - Per-component count check against min/max. Components with min>0 and no picks
 *     require either a default item (classic combo slot) or 400.
 *   - Final price = template.basePrice + sum(upchargeApplied).
 */
export async function validateAndBuildComboSelections(
  args: ValidateAndBuildArgs,
): Promise<ValidateAndBuildResult> {
  const { prisma, locationId, orderItemId, menuItemId, quantity, selections, mutationOrigin = 'local' } = args

  const hasSelections = Array.isArray(selections) && selections.length > 0

  if (!hasSelections) {
    return { price: null, rowsToCreate: [], templateAllowUpcharges: false }
  }

  if (quantity !== 1) {
    throw new ComboValidationError(
      'COMBO_QUANTITY_INVALID',
      `Combo items with customer picks must have quantity 1 (got ${quantity}). Add multiple combos as separate line items.`,
    )
  }

  const template = await prisma.comboTemplate.findFirst({
    where: {
      menuItemId,
      locationId,
      deletedAt: null,
    },
    include: {
      components: {
        where: { deletedAt: null },
        include: {
          options: {
            where: { deletedAt: null },
          },
        },
      },
    },
  })

  if (!template) {
    throw new ComboValidationError(
      'COMBO_TEMPLATE_NOT_FOUND',
      `No combo template found for menuItem ${menuItemId}`,
    )
  }

  const componentMap = new Map(template.components.map(c => [c.id, c]))

  // Build rows + per-component counts
  const rowsToCreate: Prisma.OrderItemComboSelectionCreateManyInput[] = []
  const perComponentCount = new Map<string, number>()
  let upchargeSum = ZERO

  selections!.forEach((sel, idx) => {
    const componentId = sel.comboComponentId ?? null
    const optionId = sel.comboComponentOptionId ?? null

    let component = componentId ? componentMap.get(componentId) ?? null : null
    if (componentId && !component) {
      throw new ComboValidationError(
        'COMBO_COMPONENT_MISMATCH',
        `comboComponentId ${componentId} does not belong to template ${template.id}`,
      )
    }

    let option: (typeof template.components)[number]['options'][number] | null = null
    if (optionId) {
      // Locate option and verify ownership
      for (const comp of template.components) {
        const match = comp.options.find(o => o.id === optionId)
        if (match) {
          option = match
          // If component wasn't supplied, derive from option
          if (!component) component = comp
          // If both supplied, they must agree
          if (component && comp.id !== component.id) {
            throw new ComboValidationError(
              'COMBO_OPTION_MISMATCH',
              `comboComponentOptionId ${optionId} does not belong to component ${component.id}`,
            )
          }
          break
        }
      }
      if (!option) {
        throw new ComboValidationError(
          'COMBO_OPTION_NOT_FOUND',
          `comboComponentOptionId ${optionId} not found on template ${template.id}`,
        )
      }
      if (!option.isAvailable) {
        throw new ComboValidationError(
          'COMBO_OPTION_UNAVAILABLE',
          `Selected option is currently unavailable (id=${optionId})`,
        )
      }
    }

    // Must have either a component or an option (usually both)
    if (!component && !option) {
      throw new ComboValidationError(
        'COMBO_SELECTION_INVALID',
        `Selection at index ${idx} missing both comboComponentId and comboComponentOptionId`,
      )
    }

    // Resolve menuItemId server-side (option wins if present, else fallback to component default/menuItemId)
    const serverMenuItemId =
      option?.menuItemId ??
      component?.menuItemId ??
      component?.defaultItemId ??
      null

    if (!serverMenuItemId) {
      throw new ComboValidationError(
        'COMBO_MENU_ITEM_UNRESOLVED',
        `Could not resolve menuItemId for selection at index ${idx}`,
      )
    }

    if (sel.menuItemId && sel.menuItemId !== serverMenuItemId) {
      throw new ComboValidationError(
        'COMBO_MENU_ITEM_MISMATCH',
        `Client-supplied menuItemId (${sel.menuItemId}) does not match server-resolved menuItemId (${serverMenuItemId})`,
      )
    }

    // upchargeApplied: server forces value when allowUpcharges=true; else 0.
    let upchargeApplied: Prisma.Decimal = ZERO
    if (template.allowUpcharges && option) {
      const serverUpcharge = toDecimal(option.upcharge)
      if (sel.upchargeApplied != null) {
        const clientUpcharge = toDecimal(sel.upchargeApplied)
        if (!clientUpcharge.equals(serverUpcharge)) {
          throw new ComboValidationError(
            'COMBO_UPCHARGE_MISMATCH',
            `Client upchargeApplied (${clientUpcharge.toString()}) does not match server value (${serverUpcharge.toString()}) for option ${option.id}`,
          )
        }
      }
      upchargeApplied = serverUpcharge
    }

    upchargeSum = upchargeSum.plus(upchargeApplied)

    const sortIndex = sel.sortIndex != null ? Number(sel.sortIndex) : idx
    const optionName = (sel.optionName && String(sel.optionName).trim()) || null

    // optionName snapshot — fall back to "" if unresolved; frontends should always send one.
    const snapshotOptionName = optionName ?? ''

    rowsToCreate.push({
      id: sel.id || randomUUID(),
      locationId,
      orderItemId,
      comboComponentId: component?.id ?? null,
      comboComponentOptionId: option?.id ?? null,
      menuItemId: serverMenuItemId,
      optionName: snapshotOptionName,
      upchargeApplied,
      sortIndex,
      lastMutatedBy: mutationOrigin,
    })

    if (component) {
      perComponentCount.set(component.id, (perComponentCount.get(component.id) ?? 0) + 1)
    }
  })

  // Per-component min/max check
  for (const comp of template.components) {
    const count = perComponentCount.get(comp.id) ?? 0
    if (count < comp.minSelections) {
      const hasDefault = !!comp.defaultItemId || !!comp.menuItemId
      if (!(count === 0 && hasDefault)) {
        throw new ComboValidationError(
          'COMBO_COMPONENT_MIN_NOT_MET',
          `Component "${comp.displayName}" requires at least ${comp.minSelections} selection(s); got ${count}`,
        )
      }
    }
    if (count > comp.maxSelections) {
      throw new ComboValidationError(
        'COMBO_COMPONENT_MAX_EXCEEDED',
        `Component "${comp.displayName}" allows at most ${comp.maxSelections} selection(s); got ${count}`,
      )
    }
  }

  const finalPrice = toDecimal(template.basePrice).plus(upchargeSum)

  return {
    price: Number(finalPrice.toFixed(2)),
    rowsToCreate,
    templateAllowUpcharges: template.allowUpcharges,
  }
}

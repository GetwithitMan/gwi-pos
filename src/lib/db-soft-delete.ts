/**
 * Soft-Delete Filter — Prisma Extension
 *
 * Automatically adds `deletedAt: null` to all read queries so that
 * soft-deleted rows are excluded by default. This fixes 288+ places in the
 * codebase that would otherwise need manual `deletedAt: null` filters.
 *
 * To query deleted rows intentionally (e.g. admin / audit), explicitly set
 * `deletedAt` to any non-undefined value in the where clause:
 *   db.menuItem.findMany({ where: { deletedAt: { not: null } } })
 *   db.menuItem.findMany({ where: { deletedAt: { gte: someDate } } })
 *
 * ── Which models get filtered ────────────────────────────────────────────
 * Derived from the Prisma client's own runtime data model, NOT a hand-kept
 * list. A model is filtered only when it actually declares a `deletedAt`
 * field. Injecting the filter into a model without the column produces
 *
 *   PrismaClientValidationError: Unknown argument `deletedAt`
 *
 * on EVERY read of that model — a total outage for the affected routes.
 * That happened: 18 models (LoyaltyTransaction, NotificationJob, SyncWatermark,
 * the whole Check Aggregate, …) shipped unregistered and crashed on read.
 * Deriving the set removes the failure mode instead of re-listing it, so new
 * tables are correct the moment they are added.
 *
 * NO_SOFT_DELETE_MODELS remains for *semantic* exemptions — models that DO have
 * the column but must not be filtered anyway (Organization, Location).
 */

import { NO_SOFT_DELETE_MODELS } from './tenant-validation'

/**
 * Models that declare a `deletedAt` field, per the generated client.
 * Null until initialised — see `initSoftDeleteRegistry`.
 */
let modelsWithDeletedAt: Set<string> | null = null

interface RuntimeDataModelShape {
  _runtimeDataModel?: {
    models: Record<string, { fields: Array<{ name: string }> }>
  }
}

/**
 * Build the registry from the Prisma client's runtime data model.
 * Call once, at client construction, before the extension is applied.
 *
 * Safe to call with anything: if the client doesn't expose the metadata we
 * leave the registry null and fall back to the static list, which preserves
 * the old behaviour rather than silently disabling soft-delete filtering
 * (which would leak deleted rows).
 */
export function initSoftDeleteRegistry(client: unknown): void {
  const rdm = (client as RuntimeDataModelShape)?._runtimeDataModel
  if (!rdm?.models) return
  const withColumn = new Set<string>()
  for (const [name, def] of Object.entries(rdm.models)) {
    if (def.fields?.some(f => f.name === 'deletedAt')) withColumn.add(name)
  }
  // Only trust a plausibly-complete registry.
  if (withColumn.size > 0) modelsWithDeletedAt = withColumn
}

/** Test seam — inject a known registry without a live client. */
export function __setSoftDeleteRegistryForTests(models: Set<string> | null): void {
  modelsWithDeletedAt = models
}

/** True when this model should receive the `deletedAt: null` filter. */
export function shouldSoftDeleteFilter(model: string): boolean {
  if (NO_SOFT_DELETE_MODELS.has(model)) return false
  // Registry unavailable — preserve legacy behaviour.
  if (modelsWithDeletedAt === null) return true
  return modelsWithDeletedAt.has(model)
}

/** Apply soft-delete filter: inject `deletedAt: null` if not explicitly set. */
export function applySoftDeleteFilter(model: string, args: { where?: Record<string, unknown> }): void {
  if (!shouldSoftDeleteFilter(model)) return
  args.where = args.where ?? {}
  if ((args.where as Record<string, unknown>).deletedAt === undefined) {
    (args.where as Record<string, unknown>).deletedAt = null
  }
}

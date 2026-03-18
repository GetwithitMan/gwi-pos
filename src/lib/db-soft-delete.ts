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
 */

import { NO_SOFT_DELETE_MODELS } from './tenant-validation'

/** Apply soft-delete filter: inject `deletedAt: null` if not explicitly set. */
export function applySoftDeleteFilter(model: string, args: { where?: Record<string, unknown> }): void {
  if (NO_SOFT_DELETE_MODELS.has(model)) return
  args.where = args.where ?? {}
  if ((args.where as Record<string, unknown>).deletedAt === undefined) {
    (args.where as Record<string, unknown>).deletedAt = null
  }
}

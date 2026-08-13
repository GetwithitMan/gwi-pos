import { describe, it, expect } from 'vitest'
import { SYNC_MODELS } from '../sync-config'

/**
 * Guard for a fail-closed startup check.
 *
 * `validateSyncCoverage` throws on duplicate sync priorities, and server.ts
 * treats that as fatal:
 *
 *   [SYNC CONFIG] FATAL — Priority collisions detected
 *   Cannot start with sync coverage errors in production
 *
 * The container then never binds its port, the deploy health check fails, and
 * gwi-node rolls the venue back. That happened on a real deploy: Check and
 * CheckItem were added at priorities 26/27, already held by OrderItemIngredient
 * and OrderItemPizza. Nothing catches it before the artifact reaches a NUC,
 * because the check needs a live database — so assert it here instead, where
 * it costs milliseconds.
 */

describe('SYNC_MODELS priorities', () => {
  // Mirrors the filter in validateSyncCoverage: models that never sync are
  // exempt, and priority 0 is the "unset" sentinel for auto-registered tables.
  const active = Object.entries(SYNC_MODELS).filter(
    ([, cfg]) => cfg.direction !== 'none' && cfg.priority !== 0
  )

  it('has no duplicate priorities among actively-syncing models', () => {
    const byPriority = new Map<number, string[]>()
    for (const [model, cfg] of active) {
      byPriority.set(cfg.priority, [...(byPriority.get(cfg.priority) ?? []), model])
    }

    const collisions = [...byPriority.entries()]
      .filter(([, models]) => models.length > 1)
      .sort(([a], [b]) => a - b)
      .map(([priority, models]) => `  priority ${priority}: ${models.join(', ')}`)

    expect(collisions, `Duplicate sync priorities:\n${collisions.join('\n')}`).toEqual([])
  })

  it('syncs Check after the Order it references', () => {
    // Check.orderId is an FK to Order — Order must land upstream first or the
    // insert violates the constraint.
    expect(SYNC_MODELS.Check.priority).toBeGreaterThan(SYNC_MODELS.Order.priority)
    expect(SYNC_MODELS.CheckItem.priority).toBeGreaterThan(SYNC_MODELS.Check.priority)
  })

  it('keeps every active model on a positive priority', () => {
    const bad = active.filter(([, cfg]) => cfg.priority <= 0).map(([m]) => m)
    expect(bad).toEqual([])
  })
})

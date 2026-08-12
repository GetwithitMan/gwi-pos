import { describe, it, expect, afterEach } from 'vitest'
import {
  applySoftDeleteFilter,
  shouldSoftDeleteFilter,
  initSoftDeleteRegistry,
  __setSoftDeleteRegistryForTests,
} from '../db-soft-delete'

/**
 * Regression coverage for the outage described in db-soft-delete.ts.
 *
 * The filter used to be applied to every model not named in a hand-kept list.
 * Any new table without a `deletedAt` column therefore threw
 * "Unknown argument `deletedAt`" on EVERY read until someone remembered to
 * update the list — which is exactly what happened to 18 models.
 */

// A stand-in for the generated client's runtime metadata.
const FAKE_CLIENT = {
  _runtimeDataModel: {
    models: {
      MenuItem: { fields: [{ name: 'id' }, { name: 'deletedAt' }] },
      Location: { fields: [{ name: 'id' }, { name: 'deletedAt' }] },
      ProcessedCommand: { fields: [{ name: 'id' }, { name: 'commandId' }] },
      LoyaltyTransaction: { fields: [{ name: 'id' }, { name: 'points' }] },
      CheckItem: { fields: [{ name: 'id' }, { name: 'checkId' }] },
    },
  },
}

afterEach(() => __setSoftDeleteRegistryForTests(null))

describe('soft-delete filter targeting', () => {
  it('filters models that declare deletedAt', () => {
    initSoftDeleteRegistry(FAKE_CLIENT)
    expect(shouldSoftDeleteFilter('MenuItem')).toBe(true)

    const args: { where?: Record<string, unknown> } = {}
    applySoftDeleteFilter('MenuItem', args)
    expect(args.where).toEqual({ deletedAt: null })
  })

  it('never filters models that lack the column', () => {
    initSoftDeleteRegistry(FAKE_CLIENT)

    for (const model of ['ProcessedCommand', 'LoyaltyTransaction', 'CheckItem']) {
      expect(shouldSoftDeleteFilter(model)).toBe(false)
      const args: { where?: Record<string, unknown> } = { where: { id: 'x' } }
      applySoftDeleteFilter(model, args)
      // No deletedAt key at all — its presence is what Prisma rejects.
      expect(args.where).not.toHaveProperty('deletedAt')
    }
  })

  it('honours semantic exemptions even when the column exists', () => {
    initSoftDeleteRegistry(FAKE_CLIENT)
    // Location has deletedAt but is in NO_SOFT_DELETE_MODELS.
    expect(shouldSoftDeleteFilter('Location')).toBe(false)
  })

  it('does not overwrite an explicit deletedAt filter', () => {
    initSoftDeleteRegistry(FAKE_CLIENT)
    const args = { where: { deletedAt: { not: null } } as Record<string, unknown> }
    applySoftDeleteFilter('MenuItem', args)
    expect(args.where.deletedAt).toEqual({ not: null })
  })

  it('falls back to filtering when the registry is unavailable', () => {
    // Failing open would leak soft-deleted rows, so an unknown client shape
    // must preserve the old always-filter behaviour.
    __setSoftDeleteRegistryForTests(null)
    initSoftDeleteRegistry({})
    expect(shouldSoftDeleteFilter('SomeUnknownModel')).toBe(true)
  })

  it('ignores a client that exposes no models', () => {
    __setSoftDeleteRegistryForTests(null)
    initSoftDeleteRegistry({ _runtimeDataModel: { models: {} } })
    expect(shouldSoftDeleteFilter('MenuItem')).toBe(true)
  })
})

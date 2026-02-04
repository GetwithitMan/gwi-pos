// src/lib/feature-flags.ts
// Centralized feature flag management for gradual rollouts

/**
 * Feature flags for GWI POS.
 *
 * Usage:
 * - Set via environment variables (e.g., FLOOR_PLAN_V2_ENABLED=true)
 * - Can be extended to support per-location flags via database
 *
 * Rollout Strategy:
 * 1. Dev: Enable in .env.local for internal testing
 * 2. Staging: Enable in staging environment for QA
 * 3. Production: Gradual rollout via per-location flags (future)
 * 4. GA: Flip default to true, deprecate v1
 */

export interface FeatureFlags {
  /** Use FloorPlanHomeV2 instead of legacy FloorPlanHome */
  floorPlanV2Enabled: boolean
}

/**
 * Get feature flags from environment variables.
 * Safe to call on both server and client (uses NEXT_PUBLIC_ prefix where needed).
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    floorPlanV2Enabled: process.env.FLOOR_PLAN_V2_ENABLED === 'true',
  }
}

/**
 * Check if Floor Plan V2 is enabled.
 * Can be extended to check per-location settings.
 */
export function isFloorPlanV2Enabled(locationId?: string): boolean {
  // First check environment variable (global override)
  if (process.env.FLOOR_PLAN_V2_ENABLED === 'true') {
    return true
  }

  // Future: Check per-location settings from database
  // This would allow gradual rollout to specific locations
  // if (locationId) {
  //   const locationSettings = await getLocationSettings(locationId)
  //   return locationSettings?.floorPlanV2Enabled ?? false
  // }

  return false
}

/**
 * Feature flag for server components.
 * Use this in page.tsx files or server components.
 */
export const FLOOR_PLAN_V2_ENABLED = process.env.FLOOR_PLAN_V2_ENABLED === 'true'

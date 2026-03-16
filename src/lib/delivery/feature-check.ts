/**
 * Canonical delivery feature resolver.
 * Both MC provisioning AND venue settings must be true for delivery to function.
 *
 * MC features are synced to NUC via config sync and stored in location settings
 * as `deliveryFeatures` object. If never synced (NUC has no feature config),
 * delivery defaults to disabled (fail-closed).
 */

// The MC feature flags that get synced to NUC
export interface DeliveryFeatureFlags {
  deliveryModuleEnabled: boolean
  disableMode: 'active' | 'new_orders_disabled' | 'soft_disabled' | 'fully_disabled' | 'emergency_disabled'
  dispatchBoardProvisioned: boolean
  driverAppProvisioned: boolean
  customerTrackingProvisioned: boolean
  proofOfDeliveryProvisioned: boolean
  exceptionsQueueProvisioned: boolean
  deliveryReportsProvisioned: boolean
  smsNotificationsProvisioned: boolean
  deliveryKdsProvisioned: boolean
  driverDocumentsProvisioned: boolean
  scheduledOrdersProvisioned: boolean
  lastSyncedAt?: string
  lastSyncedVersion?: number
}

export const DEFAULT_DELIVERY_FEATURES: DeliveryFeatureFlags = {
  deliveryModuleEnabled: false,
  disableMode: 'fully_disabled',
  dispatchBoardProvisioned: false,
  driverAppProvisioned: false,
  customerTrackingProvisioned: false,
  proofOfDeliveryProvisioned: false,
  exceptionsQueueProvisioned: false,
  deliveryReportsProvisioned: false,
  smsNotificationsProvisioned: false,
  deliveryKdsProvisioned: false,
  driverDocumentsProvisioned: false,
  scheduledOrdersProvisioned: false,
}

type DeliverySubfeature = keyof Omit<DeliveryFeatureFlags, 'deliveryModuleEnabled' | 'disableMode' | 'lastSyncedAt' | 'lastSyncedVersion'>

/**
 * Single source of truth for whether a delivery feature is active.
 *
 * Checks:
 * 1. MC master flag ON (deliveryModuleEnabled)
 * 2. MC disable mode is 'active' (or allows the operation)
 * 3. Venue delivery settings.enabled ON
 * 4. MC subfeature provisioned (if subfeature specified)
 *
 * @param settings - The location's full settings (from getLocationSettings)
 * @param subfeature - Optional subfeature key to check
 * @param operation - 'new_order' | 'active_operation' | 'tracking' - for disable mode checks
 */
export function isDeliveryFeatureActive(
  settings: { delivery?: { enabled?: boolean }; deliveryFeatures?: Partial<DeliveryFeatureFlags> },
  subfeature?: DeliverySubfeature,
  operation: 'new_order' | 'active_operation' | 'tracking' = 'active_operation'
): boolean {
  const features = { ...DEFAULT_DELIVERY_FEATURES, ...settings.deliveryFeatures }

  // 1. MC master flag
  if (!features.deliveryModuleEnabled) return false

  // 2. Disable mode check
  if (features.disableMode === 'fully_disabled') return false
  if (features.disableMode === 'emergency_disabled') return false
  if (features.disableMode === 'new_orders_disabled' && operation === 'new_order') return false
  if (features.disableMode === 'soft_disabled' && operation === 'new_order') return false

  // 3. Venue operational toggle
  if (!settings.delivery?.enabled) return false

  // 4. Subfeature check
  if (subfeature && !features[subfeature]) return false

  return true
}

/**
 * Check if feature config is stale (>1hr since last sync).
 * Returns true if NUC should show admin warning banner.
 */
export function isFeatureConfigStale(settings: { deliveryFeatures?: Partial<DeliveryFeatureFlags> }): boolean {
  const lastSynced = settings.deliveryFeatures?.lastSyncedAt
  if (!lastSynced) return true // Never synced = stale
  const staleThresholdMs = 60 * 60 * 1000 // 1 hour
  return Date.now() - new Date(lastSynced).getTime() > staleThresholdMs
}

/**
 * Check if emergency mode is active (used for socket suppression, tracking override).
 */
export function isEmergencyDisabled(settings: { deliveryFeatures?: Partial<DeliveryFeatureFlags> }): boolean {
  const features = { ...DEFAULT_DELIVERY_FEATURES, ...settings.deliveryFeatures }
  return features.disableMode === 'emergency_disabled'
}

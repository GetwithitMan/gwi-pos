/**
 * Berg PLU Resolver
 *
 * Resolves a PLU number to a BergPluMapping record.
 *
 * Resolution order (device-first, location-fallback):
 * 1. Try to find a mapping scoped to the specific device: mappingScopeKey = "device:{deviceId}"
 * 2. Fall back to location-scoped mapping: mappingScopeKey = "location:{locationId}"
 *
 * This allows per-device PLU overrides while sharing location defaults.
 */

import { db } from '@/lib/db'
import { resolveVariant } from './modifier'

export interface ResolvedPlu {
  mappingId: string
  pluNumber: number
  description: string | null
  bottleProductId: string | null
  inventoryItemId: string | null
  menuItemId: string | null
  pourSizeOz: number
  /** Whether this is a device-scoped mapping (true) or location fallback (false) */
  isDeviceScoped: boolean
  variantKey: string | null
  variantLabel: string | null
  resolutionStatus: 'NONE' | 'PARTIAL' | 'FULL'
}

const DEFAULT_POUR_SIZE_OZ = 1.5

/**
 * Resolve a PLU number to its mapping for a given device + location.
 * Returns null if no active mapping is found.
 */
export async function resolvePlu(
  pluNumber: number,
  deviceId: string,
  locationId: string,
  modifierBytesHex?: string | null
): Promise<ResolvedPlu | null> {
  // 1. Try device-scoped mapping first
  const deviceScopedKey = `device:${deviceId}`
  const deviceMapping = await db.bergPluMapping.findFirst({
    where: {
      mappingScopeKey: deviceScopedKey,
      pluNumber,
      isActive: true,
    },
  })

  if (deviceMapping) {
    const baseOz = deviceMapping.pourSizeOzOverride
      ? Number(deviceMapping.pourSizeOzOverride)
      : DEFAULT_POUR_SIZE_OZ
    const variant = resolveVariant(deviceMapping.modifierRule, modifierBytesHex, baseOz)
    return {
      mappingId: deviceMapping.id,
      pluNumber: deviceMapping.pluNumber,
      description: deviceMapping.description,
      bottleProductId: deviceMapping.bottleProductId,
      inventoryItemId: deviceMapping.inventoryItemId,
      menuItemId: variant.menuItemIdOverride ?? deviceMapping.menuItemId,
      pourSizeOz: variant.ozResolved ?? baseOz,
      isDeviceScoped: true,
      variantKey: variant.variantKey,
      variantLabel: variant.variantLabel,
      resolutionStatus: variant.resolutionStatus,
    }
  }

  // 2. Fall back to location-scoped mapping
  const locationScopedKey = `location:${locationId}`
  const locationMapping = await db.bergPluMapping.findFirst({
    where: {
      mappingScopeKey: locationScopedKey,
      pluNumber,
      isActive: true,
    },
  })

  if (locationMapping) {
    const baseOz = locationMapping.pourSizeOzOverride
      ? Number(locationMapping.pourSizeOzOverride)
      : DEFAULT_POUR_SIZE_OZ
    const variant = resolveVariant(locationMapping.modifierRule, modifierBytesHex, baseOz)
    return {
      mappingId: locationMapping.id,
      pluNumber: locationMapping.pluNumber,
      description: locationMapping.description,
      bottleProductId: locationMapping.bottleProductId,
      inventoryItemId: locationMapping.inventoryItemId,
      menuItemId: variant.menuItemIdOverride ?? locationMapping.menuItemId,
      pourSizeOz: variant.ozResolved ?? baseOz,
      isDeviceScoped: false,
      variantKey: variant.variantKey,
      variantLabel: variant.variantLabel,
      resolutionStatus: variant.resolutionStatus,
    }
  }

  return null
}

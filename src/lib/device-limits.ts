import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'

export type DeviceType = 'terminal' | 'handheld' | 'cellular' | 'kds' | 'printer'

export interface DeviceLimitCheck {
  allowed: boolean
  limit: number
  current: number
  upgradeMessage: string
}

/**
 * Check if adding another device of the given type would exceed the location's limit.
 * Limits come from LocationSettings.hardwareLimits (synced from MC subscription tier).
 * A limit of 0 means unlimited.
 */
export async function checkDeviceLimit(
  locationId: string,
  deviceType: DeviceType
): Promise<DeviceLimitCheck> {
  // Get location settings for limits
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  const settings = parseSettings(location?.settings)
  const limits = settings.hardwareLimits

  // If no limits configured, allow (backward compat — pre-subscription venues)
  if (!limits) {
    return { allowed: true, limit: 999, current: 0, upgradeMessage: '' }
  }

  let limit: number
  let current: number
  let deviceLabel: string

  switch (deviceType) {
    case 'terminal': {
      limit = limits.maxPOSTerminals
      current = await db.terminal.count({
        where: { locationId, category: 'FIXED_STATION', deletedAt: null, isPaired: true },
      })
      deviceLabel = 'POS terminals'
      break
    }
    case 'handheld': {
      limit = limits.maxHandhelds
      current = await db.terminal.count({
        where: { locationId, category: 'HANDHELD', deletedAt: null, isPaired: true },
      })
      deviceLabel = 'handheld devices'
      break
    }
    case 'cellular': {
      limit = limits.maxCellularDevices
      // Count active cellular sessions from the in-memory registry
      const { getActiveCellularSessions } = await import('@/lib/cellular-auth')
      current = getActiveCellularSessions(locationId).length
      deviceLabel = 'cellular devices'
      break
    }
    case 'kds': {
      limit = limits.maxKDSScreens
      // KDS screens aren't tracked separately in the terminal model yet.
      // Use a generous approach: count is 0 until KDS tracking is formalized.
      current = 0
      deviceLabel = 'KDS screens'
      break
    }
    case 'printer': {
      limit = limits.maxPrinters
      current = await db.printer.count({
        where: { locationId, deletedAt: null },
      })
      deviceLabel = 'printers'
      break
    }
  }

  // 0 means unlimited
  if (limit === 0) {
    return { allowed: true, limit: 0, current, upgradeMessage: '' }
  }

  const allowed = current < limit
  const upgradeMessage = allowed
    ? ''
    : `You've reached the maximum of ${limit} ${deviceLabel} for your current plan. Please upgrade your subscription in Mission Control to add more devices.`

  return { allowed, limit, current, upgradeMessage }
}

/**
 * Get current device counts for a location (used by the admin UI).
 */
export async function getDeviceCounts(locationId: string): Promise<{
  terminals: number
  handhelds: number
  cellular: number
  kds: number
  printers: number
}> {
  const [terminals, handhelds, printers] = await Promise.all([
    db.terminal.count({
      where: { locationId, category: 'FIXED_STATION', deletedAt: null, isPaired: true },
    }),
    db.terminal.count({
      where: { locationId, category: 'HANDHELD', deletedAt: null, isPaired: true },
    }),
    db.printer.count({
      where: { locationId, deletedAt: null },
    }),
  ])

  // Cellular: count from in-memory session registry
  let cellular = 0
  try {
    const { getActiveCellularSessions } = await import('@/lib/cellular-auth')
    cellular = getActiveCellularSessions(locationId).length
  } catch {
    // cellular-auth not available (e.g. edge runtime) — 0 is safe
  }

  return {
    terminals,
    handhelds,
    cellular,
    kds: 0, // KDS screens not separately tracked yet
    printers,
  }
}

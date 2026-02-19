import { db } from '@/lib/db'

type DeviceType = 'terminal' | 'handheld' | 'kdsScreen' | 'printer' | 'paymentReader'

interface LimitCheckResult {
  allowed: boolean
  current: number
  limit: number | null
}

interface SyncAgentStatus {
  hardwareLimits?: {
    terminals?: number
    handhelds?: number
    kdsScreens?: number
    printers?: number
    paymentReaders?: number
  }
}

/**
 * Check whether adding another device of the given type would exceed
 * the subscription limit for this location.
 *
 * Reads limits from the NUC sync-agent status API (http://localhost:8081/status).
 * Fail-open: if limits are unavailable, returns { allowed: true }.
 */
export async function checkDeviceLimit(
  type: DeviceType,
  locationId: string
): Promise<LimitCheckResult> {
  // Fetch limits from sync-agent — fail-open on any error
  let limits: SyncAgentStatus['hardwareLimits'] | undefined
  try {
    const res = await fetch('http://localhost:8081/status', {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const status = (await res.json()) as SyncAgentStatus
      limits = status.hardwareLimits
    }
  } catch {
    // Fail-open: sync-agent not available
    return { allowed: true, current: 0, limit: null }
  }

  if (!limits) {
    return { allowed: true, current: 0, limit: null }
  }

  const limitKey = type === 'terminal' ? 'terminals'
    : type === 'handheld' ? 'handhelds'
    : type === 'kdsScreen' ? 'kdsScreens'
    : type === 'printer' ? 'printers'
    : 'paymentReaders'

  const limit = limits[limitKey]
  if (limit == null) {
    return { allowed: true, current: 0, limit: null }
  }

  const where = { locationId, deletedAt: null }

  let current: number
  switch (type) {
    case 'terminal':
      current = await db.terminal.count({ where: { ...where, category: 'FIXED_STATION' } })
      break
    case 'handheld':
      current = await db.terminal.count({ where: { ...where, category: 'HANDHELD' } })
      break
    case 'kdsScreen':
      current = await db.kDSScreen.count({ where })
      break
    case 'printer':
      current = await db.printer.count({ where })
      break
    case 'paymentReader':
      current = await db.paymentReader.count({ where })
      break
  }

  return {
    allowed: current < limit,
    current,
    limit,
  }
}

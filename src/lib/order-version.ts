/**
 * Order Version Utilities — Optimistic Concurrency Control (Client-Side)
 *
 * The server increments `order.version` on every mutation. Routes that check
 * version return 409 with `{ conflict: true, currentVersion }` when the
 * client's version is stale.
 *
 * Usage:
 *   import { getOrderVersion, handleVersionConflict } from '@/lib/order-version'
 *
 *   // Include version in mutation body:
 *   body: JSON.stringify({ ...data, version: getOrderVersion() })
 *
 *   // After fetch, check for version conflict:
 *   if (!res.ok) {
 *     if (await handleVersionConflict(res, orderId)) return
 *     // ...normal error handling
 *   }
 */

import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'

/**
 * Read the current order version from the Zustand store.
 * Returns undefined if no order is loaded (server ignores undefined).
 */
export function getOrderVersion(): number | undefined {
  return useOrderStore.getState().currentOrder?.version
}

/**
 * Handle a 409 version conflict from an order mutation.
 *
 * - Clones the response to check for `conflict: true` (leaves original consumable)
 * - Refetches the full order to get fresh state + version
 * - Shows a user-friendly toast
 *
 * Returns `true` if it was a version conflict (caller should abort).
 * Returns `false` if it's a different kind of 409 (caller handles normally).
 */
export async function handleVersionConflict(
  res: Response,
  orderId: string
): Promise<boolean> {
  if (res.status !== 409) return false

  // Check if this is specifically a version conflict
  try {
    const clone = res.clone()
    const data = await clone.json()
    if (!data.conflict) return false // Different 409 reason — let caller handle
  } catch {
    return false // Can't parse — not a version conflict
  }

  // Refetch full order to get fresh state + correct version
  try {
    const freshRes = await fetch(`/api/orders/${orderId}`)
    if (freshRes.ok) {
      const raw = await freshRes.json()
      const order = raw.data ?? raw
      useOrderStore.getState().loadOrder(order)
    }
  } catch {
    // Silent — at least the toast will alert the user
  }

  toast.error('Order was updated on another terminal. Please review and try again.')
  return true
}

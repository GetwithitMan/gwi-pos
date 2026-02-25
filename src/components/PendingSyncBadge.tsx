'use client'

import { useEffect, useState } from 'react'
import { OfflineManager } from '@/lib/offline-manager'

/**
 * Displays a small badge with the count of orders/payments
 * pending sync (from IndexedDB offline queue).
 * Shows nothing when count is 0.
 */
export function PendingSyncBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let mounted = true

    async function check() {
      try {
        const n = await OfflineManager.getPendingCount()
        if (mounted) setCount(n)
      } catch {
        // IndexedDB unavailable — silent
      }
    }

    check()

    // Re-check every 10 seconds
    const interval = setInterval(check, 10_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  if (count === 0) return null

  return (
    <div
      title={`${count} item${count !== 1 ? 's' : ''} pending sync`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30"
    >
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {count} pending
    </div>
  )
}

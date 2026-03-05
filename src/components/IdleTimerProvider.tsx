'use client'

import { useEffect, useState } from 'react'
import { useIdleTimer } from '@/hooks/useIdleTimer'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Client component that activates the idle timer for auto-logout (W1-S2).
 * Fetches idleLockMinutes from venue settings on mount, then passes it
 * to useIdleTimer. Renders nothing.
 *
 * Add to root layout alongside other global providers.
 */
export function IdleTimerProvider() {
  const [timeoutMinutes, setTimeoutMinutes] = useState(0)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) return

    const controller = new AbortController()
    fetch('/api/settings', { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(raw => {
        const data = raw?.data ?? raw
        const minutes = data?.settings?.security?.idleLockMinutes
        if (typeof minutes === 'number' && minutes >= 0) {
          setTimeoutMinutes(minutes)
        }
      })
      .catch(() => {/* fail silently — don't break POS */})

    return () => controller.abort()
  }, [isAuthenticated])

  useIdleTimer(timeoutMinutes)
  return null
}

'use client'

import { useIdleTimer } from '@/hooks/useIdleTimer'

/**
 * Client component that activates the idle timer for auto-logout (W1-S2).
 * Renders nothing — just runs the hook.
 * Add to root layout alongside other global providers.
 */
export function IdleTimerProvider() {
  useIdleTimer()
  return null
}

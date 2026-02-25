'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'
import { saveDraftOrder } from '@/lib/draft-order-persistence'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const WARNING_MS = 25 * 60 * 1000 // Warn at 25 minutes
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown', 'keydown', 'touchstart', 'scroll',
]

/**
 * Client-side idle timer for automatic logout (W1-S2).
 *
 * Tracks user activity (mouse, keyboard, touch, scroll).
 * Shows a toast warning at 25 minutes of inactivity.
 * Auto-logs out at 30 minutes and calls the server logout endpoint
 * to clear the httpOnly session cookie.
 *
 * On session expiry, saves any in-progress draft order to localStorage
 * so it can be restored on next login.
 *
 * Use this hook in the main POS layout or auth-guarded pages.
 */
export function useIdleTimer() {
  const router = useRouter()
  const logout = useAuthStore(s => s.logout)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const lastActivityRef = useRef(Date.now())
  const warningShownRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleLogout = useCallback(async () => {
    // Save any in-progress draft order before clearing state
    const auth = useAuthStore.getState()
    const order = useOrderStore.getState().currentOrder
    if (auth.locationId && auth.employee?.id && order && order.items.length > 0) {
      const saved = saveDraftOrder(auth.locationId, auth.employee.id, order)
      if (saved) {
        toast.info('Draft order saved — you can restore it on next login')
      }
    }

    // Clear server-side session cookie
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Logout should succeed even if network fails
    }
    logout()
    router.push('/login')
  }, [logout, router])

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    if (warningShownRef.current) {
      warningShownRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    // Reset on mount
    lastActivityRef.current = Date.now()
    warningShownRef.current = false

    const onActivity = () => {
      resetActivity()
    }

    // Attach activity listeners
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { passive: true })
    }

    // Check idle state every 30 seconds
    timerRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current

      if (idle >= IDLE_TIMEOUT_MS) {
        toast.error('Session expired due to inactivity')
        void handleLogout()
        return
      }

      if (idle >= WARNING_MS && !warningShownRef.current) {
        warningShownRef.current = true
        toast.warning('Session expiring in 5 minutes due to inactivity', 10000)
      }
    }, 30_000)

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, onActivity)
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isAuthenticated, resetActivity, handleLogout])
}

'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'
import { saveDraftOrder } from '@/lib/draft-order-persistence'

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown', 'keydown', 'touchstart', 'scroll',
]

/**
 * Client-side idle timer for automatic logout (W1-S2).
 *
 * Tracks user activity (mouse, keyboard, touch, scroll).
 * Shows a toast warning 5 minutes before logout.
 * Auto-logs out after the configured idle period and calls the server
 * logout endpoint to clear the httpOnly session cookie.
 *
 * On session expiry, saves any in-progress draft order to localStorage
 * so it can be restored on next login.
 *
 * @param timeoutMinutes - Minutes of inactivity before auto-logout. 0 = disabled.
 *                         Sourced from SecuritySettings.idleLockMinutes.
 */
export function useIdleTimer(timeoutMinutes: number = 0) {
  const router = useRouter()
  const logout = useAuthStore(s => s.logout)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const lastActivityRef = useRef<number>(0)
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
    // Disabled: 0 means no idle timer, or not authenticated
    if (!isAuthenticated || timeoutMinutes <= 0) return

    const timeoutMs = timeoutMinutes * 60 * 1000
    // Warn 5 minutes before logout, but if total is <=5 min warn at 80%
    const warningMs = timeoutMinutes > 5
      ? timeoutMs - 5 * 60 * 1000
      : timeoutMs * 0.8

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

    // Check idle state every 30 seconds + auto-save draft order
    timerRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current

      if (idle >= timeoutMs) {
        toast.error('Session expired due to inactivity')
        void handleLogout()
        return
      }

      if (idle >= warningMs && !warningShownRef.current) {
        warningShownRef.current = true
        const remaining = Math.ceil((timeoutMs - idle) / 60000)
        toast.warning(`Session expiring in ${remaining} minute${remaining !== 1 ? 's' : ''} due to inactivity`, 10000)
      }

      // Periodic auto-save: persist in-progress draft every 30s (silent, no toast)
      const auth = useAuthStore.getState()
      const order = useOrderStore.getState().currentOrder
      if (auth.locationId && auth.employee?.id && order && order.items.length > 0) {
        saveDraftOrder(auth.locationId, auth.employee.id, order)
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
  }, [isAuthenticated, timeoutMinutes, resetActivity, handleLogout])
}

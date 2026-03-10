'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

interface AuthGuardOptions {
  redirectUrl?: string
}

/**
 * Shared hydration guard for Zustand persist middleware.
 *
 * Zustand persist starts with defaults (isAuthenticated=false) before
 * rehydrating from localStorage. Without this guard, the auth redirect
 * fires immediately on mount before the real auth state loads — causing
 * users to get logged out on every page refresh.
 *
 * Usage:
 *   const hydrated = useAuthenticationGuard()
 *   if (!hydrated) return null
 */
export function useAuthenticationGuard(options?: AuthGuardOptions) {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const employee = useAuthStore(s => s.employee)
  const redirectUrl = options?.redirectUrl ?? '/login'

  // Wait for Zustand persist to finish rehydrating from localStorage.
  // A one-tick wait (setHydrated in an empty useEffect) is not safe — Zustand 5
  // persist rehydrates asynchronously and may not be done after one render cycle.
  // Using onFinishHydration guarantees the real auth state is present before
  // the redirect guard runs, preventing false logouts on page refresh.
  const [hydrated, setHydrated] = useState(
    () => useAuthStore.persist?.hasHydrated?.() ?? false
  )
  useEffect(() => {
    if (!useAuthStore.persist) return
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true))
  }, [])

  // Only redirect after hydration confirms auth is truly missing
  useEffect(() => {
    if (hydrated && (!employee || !isAuthenticated)) {
      router.push(redirectUrl)
    }
  }, [hydrated, employee, isAuthenticated, router, redirectUrl])

  return hydrated
}

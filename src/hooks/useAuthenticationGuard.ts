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

  // Wait one tick for Zustand to rehydrate from localStorage
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  // Only redirect after hydration confirms auth is truly missing
  useEffect(() => {
    if (hydrated && (!employee || !isAuthenticated)) {
      router.push(redirectUrl)
    }
  }, [hydrated, employee, isAuthenticated, router, redirectUrl])

  return hydrated
}

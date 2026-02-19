'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Hydration guard for Zustand persist middleware.
 *
 * Zustand persist starts with defaults (isAuthenticated=false) before
 * rehydrating from localStorage. Without this guard, auth redirects fire
 * immediately on mount before the real auth state loads.
 *
 * Returns `isReady: true` only after hydration completes AND the user
 * is authenticated with an employee record. Redirects to /login if
 * hydrated but not authenticated.
 */
export function useAuthGuard() {
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const router = useRouter()

  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hydrated, isAuthenticated, router])

  return {
    isReady: hydrated && isAuthenticated && !!employee,
    employee,
    isAuthenticated,
    hydrated,
  }
}

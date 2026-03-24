'use client'

/**
 * useSiteAuth — Client hook for customer portal authentication.
 *
 * Checks session via httpOnly cookie (server-validated), provides
 * auth state, logout, and refresh. Uses the check-session action
 * on the portal auth API.
 */

import { useState, useEffect, useCallback } from 'react'

interface CustomerData {
  id: string
  name: string
  email: string | null
  phone: string | null
  loyaltyPoints: number
}

interface SiteAuth {
  isAuthenticated: boolean
  customer: CustomerData | null
  isLoading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export function useSiteAuth(slug: string): SiteAuth {
  const [customer, setCustomer] = useState<CustomerData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const checkSession = useCallback(async () => {
    if (!slug) {
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/public/portal/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check-session' }),
      })

      if (!res.ok) {
        setCustomer(null)
        return
      }

      const data = await res.json()
      if (data.authenticated && data.customer) {
        setCustomer(data.customer)
      } else {
        setCustomer(null)
      }
    } catch {
      setCustomer(null)
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    checkSession()
  }, [checkSession])

  const logout = useCallback(async () => {
    if (!slug) return
    try {
      await fetch(`/api/public/portal/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      })
    } catch {
      // Best effort
    }
    setCustomer(null)
  }, [slug])

  return {
    isAuthenticated: customer !== null,
    customer,
    isLoading,
    logout,
    refresh: checkSession,
  }
}

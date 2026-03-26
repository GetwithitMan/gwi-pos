'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { isAdmin } from '@/lib/auth-utils'

/**
 * Fetches payment environment from /api/payment-config and shows an amber
 * "TEST MODE" banner when cert credentials are active.
 * Only visible to admin/manager roles — basic staff should never see cert status.
 * Rendered once at POS startup — zero render cost in production mode.
 */
export function TestModeBanner() {
  const [isTestMode, setIsTestMode] = useState(false)
  const permissions = useAuthStore(s => {
    const p = s.employee?.permissions
    return Array.isArray(p) ? p : []
  })

  // Only show test mode banner to admins/managers
  const canSeeTestMode = isAdmin(permissions) ||
    permissions.includes('manager') ||
    permissions.includes('settings.payments')

  useEffect(() => {
    if (!canSeeTestMode) return
    fetch('/api/payment-config')
      .then(r => r.json())
      .then(({ data }) => setIsTestMode(data?.isTestMode === true))
      .catch(err => console.warn('payment config fetch failed:', err))
  }, [canSeeTestMode])

  if (!isTestMode || !canSeeTestMode) return null

  return (
    <div className="w-full bg-amber-500 text-amber-950 text-center text-xs font-semibold py-0.5 tracking-wide select-none">
      ⚠ TEST MODE — Datacap cert credentials active. No real charges will be processed.
    </div>
  )
}

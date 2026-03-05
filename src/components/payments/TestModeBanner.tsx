'use client'

import { useEffect, useState } from 'react'

/**
 * Fetches payment environment from /api/payment-config and shows an amber
 * "TEST MODE" banner when cert credentials are active.
 * Rendered once at POS startup — zero render cost in production mode.
 */
export function TestModeBanner() {
  const [isTestMode, setIsTestMode] = useState(false)

  useEffect(() => {
    fetch('/api/payment-config')
      .then(r => r.json())
      .then(({ data }) => setIsTestMode(data?.isTestMode === true))
      .catch(() => {/* silently ignore — don't break POS */})
  }, [])

  if (!isTestMode) return null

  return (
    <div className="w-full bg-amber-500 text-amber-950 text-center text-xs font-semibold py-0.5 tracking-wide select-none">
      ⚠ TEST MODE — Datacap cert credentials active. No real charges will be processed.
    </div>
  )
}

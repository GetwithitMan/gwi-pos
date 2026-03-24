'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export interface SiteMode {
  isQR: boolean
  tableId: string | null
  tableSection: string | null
  mode: 'site' | 'qr'
}

const DEFAULT_MODE: SiteMode = { isQR: false, tableId: null, tableSection: null, mode: 'site' }

export function useSiteMode(): SiteMode {
  const searchParams = useSearchParams()
  const [siteMode, setSiteMode] = useState<SiteMode>(DEFAULT_MODE)

  useEffect(() => {
    // Check for signed context token
    const ctx = searchParams.get('ctx')
    if (ctx) {
      try {
        const [encoded] = ctx.split('.')
        if (encoded) {
          // base64url → base64 for atob
          const payload = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))
          if (payload.table) {
            const mode: SiteMode = {
              isQR: true,
              tableId: payload.table,
              tableSection: payload.section || null,
              mode: 'qr',
            }
            setSiteMode(mode)
            sessionStorage.setItem('site-qr-context', JSON.stringify(mode))
            return
          }
        }
      } catch {
        /* fall through */
      }
    }

    // Check unsigned dev mode (?table=T5&qr=1)
    const table = searchParams.get('table')
    const qr = searchParams.get('qr')
    if (table && qr === '1') {
      const mode: SiteMode = { isQR: true, tableId: table, tableSection: null, mode: 'qr' }
      setSiteMode(mode)
      sessionStorage.setItem('site-qr-context', JSON.stringify(mode))
      return
    }

    // Check sessionStorage for persisted QR context
    try {
      const stored = sessionStorage.getItem('site-qr-context')
      if (stored) {
        setSiteMode(JSON.parse(stored))
        return
      }
    } catch {
      /* SSR or sessionStorage unavailable */
    }
  }, [searchParams])

  return siteMode
}

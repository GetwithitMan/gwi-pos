'use client'

/**
 * SiteShell — Thin client wrapper around the site layout.
 *
 * Reads QR context from URL params and provides it to children via
 * a React context. Handles QR-mode redirect (/ → /menu) and sets
 * the cart store's orderType + tableContext when in QR mode.
 */

import { createContext, useContext, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useSiteMode, type SiteMode } from '@/hooks/useSiteMode'
import { useSiteCartStore } from '@/stores/site-cart-store'

interface SiteModeWithSlug extends SiteMode {
  slug: string
}

const SiteModeContext = createContext<SiteModeWithSlug>({
  isQR: false,
  tableId: null,
  tableSection: null,
  mode: 'site',
  slug: '',
})

export const useSiteModeContext = () => useContext(SiteModeContext)

export function SiteShell({ children, slug = '' }: { children: React.ReactNode; slug?: string }) {
  const siteMode = useSiteMode()
  const pathname = usePathname()
  const router = useRouter()
  const setOrderType = useSiteCartStore((s) => s.setOrderType)
  const setTableContext = useSiteCartStore((s) => s.setTableContext)

  // QR mode: redirect homepage to /menu
  useEffect(() => {
    if (siteMode.isQR && pathname === '/') {
      router.replace('/menu')
    }
  }, [siteMode.isQR, pathname, router])

  // QR mode: set cart order type + table context
  useEffect(() => {
    if (siteMode.isQR && siteMode.tableId) {
      setOrderType('dine_in')
      setTableContext({
        table: siteMode.tableId,
        ...(siteMode.tableSection ? { section: siteMode.tableSection } : {}),
      })
    }
  }, [siteMode.isQR, siteMode.tableId, siteMode.tableSection, setOrderType, setTableContext])

  return (
    <SiteModeContext.Provider value={{ ...siteMode, slug }}>
      <div data-qr-mode={siteMode.isQR ? '' : undefined}>
        {children}
      </div>
    </SiteModeContext.Provider>
  )
}

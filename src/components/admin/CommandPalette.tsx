'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'

// All navigable pages — matches AdminNav's nav sections
const ALL_PAGES = [
  // POS
  { name: 'Floor Plan', path: '/orders', section: 'POS', keywords: ['floor', 'table', 'map', 'pos', 'orders'] },
  { name: 'Kitchen Display', path: '/kds', section: 'POS', keywords: ['kds', 'kitchen', 'display'] },
  // Inventory
  { name: 'Quick 86', path: '/86', section: 'Inventory', keywords: ['86', 'out', 'stock', 'unavailable'] },
  { name: 'Food Inventory', path: '/inventory', section: 'Inventory', keywords: ['food', 'inventory', 'stock', 'count'] },
  { name: 'Liquor Inventory', path: '/inventory/beverages', section: 'Inventory', keywords: ['liquor', 'beverage', 'bar', 'drink'] },
  { name: 'Inventory Counts', path: '/inventory/counts', section: 'Inventory', keywords: ['count', 'stocktake'] },
  { name: 'Waste Log', path: '/inventory/waste', section: 'Inventory', keywords: ['waste', 'spoil', 'loss'] },
  { name: 'Vendors', path: '/inventory/vendors', section: 'Inventory', keywords: ['vendor', 'supplier', 'purchase'] },
  // Menu Builder
  { name: 'Menu Items', path: '/menu', section: 'Menu Builder', keywords: ['menu', 'item', 'food', 'builder'] },
  { name: 'Combos', path: '/combos', section: 'Menu Builder', keywords: ['combo', 'meal', 'deal', 'bundle'] },
  { name: 'Discounts', path: '/discounts', section: 'Menu Builder', keywords: ['discount', 'promo', 'sale'] },
  // Floor & Tables
  { name: 'Floor Plan Editor', path: '/floorplan/editor', section: 'Floor & Tables', keywords: ['floor', 'plan', 'editor', 'layout'] },
  { name: 'Reservations', path: '/reservations', section: 'Floor & Tables', keywords: ['reservation', 'booking', 'table'] },
  { name: 'Timed Rentals', path: '/timed-rentals', section: 'Floor & Tables', keywords: ['timed', 'rental', 'entertainment', 'game'] },
  { name: 'Events', path: '/events', section: 'Floor & Tables', keywords: ['event', 'special'] },
  // Customers
  { name: 'Customer List', path: '/customers', section: 'Customers', keywords: ['customer', 'guest', 'patron', 'list'] },
  { name: 'Gift Cards', path: '/gift-cards', section: 'Customers', keywords: ['gift', 'card', 'store credit'] },
  { name: 'House Accounts', path: '/house-accounts', section: 'Customers', keywords: ['house', 'account', 'credit'] },
  { name: 'Coupons', path: '/coupons', section: 'Customers', keywords: ['coupon', 'promo', 'code'] },
  // Team
  { name: 'Employees', path: '/employees', section: 'Team', keywords: ['employee', 'staff', 'team', 'worker'] },
  { name: 'Roles & Permissions', path: '/roles', section: 'Team', keywords: ['role', 'permission', 'access', 'security'] },
  { name: 'Scheduling', path: '/scheduling', section: 'Team', keywords: ['schedule', 'shift', 'calendar'] },
  { name: 'Payroll', path: '/payroll', section: 'Team', keywords: ['payroll', 'pay', 'wage', 'salary'] },
  // Reports
  { name: 'My Shift', path: '/reports/shift', section: 'Reports', keywords: ['shift', 'my', 'personal'] },
  { name: 'My Commissions', path: '/reports/commission', section: 'Reports', keywords: ['commission', 'earnings'] },
  { name: 'Open Orders', path: '/orders/manager', section: 'Reports', keywords: ['open', 'active', 'manager'] },
  { name: 'Reports Hub', path: '/reports', section: 'Reports', keywords: ['report', 'hub', 'analytics'] },
  { name: 'Daily Summary', path: '/reports/daily', section: 'Reports', keywords: ['daily', 'summary', 'eod', 'end of day'] },
  { name: 'Sales Report', path: '/reports/sales', section: 'Reports', keywords: ['sales', 'revenue', 'income'] },
  { name: 'Product Mix', path: '/reports/product-mix', section: 'Reports', keywords: ['product', 'mix', 'pmix', 'popular'] },
  { name: 'Order History', path: '/reports/order-history', section: 'Reports', keywords: ['order', 'history', 'past'] },
  { name: 'Tips Report', path: '/reports/tips', section: 'Reports', keywords: ['tip', 'gratuity'] },
  { name: 'Tip Groups', path: '/tip-groups', section: 'Reports', keywords: ['tip', 'group', 'pool'] },
  { name: 'Employee Reports', path: '/reports/employees', section: 'Reports', keywords: ['employee', 'staff', 'labor'] },
  { name: 'Voids & Comps', path: '/reports/voids', section: 'Reports', keywords: ['void', 'comp', 'refund'] },
  { name: 'Reservations Report', path: '/reports/reservations', section: 'Reports', keywords: ['reservation', 'booking'] },
  { name: 'Coupons Report', path: '/reports/coupons', section: 'Reports', keywords: ['coupon', 'promo'] },
  { name: 'Liquor Report', path: '/reports/liquor', section: 'Reports', keywords: ['liquor', 'pour', 'spirit'] },
  { name: 'Payroll Report', path: '/reports/payroll', section: 'Reports', keywords: ['payroll', 'labor', 'cost'] },
  // Settings
  { name: 'General Settings', path: '/settings', section: 'Settings', keywords: ['settings', 'general', 'config'] },
  { name: 'Order Types', path: '/settings/order-types', section: 'Settings', keywords: ['order', 'type', 'dine', 'takeout'] },
  { name: 'Tax Rules', path: '/tax-rules', section: 'Settings', keywords: ['tax', 'rate', 'rule'] },
  { name: 'Tip-Out Rules', path: '/settings/tip-outs', section: 'Settings', keywords: ['tip', 'out', 'share', 'pool'] },
  { name: 'Hardware', path: '/settings/hardware', section: 'Settings', keywords: ['hardware', 'device'] },
  { name: 'Printers', path: '/settings/hardware/printers', section: 'Settings', keywords: ['printer', 'print', 'receipt'] },
  { name: 'KDS Screens', path: '/settings/hardware/kds-screens', section: 'Settings', keywords: ['kds', 'screen', 'kitchen'] },
  { name: 'Print Routing', path: '/settings/hardware/routing', section: 'Settings', keywords: ['print', 'route', 'routing'] },
  { name: 'Terminals', path: '/settings/hardware/terminals', section: 'Settings', keywords: ['terminal', 'device', 'station'] },
  { name: 'Payment Readers', path: '/settings/hardware/payment-readers', section: 'Settings', keywords: ['payment', 'reader', 'card', 'chip'] },
]

const RECENT_KEY = 'gwi-pos-recent-pages'
const MAX_RECENT = 5

function getRecentPages(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function addRecentPage(path: string) {
  try {
    const recent = getRecentPages().filter(p => p !== path)
    recent.unshift(path)
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
  } catch {
    // localStorage unavailable
  }
}

function fuzzyMatch(query: string, text: string): { match: boolean; score: number } {
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // Exact substring match — highest score
  if (t.includes(q)) {
    return { match: true, score: 100 - t.indexOf(q) }
  }

  // Fuzzy: chars appear in order
  let qi = 0
  let consecutiveBonus = 0
  let lastMatchIdx = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (ti === lastMatchIdx + 1) consecutiveBonus += 10
      lastMatchIdx = ti
      qi++
    }
  }

  if (qi === q.length) {
    return { match: true, score: 50 + consecutiveBonus - lastMatchIdx }
  }

  return { match: false, score: 0 }
}

function searchPages(query: string) {
  if (!query.trim()) return []

  const results: { page: typeof ALL_PAGES[0]; score: number }[] = []

  for (const page of ALL_PAGES) {
    // Check name
    const nameMatch = fuzzyMatch(query, page.name)
    if (nameMatch.match) {
      results.push({ page, score: nameMatch.score + 20 }) // Name match gets bonus
      continue
    }

    // Check section
    const sectionMatch = fuzzyMatch(query, page.section)
    if (sectionMatch.match) {
      results.push({ page, score: sectionMatch.score })
      continue
    }

    // Check keywords
    let bestKeywordScore = 0
    for (const kw of page.keywords) {
      const kwMatch = fuzzyMatch(query, kw)
      if (kwMatch.match && kwMatch.score > bestKeywordScore) {
        bestKeywordScore = kwMatch.score
      }
    }
    if (bestKeywordScore > 0) {
      results.push({ page, score: bestKeywordScore + 10 })
    }
  }

  return results.sort((a, b) => b.score - a.score).map(r => r.page)
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Results: search results or recent pages
  const results = useMemo(() => {
    if (query.trim()) return searchPages(query)

    const recent = getRecentPages()
    return recent
      .map(path => ALL_PAGES.find(p => p.path === path))
      .filter(Boolean) as typeof ALL_PAGES
  }, [query])

  const isShowingRecent = !query.trim()

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // Navigate to page
  const navigateTo = useCallback((path: string) => {
    addRecentPage(path)
    onClose()
    router.push(path)
  }, [router, onClose])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            navigateTo(results[selectedIndex].path)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, results, selectedIndex, navigateTo, onClose])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Track current page for recent pages
  useEffect(() => {
    if (pathname) addRecentPage(pathname)
  }, [pathname])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages..."
            className="flex-1 text-base text-gray-900 placeholder-gray-400 bg-transparent border-none outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-xs text-gray-400 bg-gray-100 rounded border border-gray-200">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              {query ? 'No pages found' : 'No recent pages'}
            </div>
          ) : (
            <>
              {isShowingRecent && results.length > 0 && (
                <div className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Recent
                </div>
              )}
              {results.map((page, i) => (
                <button
                  key={page.path}
                  onClick={() => navigateTo(page.path)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIndex
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{page.name}</div>
                    <div className="text-xs text-gray-400 truncate">{page.section} &middot; {page.path}</div>
                  </div>
                  {i === selectedIndex && (
                    <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-xs text-gray-400 bg-gray-100 rounded border border-gray-200">
                      &crarr;
                    </kbd>
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">&uarr;&darr;</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">&crarr;</kbd>
            Open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">Esc</kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook for global keyboard shortcuts.
 * Opens CommandPalette with Cmd/Ctrl+K.
 * Cmd/Ctrl+1-3 for quick navigation (only on admin pages).
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => !prev)
        return
      }

      // Number shortcuts only when not typing
      if (isInput) return

      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault()
        addRecentPage('/orders')
        router.push('/orders')
      } else if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault()
        addRecentPage('/menu')
        router.push('/menu')
      } else if ((e.metaKey || e.ctrlKey) && e.key === '3') {
        e.preventDefault()
        addRecentPage('/reports')
        router.push('/reports')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  return { isOpen, setIsOpen, close: () => setIsOpen(false) }
}

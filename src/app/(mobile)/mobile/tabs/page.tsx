'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MobileTabCard from '@/components/mobile/MobileTabCard'
import { useEvents } from '@/lib/events/use-events'

interface MobileTab {
  id: string
  tabName: string | null
  tabNickname: string | null
  tabStatus: string | null
  orderNumber: number
  total: number
  itemCount: number
  openedAt: string
  isBottleService: boolean
  preAuth: {
    cardBrand: string
    last4: string
    amount: number | null
  } | null
  cards: Array<{
    cardType: string
    cardLast4: string
    authAmount: number
    isDefault: boolean
    status: string
  }>
}

export default function MobileTabsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <MobileTabsContent />
    </Suspense>
  )
}

function MobileTabsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // locationId is used for the login redirect; kept as a query param so the
  // login page can be reached from a QR code that embeds the locationId.
  const locationId = searchParams.get('locationId') ?? ''

  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<MobileTab[]>([])
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)
  const [filter, setFilter] = useState<'mine' | 'all'>('mine')
  const { isConnected, subscribe } = useEvents({})

  // Verify session cookie on mount. Redirect to login if not authenticated.
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/mobile/device/auth')
        if (res.ok) {
          const data = await res.json()
          setEmployeeId(data.data.employeeId)
          setAuthChecked(true)
          return
        }
      } catch {
        // network error — fall through to redirect
      }

      // No valid session: redirect to login
      const loginUrl = locationId
        ? `/mobile/login?locationId=${locationId}`
        : '/mobile/login'
      router.replace(loginUrl)
    }

    checkAuth()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTabs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: 'open' })
      const res = await fetch(`/api/tabs?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTabs(data.tabs || [])
      }
    } catch (err) {
      console.error('Failed to load tabs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadTabs()
  }, [authChecked, loadTabs])

  // Socket-driven updates
  useEffect(() => {
    if (!isConnected) return
    const unsubs: (() => void)[] = []
    unsubs.push(subscribe('order:created' as never, () => loadTabs()))
    unsubs.push(subscribe('order:updated' as never, () => loadTabs()))
    unsubs.push(subscribe('payment:processed' as never, () => loadTabs()))
    unsubs.push(subscribe('tab:updated' as never, () => loadTabs()))
    return () => unsubs.forEach(u => u())
  }, [isConnected, subscribe, loadTabs])

  // 20s disconnected-only fallback
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(loadTabs, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, loadTabs])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadTabs()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [loadTabs])

  // Don't render until auth is resolved
  if (!authChecked) {
    return <div className="min-h-screen bg-gray-950" />
  }

  const filteredTabs = filter === 'all' ? tabs : tabs

  // Sort: pending first, then by time
  const sortedTabs = [...filteredTabs].sort((a, b) => {
    const aPending = a.tabStatus === 'pending_auth' ? 0 : 1
    const bPending = b.tabStatus === 'pending_auth' ? 0 : 1
    if (aPending !== bPending) return aPending - bPending
    return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
  })

  const getDisplayName = (tab: MobileTab): string => {
    if (tab.tabNickname) return tab.tabNickname
    if (tab.tabName) return tab.tabName
    return `Tab #${tab.orderNumber}`
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h1 className="text-xl font-bold">My Tabs</h1>
        <div className="flex items-center gap-3">
          <a
            href={locationId ? `/mobile/schedule?locationId=${locationId}` : '/mobile/schedule'}
            className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Schedule
          </a>
          <span className="text-white/40 text-sm">{sortedTabs.length} open</span>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-2 border-b border-white/10">
        <button
          onClick={() => setFilter('mine')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors
            ${filter === 'mine' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
        >
          Mine
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors
            ${filter === 'all' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
        >
          All
        </button>
      </div>

      {/* Tab List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedTabs.length === 0 ? (
          <div className="text-center py-12 text-white/40">
            <p className="text-lg">No open tabs</p>
          </div>
        ) : (
          sortedTabs.map(tab => (
            <MobileTabCard
              key={tab.id}
              tab={{
                ...tab,
                displayName: getDisplayName(tab),
              }}
              onTap={() => {
                window.location.href = `/mobile/tabs/${tab.id}`
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}

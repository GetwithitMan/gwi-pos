'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthGuard } from '@/hooks/useAuthGuard'
import { useEvents } from '@/lib/events/use-events'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency, formatTime } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'

interface TabOrder {
  id: string
  orderNumber: number
  tabName: string | null
  customerName: string | null
  cardLast4: string | null
  total: number
  itemCount: number
  openedAt: string
  employeeId: string
  employeeName: string
  status: 'open' | 'closed' | 'void'
  tabStatus?: string | null
  items: {
    id: string
    name: string
    quantity: number
    price: number
  }[]
}

type FilterOption = 'all' | 'mine' | 'over50' | 'over1hr' | 'declined'
type SortOption = 'recent' | 'oldest' | 'highest' | 'lowest' | 'name'

export default function TabsPage() {
  const router = useRouter()
  const { isReady, employee, isAuthenticated } = useAuthGuard()
  const logout = useAuthStore(s => s.logout)
  const [tabs, setTabs] = useState<TabOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<FilterOption>('all')
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [selectedTab, setSelectedTab] = useState<TabOrder | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [isClosingTab, setIsClosingTab] = useState(false)

  const { subscribe, isConnected } = useEvents()

  // Load tabs on mount
  useEffect(() => {
    if (employee?.location?.id) {
      loadTabs()
    }
  }, [employee?.location?.id])

  // Socket-driven refresh: subscribe to events that affect tab list
  useEffect(() => {
    if (!isConnected) return

    const unsubs = [
      subscribe('order:created', () => loadTabs()),
      subscribe('order:updated', () => loadTabs()),
      subscribe('payment:processed', () => loadTabs()),
      subscribe('tab:updated', () => loadTabs()),
      subscribe('orders:list-changed', () => loadTabs()),
    ]

    return () => unsubs.forEach(unsub => unsub())
  }, [isConnected, subscribe])

  // 20s fallback polling only when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    if (!employee?.location?.id) return

    const fallback = setInterval(loadTabs, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, employee?.location?.id])

  // Instant refresh on tab visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && employee?.location?.id) {
        loadTabs()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [employee?.location?.id])

  const loadTabs = async () => {
    if (!employee?.location?.id) return

    try {
      const res = await fetch(`/api/orders?locationId=${employee?.location?.id}&orderType=bar_tab&status=open`)
      if (res.ok) {
        const data = await res.json()
        setTabs(data.data?.orders || [])
      }
    } catch (error) {
      console.error('[TabsPage] Failed to load tabs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Filter and sort tabs
  const filteredTabs = tabs
    .filter(tab => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = tab.tabName?.toLowerCase().includes(query) ||
                          tab.customerName?.toLowerCase().includes(query)
        const matchesCard = tab.cardLast4?.includes(query)
        const matchesAmount = tab.total.toString().includes(query)
        if (!matchesName && !matchesCard && !matchesAmount) return false
      }

      // Category filter
      if (filter === 'mine' && tab.employeeId !== employee?.id) return false
      if (filter === 'over50' && tab.total < 50) return false
      if (filter === 'declined' && tab.tabStatus !== 'declined_capture') return false
      if (filter === 'over1hr') {
        const openedAt = new Date(tab.openedAt)
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
        if (openedAt > hourAgo) return false
      }

      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'recent':
          return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        case 'oldest':
          return new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
        case 'highest':
          return b.total - a.total
        case 'lowest':
          return a.total - b.total
        case 'name':
          return (a.tabName || a.customerName || '').localeCompare(b.tabName || b.customerName || '')
        default:
          return 0
      }
    })

  const handleViewTab = useCallback((tab: TabOrder) => {
    setSelectedTab(tab)
  }, [])

  const handleCloseTab = useCallback(async (tab: TabOrder) => {
    // Navigate to orders page with the tab loaded for payment
    router.push(`/orders?tabId=${tab.id}`)
  }, [router])

  const handleNewTab = useCallback(() => {
    router.push('/orders?newTab=true')
  }, [router])

  const handleBackToFloorPlan = useCallback(() => {
    router.push('/orders')
  }, [router])

  // Calculate time open
  const getTimeOpen = (openedAt: string) => {
    const opened = new Date(openedAt)
    const now = new Date()
    const diffMs = now.getTime() - opened.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 60) return `${diffMins}m`
    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    return `${hours}h ${mins}m`
  }

  if (!isReady) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBackToFloorPlan}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">Open Tabs</h1>
                <p className="text-sm text-slate-400">
                  {filteredTabs.length} tabs • {employee?.displayName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/reports/order-history?status=closed&orderType=bar_tab')}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Closed Tabs
              </button>
              <button
                onClick={handleNewTab}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-white font-medium transition-colors"
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Tab
              </button>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, card, amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2">
              {[
                { id: 'all', label: 'All' },
                { id: 'mine', label: 'Mine' },
                { id: 'over50', label: 'Over $50' },
                { id: 'over1hr', label: 'Over 1hr' },
                { id: 'declined', label: 'Declined' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setFilter(opt.id as FilterOption)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === opt.id
                      ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                      : 'bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500/50"
            >
              <option value="recent">Most Recent</option>
              <option value="oldest">Oldest First</option>
              <option value="highest">Highest Total</option>
              <option value="lowest">Lowest Total</option>
              <option value="name">By Name</option>
            </select>
          </div>
        </div>
      </header>

      {/* Tabs List */}
      <main className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-slate-400">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
          </div>
        ) : filteredTabs.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mx-auto mb-4 opacity-50">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-lg font-medium">No open tabs</p>
            <p className="text-sm mt-1">Create a new tab to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filteredTabs.map((tab) => (
                <motion.div
                  key={tab.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/[0.07] transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">
                          {tab.tabName || tab.customerName || `Tab #${tab.orderNumber}`}
                        </h3>
                        {tab.cardLast4 && (
                          <span className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300">
                            ****{tab.cardLast4}
                          </span>
                        )}
                        {tab.employeeId !== employee?.id && (
                          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs">
                            {tab.employeeName}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-sm text-slate-400">
                        <span>{tab.itemCount} items</span>
                        <span>•</span>
                        <span>Started {getTimeOpen(tab.openedAt)} ago</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-2xl font-bold text-green-400">
                          {formatCurrency(tab.total)}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleViewTab(tab)}
                          className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleCloseTab(tab)}
                          className="px-4 py-2 bg-indigo-600/30 border border-indigo-500/50 rounded-lg text-indigo-300 hover:bg-indigo-600/40 transition-colors"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Tab Detail Modal */}
      <Modal isOpen={!!selectedTab} onClose={() => setSelectedTab(null)} title={selectedTab?.tabName || selectedTab?.customerName || (selectedTab ? `Tab #${selectedTab.orderNumber}` : '')} size="lg">
        {selectedTab && (
          <>
            <p className="text-sm text-gray-400 -mt-2 mb-4">
              {selectedTab.itemCount} items • {selectedTab.employeeName}
            </p>

            {/* Items */}
            <div className="space-y-3 mb-6">
              {selectedTab.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between">
                  <div>
                    <span className="text-gray-900">{item.name}</span>
                    {item.quantity > 1 && (
                      <span className="ml-2 text-gray-400">x{item.quantity}</span>
                    )}
                  </div>
                  <span className="text-green-600 font-medium">
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-500">Total</span>
                <span className="text-2xl font-bold text-green-600">
                  {formatCurrency(selectedTab.total)}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    router.push(`/orders?tabId=${selectedTab.id}&addItems=true`)
                  }}
                  className="flex-1 px-4 py-3 bg-gray-100 border border-gray-200 rounded-lg text-gray-700 font-medium hover:bg-gray-200 transition-colors"
                >
                  Add Items
                </button>
                <button
                  onClick={() => handleCloseTab(selectedTab)}
                  className="flex-1 px-4 py-3 bg-indigo-600 rounded-lg text-white font-medium hover:bg-indigo-700 transition-colors"
                >
                  Close Tab
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

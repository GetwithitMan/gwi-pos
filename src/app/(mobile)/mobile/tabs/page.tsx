'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import MobileTabCard from '@/components/mobile/MobileTabCard'

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
  const searchParams = useSearchParams()
  const employeeId = searchParams.get('employeeId')

  const [tabs, setTabs] = useState<MobileTab[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'mine' | 'all'>('mine')

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
    loadTabs()
    // Poll every 10s for updates
    const interval = setInterval(loadTabs, 10000)
    return () => clearInterval(interval)
  }, [loadTabs])

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
        <span className="text-white/40 text-sm">{sortedTabs.length} open</span>
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
                window.location.href = `/mobile/tabs/${tab.id}?employeeId=${employeeId}`
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}

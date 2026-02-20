'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'
import { PendingTabAnimation } from './PendingTabAnimation'
import { AuthStatusBadge } from './AuthStatusBadge'
import { MultiCardBadges } from './MultiCardBadges'
import BottleServiceBanner from './BottleServiceBanner'
import { useEvents } from '@/lib/events/use-events'

interface TabCard {
  id: string
  cardType: string
  cardLast4: string
  cardholderName: string | null
  isDefault: boolean
  status: string
  authAmount: number
  recordNo?: string | null
}

interface Tab {
  id: string
  tabName: string
  tabNickname?: string | null
  tabStatus?: string | null  // pending_auth | open | no_card | closed
  orderNumber: number
  status: string
  employee: {
    id: string
    name: string
  }
  itemCount: number
  subtotal: number
  total: number
  hasPreAuth: boolean
  preAuth: {
    cardBrand: string
    last4: string
    amount: number | null
    expiresAt: string
  } | null
  cards?: TabCard[]
  openedAt: string
  paidAmount: number
  isBottleService?: boolean
  bottleServiceTierName?: string
  bottleServiceTierColor?: string
}

interface TabsPanelProps {
  employeeId?: string
  onSelectTab: (tabId: string) => void
  onNewTab: () => void
  refreshTrigger?: number
  pendingTabAnimation?: 'shimmer' | 'pulse' | 'spinner'
}

export function TabsPanel({ employeeId, onSelectTab, onNewTab, refreshTrigger, pendingTabAnimation = 'shimmer' }: TabsPanelProps) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')

  const loadTabs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: 'open' })
      const response = await fetch(`/api/tabs?${params}`)
      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        setTabs(data.tabs)
      }
    } catch (error) {
      console.error('Failed to load tabs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTabs()
  }, [refreshTrigger, loadTabs])

  const { subscribe, isConnected } = useEvents()

  useEffect(() => {
    if (!isConnected) return
    const unsubs = [
      subscribe('tab:updated', () => loadTabs()),
      subscribe('orders:list-changed', () => loadTabs()),
    ]
    return () => unsubs.forEach(u => u())
  }, [isConnected, subscribe, loadTabs])

  const filteredTabs = filter === 'mine' && employeeId
    ? tabs.filter(t => t.employee.id === employeeId)
    : tabs

  // Sort: auth_failed first (needs attention), then pending_auth, then rest
  const sortedTabs = [...filteredTabs].sort((a, b) => {
    const priority = (s: string | null | undefined) =>
      s === 'auth_failed' ? 0 : s === 'pending_auth' ? 1 : 2
    const aPri = priority(a.tabStatus)
    const bPri = priority(b.tabStatus)
    if (aPri !== bPri) return aPri - bPri
    return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
  })

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const getDisplayName = (tab: Tab): string => {
    if (tab.tabNickname) return tab.tabNickname
    if (tab.tabName) return tab.tabName
    return `Tab #${tab.orderNumber}`
  }

  const getTabAnimationStatus = (tab: Tab): 'pending_auth' | 'approved' | 'declined' => {
    if (tab.tabStatus === 'pending_auth') return 'pending_auth'
    if (tab.tabStatus === 'no_card' || tab.tabStatus === 'auth_failed') return 'declined'
    return 'approved'
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold">Open Tabs</h3>
        <Button variant="primary" size="sm" onClick={onNewTab}>
          + New Tab
        </Button>
      </div>

      {/* Filter */}
      <div className="p-2 border-b flex gap-1">
        <Button
          variant={filter === 'all' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setFilter('all')}
        >
          All ({tabs.length})
        </Button>
        <Button
          variant={filter === 'mine' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setFilter('mine')}
        >
          Mine ({tabs.filter(t => t.employee.id === employeeId).length})
        </Button>
      </div>

      {/* Tab List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {isLoading && tabs.length === 0 ? (
          <div className="text-center text-gray-500 py-4">Loading tabs...</div>
        ) : sortedTabs.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No open tabs</p>
            <p className="text-sm mt-1">Click + New Tab to start one</p>
          </div>
        ) : (
          sortedTabs.map(tab => {
            const isPending = tab.tabStatus === 'pending_auth'
            const hasNoCard = tab.tabStatus === 'no_card'
            const isAuthFailed = tab.tabStatus === 'auth_failed'

            const isBottle = tab.isBottleService && !isPending && !hasNoCard && !isAuthFailed

            return (
              <Card
                key={tab.id}
                className={`p-3 cursor-pointer transition-colors relative overflow-hidden
                  ${isPending ? 'border-amber-200 bg-amber-50/30' : ''}
                  ${isAuthFailed ? 'border-red-300 bg-red-50/30' : ''}
                  ${hasNoCard ? 'border-gray-200 bg-gray-50/30' : ''}
                  ${isBottle ? 'bg-amber-50/20' : ''}
                  ${!isPending && !hasNoCard && !isAuthFailed && !isBottle ? 'hover:bg-gray-50' : ''}
                `}
                style={isBottle ? { borderColor: tab.bottleServiceTierColor || '#D4AF37' } : undefined}
                onClick={() => onSelectTab(tab.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium flex items-center gap-2">
                      <span>{tab.isBottleService ? '🍾' : '🍺'}</span>
                      <span className="truncate">{getDisplayName(tab)}</span>
                      {tab.tabStatus && tab.tabStatus !== 'closed' && (
                        <AuthStatusBadge tabStatus={tab.tabStatus as any} compact />
                      )}
                    </h4>
                    {/* Show cardholder name as subtitle if nickname is set */}
                    {tab.tabNickname && tab.tabName && (
                      <p className="text-xs text-gray-400 ml-7">{tab.tabName}</p>
                    )}
                    <p className="text-xs text-gray-500 ml-7">
                      {tab.employee.name} • {formatTime(tab.openedAt)}
                    </p>
                  </div>
                  <span className="font-bold text-lg">
                    {formatCurrency(tab.total)}
                  </span>
                </div>

                {/* Pending/Declined animation */}
                {(isPending || hasNoCard || isAuthFailed) && (
                  <div className="mb-2 ml-7">
                    <PendingTabAnimation
                      variant={pendingTabAnimation}
                      status={getTabAnimationStatus(tab)}
                      cardType={tab.preAuth?.cardBrand}
                      cardLast4={tab.preAuth?.last4}
                    />
                  </div>
                )}

                {/* No-card warning badge */}
                {hasNoCard && (
                  <div className="mb-2 ml-7">
                    <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      No card on file
                    </span>
                  </div>
                )}

                {/* Card pills */}
                {tab.cards && tab.cards.length > 0 ? (
                  <div className="mb-2 ml-7 space-y-0.5">
                    <MultiCardBadges cards={tab.cards} compact />
                    {/* Show cardholder name under single-card tabs */}
                    {tab.cards.length === 1 && tab.cards[0].cardholderName && (
                      <p className="text-[11px] text-gray-400 font-medium pl-0.5">
                        {tab.cards[0].cardholderName.includes('/')
                          ? (() => { const [l, f] = tab.cards[0].cardholderName!.split('/'); return `${f?.trim()} ${l?.trim()}` })()
                          : tab.cards[0].cardholderName}
                        {' '}· ${tab.cards[0].authAmount.toFixed(0)} hold
                      </p>
                    )}
                  </div>
                ) : tab.hasPreAuth && tab.preAuth && !isPending && (
                  <div className="flex items-center gap-1 text-xs text-blue-600 mb-2 ml-7">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    {formatCardDisplay(tab.preAuth.cardBrand, tab.preAuth.last4)}
                  </div>
                )}

                {/* Bottle service banner */}
                {tab.isBottleService && !isPending && (
                  <div className="mb-2 ml-7">
                    <BottleServiceBanner
                      orderId={tab.id}
                      tierName={tab.bottleServiceTierName}
                      tierColor={tab.bottleServiceTierColor}
                      compact
                    />
                  </div>
                )}

                {/* Item count */}
                <div className="flex items-center justify-between text-sm text-gray-500 ml-7">
                  <span>{tab.itemCount} item{tab.itemCount !== 1 ? 's' : ''}</span>
                  {tab.paidAmount > 0 && (
                    <span className="text-green-600">
                      Paid: {formatCurrency(tab.paidAmount)}
                    </span>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}

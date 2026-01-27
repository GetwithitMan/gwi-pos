'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'

interface Tab {
  id: string
  tabName: string
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
  openedAt: string
  paidAmount: number
}

interface TabsPanelProps {
  employeeId?: string
  onSelectTab: (tabId: string) => void
  onNewTab: () => void
  refreshTrigger?: number
}

export function TabsPanel({ employeeId, onSelectTab, onNewTab, refreshTrigger }: TabsPanelProps) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')

  useEffect(() => {
    loadTabs()
  }, [refreshTrigger])

  const loadTabs = async () => {
    try {
      const params = new URLSearchParams({ status: 'open' })
      const response = await fetch(`/api/tabs?${params}`)
      if (response.ok) {
        const data = await response.json()
        setTabs(data.tabs)
      }
    } catch (error) {
      console.error('Failed to load tabs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredTabs = filter === 'mine' && employeeId
    ? tabs.filter(t => t.employee.id === employeeId)
    : tabs

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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
        {isLoading ? (
          <div className="text-center text-gray-500 py-4">Loading tabs...</div>
        ) : filteredTabs.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No open tabs</p>
            <p className="text-sm mt-1">Click + New Tab to start one</p>
          </div>
        ) : (
          filteredTabs.map(tab => (
            <Card
              key={tab.id}
              className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => onSelectTab(tab.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h4 className="font-medium flex items-center gap-2">
                    <span>🍺</span>
                    {tab.tabName}
                  </h4>
                  <p className="text-xs text-gray-500">
                    {tab.employee.name} • {formatTime(tab.openedAt)}
                  </p>
                </div>
                <span className="font-bold text-lg">
                  {formatCurrency(tab.total)}
                </span>
              </div>

              {/* Pre-auth info */}
              {tab.hasPreAuth && tab.preAuth && (
                <div className="flex items-center gap-1 text-xs text-blue-600 mb-2">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  {formatCardDisplay(tab.preAuth.cardBrand, tab.preAuth.last4)}
                </div>
              )}

              {/* Item count */}
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{tab.itemCount} item{tab.itemCount !== 1 ? 's' : ''}</span>
                {tab.paidAmount > 0 && (
                  <span className="text-green-600">
                    Paid: {formatCurrency(tab.paidAmount)}
                  </span>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

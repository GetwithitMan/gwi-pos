'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'

interface OpenOrder {
  id: string
  orderNumber: number
  orderType: 'dine_in' | 'takeout' | 'delivery' | 'bar_tab'
  tabName: string | null
  tableId: string | null
  guestCount: number
  status: string
  employee: {
    id: string
    name: string
  }
  items: {
    id: string
    menuItemId: string
    name: string
    price: number
    quantity: number
    itemTotal: number
    specialNotes: string | null
    isCompleted?: boolean
    completedAt?: string | null
    resendCount?: number
    modifiers: {
      id: string
      modifierId: string
      name: string
      price: number
      preModifier: string | null
    }[]
  }[]
  itemCount: number
  subtotal: number
  taxTotal: number
  total: number
  hasPreAuth: boolean
  preAuth: {
    cardBrand: string
    last4: string
    amount: number | null
    expiresAt: string
  } | null
  createdAt: string
  openedAt: string
  paidAmount: number
}

interface OpenOrdersPanelProps {
  locationId?: string
  employeeId?: string
  onSelectOrder: (order: OpenOrder) => void
  onNewTab: () => void
  refreshTrigger?: number
}

const ORDER_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  dine_in: { icon: '🍽️', label: 'Dine In', color: 'bg-blue-100 text-blue-800' },
  takeout: { icon: '📦', label: 'Takeout', color: 'bg-orange-100 text-orange-800' },
  delivery: { icon: '🚗', label: 'Delivery', color: 'bg-green-100 text-green-800' },
  bar_tab: { icon: '🍺', label: 'Bar Tab', color: 'bg-purple-100 text-purple-800' },
}

export function OpenOrdersPanel({ locationId, employeeId, onSelectOrder, onNewTab, refreshTrigger }: OpenOrdersPanelProps) {
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  useEffect(() => {
    if (locationId) {
      loadOrders()
    }
  }, [locationId, refreshTrigger])

  const loadOrders = async () => {
    if (!locationId) return

    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/orders/open?${params}`)
      if (response.ok) {
        const data = await response.json()
        setOrders(data.orders)
      }
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setIsLoading(false)
    }
  }

  let filteredOrders = orders

  // Filter by employee
  if (filter === 'mine' && employeeId) {
    filteredOrders = filteredOrders.filter(o => o.employee.id === employeeId)
  }

  // Filter by type
  if (typeFilter) {
    filteredOrders = filteredOrders.filter(o => o.orderType === typeFilter)
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const getOrderDisplayName = (order: OpenOrder): string => {
    if (order.tabName) return order.tabName
    if (order.tableId) return `Table ${order.tableId}`
    return `Order #${order.orderNumber}`
  }

  // Count orders by type
  const typeCounts = orders.reduce((acc, o) => {
    acc[o.orderType] = (acc[o.orderType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold">Open Orders</h3>
        <Button variant="primary" size="sm" onClick={onNewTab}>
          + New Tab
        </Button>
      </div>

      {/* Filter by Mine/All */}
      <div className="p-2 border-b flex gap-1">
        <Button
          variant={filter === 'all' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setFilter('all')}
        >
          All ({orders.length})
        </Button>
        <Button
          variant={filter === 'mine' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setFilter('mine')}
        >
          Mine ({orders.filter(o => o.employee.id === employeeId).length})
        </Button>
      </div>

      {/* Type Filter Pills */}
      <div className="p-2 border-b flex gap-1 flex-wrap">
        <button
          className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
            typeFilter === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          onClick={() => setTypeFilter(null)}
        >
          All
        </button>
        {Object.entries(ORDER_TYPE_CONFIG).map(([type, config]) => (
          typeCounts[type] ? (
            <button
              key={type}
              className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                typeFilter === type ? 'bg-gray-800 text-white' : `${config.color} hover:opacity-80`
              }`}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
            >
              {config.icon} {typeCounts[type]}
            </button>
          ) : null
        ))}
      </div>

      {/* Orders List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {isLoading ? (
          <div className="text-center text-gray-500 py-4">Loading orders...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No open orders</p>
            <p className="text-sm mt-1">Orders will appear here after sending to kitchen</p>
          </div>
        ) : (
          filteredOrders.map(order => {
            const config = ORDER_TYPE_CONFIG[order.orderType] || ORDER_TYPE_CONFIG.dine_in
            return (
              <Card
                key={order.id}
                className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => onSelectOrder(order)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-medium flex items-center gap-2">
                      <span>{config.icon}</span>
                      {getOrderDisplayName(order)}
                    </h4>
                    <p className="text-xs text-gray-500">
                      #{order.orderNumber} • {order.employee.name} • {formatTime(order.createdAt)}
                    </p>
                  </div>
                  <span className="font-bold text-lg">
                    {formatCurrency(order.total)}
                  </span>
                </div>

                {/* Order type badge */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
                    {config.label}
                  </span>
                  {order.guestCount > 1 && (
                    <span className="text-xs text-gray-500">
                      {order.guestCount} guests
                    </span>
                  )}
                </div>

                {/* Pre-auth info for bar tabs */}
                {order.hasPreAuth && order.preAuth && (
                  <div className="flex items-center gap-1 text-xs text-blue-600 mb-2">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    {formatCardDisplay(order.preAuth.cardBrand, order.preAuth.last4)}
                  </div>
                )}

                {/* Item summary */}
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>{order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</span>
                  {order.paidAmount > 0 && (
                    <span className="text-green-600">
                      Paid: {formatCurrency(order.paidAmount)}
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

export type { OpenOrder }

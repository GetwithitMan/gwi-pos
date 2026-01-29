'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'

interface OpenOrder {
  id: string
  orderNumber: number
  displayNumber?: string  // "30-1" for split tickets, "30" for regular
  isSplitTicket?: boolean
  orderType: string  // Allow custom order types (drive_thru, call_in, etc.)
  orderTypeConfig?: {  // Custom order type configuration
    name: string
    color?: string
    icon?: string
  } | null
  customFields?: Record<string, string> | null  // Custom field values (name, vehicle, etc.)
  tabName: string | null
  tableId: string | null
  table?: {
    id: string
    name: string
    section: string | null
  } | null
  customer?: {
    id: string
    name: string
  } | null
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
    // Entertainment/block time fields
    blockTimeMinutes?: number | null
    blockTimeStartedAt?: string | null
    blockTimeExpiresAt?: string | null
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
  closedAt?: string | null
  paidAmount: number
  paymentMethods?: string[]
  // Waitlist info
  waitlist?: { position: number; menuItemName: string }[]
  isOnWaitlist?: boolean
  // Entertainment session info
  entertainment?: { menuItemId: string; menuItemName: string; status: string; orderItemId: string | null }[]
  hasActiveEntertainment?: boolean
}

interface OpenOrdersPanelProps {
  locationId?: string
  employeeId?: string
  onSelectOrder: (order: OpenOrder) => void
  onNewTab: () => void
  refreshTrigger?: number
  onViewReceipt?: (orderId: string) => void
}

const ORDER_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  dine_in: { icon: '🍽️', label: 'Dine In', color: 'bg-blue-100 text-blue-800' },
  takeout: { icon: '📦', label: 'Takeout', color: 'bg-orange-100 text-orange-800' },
  delivery: { icon: '🚗', label: 'Delivery', color: 'bg-green-100 text-green-800' },
  bar_tab: { icon: '🍺', label: 'Bar Tab', color: 'bg-purple-100 text-purple-800' },
  drive_thru: { icon: '🚗', label: 'Drive Thru', color: 'bg-cyan-100 text-cyan-800' },
  call_in: { icon: '📞', label: 'Call-in', color: 'bg-teal-100 text-teal-800' },
}

// Get order type display config, supporting custom order types
function getOrderTypeDisplay(order: OpenOrder): { icon: string; label: string; color: string } {
  // First check if we have a custom order type config from the database
  if (order.orderTypeConfig) {
    // Map icon names to emojis for custom types
    const iconMap: Record<string, string> = {
      table: '🍽️',
      wine: '🍷',
      bag: '📦',
      truck: '🚚',
      phone: '📞',
      car: '🚗',
    }
    const icon = order.orderTypeConfig.icon ? (iconMap[order.orderTypeConfig.icon] || '📋') : '📋'

    // Generate Tailwind color class from hex color
    const color = order.orderTypeConfig.color || '#6B7280'

    return {
      icon,
      label: order.orderTypeConfig.name,
      color: 'bg-gray-100 text-gray-800', // Default, actual color applied via style
    }
  }

  // Fall back to built-in config
  return ORDER_TYPE_CONFIG[order.orderType] || { icon: '📋', label: order.orderType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), color: 'bg-gray-100 text-gray-800' }
}

export function OpenOrdersPanel({ locationId, employeeId, onSelectOrder, onNewTab, refreshTrigger, onViewReceipt }: OpenOrdersPanelProps) {
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [closedOrders, setClosedOrders] = useState<OpenOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'open' | 'closed'>('open')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (locationId) {
      loadOrders()
    }
  }, [locationId, refreshTrigger])

  // Auto-refresh every 3 seconds when viewing open orders (for entertainment timers)
  useEffect(() => {
    if (!locationId || viewMode !== 'open') return

    const interval = setInterval(() => {
      loadOrders()
    }, 3000) // 3 seconds for real-time updates

    // Also refresh when page becomes visible or focused
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadOrders()
      }
    }
    const handleFocus = () => loadOrders()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [locationId, viewMode])

  useEffect(() => {
    if (locationId && viewMode === 'closed') {
      loadClosedOrders()
    }
  }, [locationId, viewMode])

  const loadOrders = async () => {
    if (!locationId) return

    try {
      const params = new URLSearchParams({ locationId, _t: Date.now().toString() })
      const response = await fetch(`/api/orders/open?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
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

  const loadClosedOrders = async () => {
    if (!locationId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/orders/closed?${params}`)
      if (response.ok) {
        const data = await response.json()
        setClosedOrders(data.orders)
      }
    } catch (error) {
      console.error('Failed to load closed orders:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Determine which orders to show based on view mode
  const displayOrders = viewMode === 'open' ? orders : closedOrders

  let filteredOrders = displayOrders

  // Filter by employee
  if (filter === 'mine' && employeeId) {
    filteredOrders = filteredOrders.filter(o => o.employee.id === employeeId)
  }

  // Filter by type
  if (typeFilter) {
    filteredOrders = filteredOrders.filter(o => o.orderType === typeFilter)
  }

  // Filter by search query
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim()
    filteredOrders = filteredOrders.filter(o => {
      const tabName = o.tabName?.toLowerCase() || ''
      const tableName = o.table?.name?.toLowerCase() || ''
      const customerName = o.customer?.name?.toLowerCase() || ''
      const orderNum = String(o.orderNumber)
      const displayNum = o.displayNumber || ''
      return (
        tabName.includes(query) ||
        tableName.includes(query) ||
        customerName.includes(query) ||
        orderNum.includes(query) ||
        displayNum.includes(query)
      )
    })
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const getOrderDisplayName = (order: OpenOrder): { primary: string; secondary: string | null } => {
    let primary = `Order #${order.displayNumber || order.orderNumber}`
    let secondary: string | null = null

    if (order.tabName) {
      primary = order.tabName
    } else if (order.customer?.name) {
      primary = order.customer.name
    }

    if (order.table) {
      secondary = order.table.section
        ? `${order.table.section} - ${order.table.name}`
        : order.table.name
    }

    return { primary, secondary }
  }

  // Count orders by type
  const typeCounts = displayOrders.reduce((acc, o) => {
    acc[o.orderType] = (acc[o.orderType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold">{viewMode === 'open' ? 'Open Orders' : 'Closed Orders'}</h3>
        {viewMode === 'open' && (
          <Button variant="primary" size="sm" onClick={onNewTab}>
            + New Tab
          </Button>
        )}
      </div>

      {/* Open/Closed Toggle */}
      <div className="p-2 border-b flex gap-1">
        <Button
          variant={viewMode === 'open' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setViewMode('open')}
        >
          Open ({orders.length})
        </Button>
        <Button
          variant={viewMode === 'closed' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setViewMode('closed')}
        >
          Closed
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
          All ({displayOrders.length})
        </Button>
        <Button
          variant={filter === 'mine' ? 'primary' : 'ghost'}
          size="sm"
          className="flex-1"
          onClick={() => setFilter('mine')}
        >
          Mine ({displayOrders.filter(o => o.employee.id === employeeId).length})
        </Button>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b">
        <input
          type="text"
          placeholder="Search by name, table, or order #..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm font-medium focus:border-blue-500 focus:outline-none"
        />
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
            <p>No {viewMode} orders</p>
            <p className="text-sm mt-1">
              {viewMode === 'open'
                ? 'Orders will appear here after sending to kitchen'
                : 'Paid and closed orders will appear here'
              }
            </p>
          </div>
        ) : (
          filteredOrders.map(order => {
            const config = getOrderTypeDisplay(order)
            const displayName = getOrderDisplayName(order)
            const hasWaitlist = order.isOnWaitlist && order.waitlist && order.waitlist.length > 0
            const hasEntertainment = order.hasActiveEntertainment && order.entertainment && order.entertainment.length > 0

            // Calculate time remaining for active entertainment items
            const getTimeRemaining = (item: { blockTimeExpiresAt?: string | null }) => {
              if (!item.blockTimeExpiresAt) return null
              const expiresAt = new Date(item.blockTimeExpiresAt)
              const now = new Date()
              const remainingMs = expiresAt.getTime() - now.getTime()
              if (remainingMs <= 0) return 'EXPIRED'
              const mins = Math.floor(remainingMs / 60000)
              const secs = Math.floor((remainingMs % 60000) / 1000)
              return `${mins}:${secs.toString().padStart(2, '0')}`
            }

            // Find entertainment items in order.items
            const entertainmentItems = order.items.filter(item => item.blockTimeMinutes || item.blockTimeExpiresAt)

            return (
              <Card
                key={order.id}
                className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors border-2 ${
                  hasEntertainment ? 'border-green-500 bg-green-50' :
                  hasWaitlist ? 'border-amber-400 bg-amber-50' : 'border-transparent'
                }`}
                onClick={() => onSelectOrder(order)}
                onDoubleClick={() => onSelectOrder(order)}
              >
                {/* Entertainment Session Badge */}
                {hasEntertainment && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {order.entertainment!.map((e, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-green-600 text-white text-xs font-bold rounded-full"
                      >
                        <span>🎱</span>
                        {e.menuItemName}
                        {entertainmentItems.find(item => item.menuItemId === e.menuItemId)?.blockTimeExpiresAt && (
                          <span className="ml-1 font-mono">
                            ({getTimeRemaining(entertainmentItems.find(item => item.menuItemId === e.menuItemId) || {})})
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {/* Waitlist Badge */}
                {hasWaitlist && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {order.waitlist!.map((w, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500 text-white text-xs font-bold rounded-full"
                      >
                        <span>⏳</span>
                        #{w.position} for {w.menuItemName}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-gray-900 flex items-center gap-2 truncate">
                      <span>{config.icon}</span>
                      <span className="truncate">{displayName.primary}</span>
                    </h4>
                    {displayName.secondary && (
                      <p className="text-sm font-semibold text-blue-700 mt-0.5">
                        📍 {displayName.secondary}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      #{order.displayNumber || order.orderNumber}
                      {order.isSplitTicket && <span className="ml-1 text-blue-500">(split)</span>}
                      {' • '}{order.employee.name} • {formatTime(order.createdAt)}
                    </p>
                  </div>
                  <span className="font-bold text-lg text-gray-900 ml-2">
                    {formatCurrency(order.total)}
                  </span>
                </div>

                {/* Order type badge and status */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
                    {config.label}
                  </span>
                  {(order.status === 'paid' || order.status === 'closed') && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Paid
                    </span>
                  )}
                  {order.guestCount > 1 && (
                    <span className="text-xs text-gray-500 font-medium">
                      👥 {order.guestCount}
                    </span>
                  )}
                </div>

                {/* Pre-auth info for bar tabs */}
                {order.hasPreAuth && order.preAuth && (
                  <div className="flex items-center gap-1 text-xs text-blue-600 font-medium mb-2">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    {formatCardDisplay(order.preAuth.cardBrand, order.preAuth.last4)}
                  </div>
                )}

                {/* Items preview */}
                <div className="text-xs text-gray-600 mb-2 space-y-0.5">
                  {order.items.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="truncate">
                      <span className="font-medium">{item.quantity}x</span> {item.name}
                    </div>
                  ))}
                  {order.items.length > 3 && (
                    <div className="text-gray-400">+{order.items.length - 3} more items</div>
                  )}
                </div>

                {/* Item summary */}
                <div className="flex items-center justify-between text-sm text-gray-500 pt-2 border-t">
                  <span className="font-medium">{order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</span>
                  {order.paidAmount > 0 && (
                    <span className="text-green-600 font-medium">
                      Paid: {formatCurrency(order.paidAmount)}
                    </span>
                  )}
                </div>

                {/* Receipt button for closed orders */}
                {viewMode === 'closed' && onViewReceipt && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onViewReceipt(order.id)
                    }}
                    className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm font-medium text-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    View Receipt
                  </button>
                )}
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}

export type { OpenOrder }

'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'
import { ClosedOrderActionsModal } from './ClosedOrderActionsModal'

interface OpenOrder {
  id: string
  orderNumber: number
  displayNumber?: string
  isSplitTicket?: boolean
  orderType: string
  orderTypeConfig?: {
    name: string
    color?: string
    icon?: string
  } | null
  customFields?: Record<string, string> | null
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
  tipTotal?: number
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
  payments?: {
    id: string
    amount: number
    tipAmount: number
    totalAmount: number
    paymentMethod: string
    cardBrand: string | null
    cardLast4: string | null
    status?: string
    datacapRecordNo?: string | null
  }[]
  hasCardPayment?: boolean
  needsTip?: boolean
  waitlist?: { position: number; menuItemName: string }[]
  isOnWaitlist?: boolean
  entertainment?: { menuItemId: string; menuItemName: string; status: string; orderItemId: string | null }[]
  hasActiveEntertainment?: boolean
  hasHeldItems?: boolean
  hasCoursingEnabled?: boolean
  hasDelayedItems?: boolean
  courseMode?: string | null
}

interface OpenOrdersPanelProps {
  locationId?: string
  employeeId?: string
  employeePermissions?: string[]
  onSelectOrder: (order: OpenOrder) => void
  onViewOrder?: (order: OpenOrder) => void
  onNewTab: () => void
  refreshTrigger?: number
  onViewReceipt?: (orderId: string) => void
  onClosedOrderAction?: () => void
  onOpenTipAdjustment?: () => void
  isExpanded?: boolean
  onToggleExpand?: () => void
}

type SortOption = 'newest' | 'oldest' | 'alpha_first' | 'alpha_last' | 'total_high' | 'total_low' | 'employee'
type DatePreset = 'today' | 'yesterday' | 'this_week' | 'custom'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'alpha_first', label: 'A → Z' },
  { value: 'alpha_last', label: 'Z → A' },
  { value: 'total_high', label: 'Highest $' },
  { value: 'total_low', label: 'Lowest $' },
  { value: 'employee', label: 'Employee' },
]

const ORDER_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string; darkColor: string }> = {
  dine_in: { icon: '🍽️', label: 'Dine In', color: 'bg-blue-100 text-blue-800', darkColor: 'bg-blue-600/30 text-blue-300 border-blue-500/30' },
  takeout: { icon: '📦', label: 'Takeout', color: 'bg-orange-100 text-orange-800', darkColor: 'bg-orange-600/30 text-orange-300 border-orange-500/30' },
  delivery: { icon: '🚗', label: 'Delivery', color: 'bg-green-100 text-green-800', darkColor: 'bg-green-600/30 text-green-300 border-green-500/30' },
  bar_tab: { icon: '🍺', label: 'Bar Tab', color: 'bg-purple-100 text-purple-800', darkColor: 'bg-purple-600/30 text-purple-300 border-purple-500/30' },
  drive_thru: { icon: '🚗', label: 'Drive Thru', color: 'bg-cyan-100 text-cyan-800', darkColor: 'bg-cyan-600/30 text-cyan-300 border-cyan-500/30' },
  call_in: { icon: '📞', label: 'Call-in', color: 'bg-teal-100 text-teal-800', darkColor: 'bg-teal-600/30 text-teal-300 border-teal-500/30' },
}

function getOrderTypeDisplay(order: OpenOrder, dark: boolean): { icon: string; label: string; color: string } {
  if (order.orderTypeConfig) {
    const iconMap: Record<string, string> = {
      table: '🍽️', wine: '🍷', bag: '📦', truck: '🚚', phone: '📞', car: '🚗',
    }
    const icon = order.orderTypeConfig.icon ? (iconMap[order.orderTypeConfig.icon] || '📋') : '📋'
    return {
      icon,
      label: order.orderTypeConfig.name,
      color: dark ? 'bg-slate-600/30 text-slate-300 border-slate-500/30' : 'bg-gray-100 text-gray-800',
    }
  }
  const config = ORDER_TYPE_CONFIG[order.orderType]
  if (config) {
    return { icon: config.icon, label: config.label, color: dark ? config.darkColor : config.color }
  }
  return {
    icon: '📋',
    label: order.orderType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    color: dark ? 'bg-slate-600/30 text-slate-300 border-slate-500/30' : 'bg-gray-100 text-gray-800',
  }
}

export function OpenOrdersPanel({
  locationId, employeeId, employeePermissions = [], onSelectOrder, onViewOrder, onNewTab,
  refreshTrigger, onViewReceipt, onClosedOrderAction, onOpenTipAdjustment, isExpanded = false, onToggleExpand,
}: OpenOrdersPanelProps) {
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [closedOrders, setClosedOrders] = useState<OpenOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'open' | 'closed'>('open')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [viewStyle, setViewStyle] = useState<'card' | 'condensed'>('card')
  const [datePreset, setDatePreset] = useState<DatePreset>('today')
  const [closedOrderModalOrder, setClosedOrderModalOrder] = useState<OpenOrder | null>(null)
  const [closedCursor, setClosedCursor] = useState<string | null>(null)
  const [hasMoreClosed, setHasMoreClosed] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const dark = isExpanded

  useEffect(() => {
    if (locationId) loadOrders()
  }, [locationId, refreshTrigger])

  useEffect(() => {
    if (!locationId || viewMode !== 'open') return
    const interval = setInterval(() => loadOrders(), 3000)
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') loadOrders() }
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
      setClosedOrders([])
      setClosedCursor(null)
      loadClosedOrders(null)
    }
  }, [locationId, viewMode, datePreset])

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

  const loadClosedOrders = async (cursor: string | null) => {
    if (!locationId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ locationId, limit: '50' })

      // Date range from preset (use local date, not UTC)
      const now = new Date()
      const toLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      if (datePreset === 'today') {
        params.set('dateFrom', toLocal(now))
      } else if (datePreset === 'yesterday') {
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)
        params.set('dateFrom', toLocal(yesterday))
        params.set('dateTo', toLocal(yesterday))
      } else if (datePreset === 'this_week') {
        const weekStart = new Date(now)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        params.set('dateFrom', toLocal(weekStart))
      }

      if (cursor) params.set('cursor', cursor)

      const sortMap: Record<SortOption, string> = {
        newest: 'newest', oldest: 'oldest', total_high: 'total_high', total_low: 'total_low',
        alpha_first: 'newest', alpha_last: 'newest', employee: 'newest',
      }
      params.set('sortBy', sortMap[sortBy] || 'newest')

      const response = await fetch(`/api/orders/closed?${params}`)
      if (response.ok) {
        const data = await response.json()
        if (cursor) {
          setClosedOrders(prev => [...prev, ...data.orders])
        } else {
          setClosedOrders(data.orders)
        }
        setClosedCursor(data.pagination?.nextCursor || null)
        setHasMoreClosed(data.pagination?.hasMore || false)
      }
    } catch (error) {
      console.error('Failed to load closed orders:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Sort and filter
  const displayOrders = viewMode === 'open' ? orders : closedOrders
  let filteredOrders = [...displayOrders]

  if (filter === 'mine' && employeeId) {
    filteredOrders = filteredOrders.filter(o => o.employee.id === employeeId)
  }
  if (typeFilter) {
    filteredOrders = filteredOrders.filter(o => o.orderType === typeFilter)
  }
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim()
    filteredOrders = filteredOrders.filter(o => {
      const tabName = o.tabName?.toLowerCase() || ''
      const tableName = o.table?.name?.toLowerCase() || ''
      const customerName = o.customer?.name?.toLowerCase() || ''
      const orderNum = String(o.orderNumber)
      const displayNum = o.displayNumber || ''
      const empName = o.employee.name?.toLowerCase() || ''
      return tabName.includes(query) || tableName.includes(query) || customerName.includes(query) ||
        orderNum.includes(query) || displayNum.includes(query) || empName.includes(query)
    })
  }

  // Client-side sort (for fields not supported by API sort)
  filteredOrders.sort((a, b) => {
    const nameA = (a.tabName || a.customer?.name || `Order #${a.orderNumber}`).toLowerCase()
    const nameB = (b.tabName || b.customer?.name || `Order #${b.orderNumber}`).toLowerCase()
    switch (sortBy) {
      case 'newest': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'oldest': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      case 'alpha_first': return nameA.localeCompare(nameB)
      case 'alpha_last': return nameB.localeCompare(nameA)
      case 'total_high': return b.total - a.total
      case 'total_low': return a.total - b.total
      case 'employee': return a.employee.name.localeCompare(b.employee.name)
      default: return 0
    }
  })

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const getOrderDisplayName = (order: OpenOrder): { primary: string; secondary: string | null } => {
    let primary = `Order #${order.displayNumber || order.orderNumber}`
    let secondary: string | null = null
    if (order.tabName) primary = order.tabName
    else if (order.customer?.name) primary = order.customer.name
    if (order.table) {
      secondary = order.table.section ? `${order.table.section} - ${order.table.name}` : order.table.name
    }
    return { primary, secondary }
  }

  const typeCounts = displayOrders.reduce((acc, o) => {
    acc[o.orderType] = (acc[o.orderType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const getTimeRemaining = (item: { blockTimeExpiresAt?: string | null }) => {
    if (!item.blockTimeExpiresAt) return null
    const remainingMs = new Date(item.blockTimeExpiresAt).getTime() - Date.now()
    if (remainingMs <= 0) return 'EXPIRED'
    const mins = Math.floor(remainingMs / 60000)
    const secs = Math.floor((remainingMs % 60000) / 1000)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // ── Render helpers ──

  const renderSearchIcon = () => (
    <div className="relative flex items-center">
      <AnimatePresence>
        {isSearchOpen ? (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: isExpanded ? 300 : 180, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={() => { if (!searchQuery) setIsSearchOpen(false) }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); setIsSearchOpen(false) } }}
              className={`w-full px-3 py-2 rounded-lg text-sm font-medium focus:outline-none ${
                dark
                  ? 'bg-white/10 border border-white/20 text-white placeholder-slate-400 focus:border-indigo-500'
                  : 'border-2 border-gray-300 focus:border-blue-500'
              }`}
              autoFocus
            />
          </motion.div>
        ) : (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => { setIsSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 50) }}
            className={`p-2 rounded-lg transition-colors ${
              dark ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )

  const renderOrderCard = (order: OpenOrder) => {
    const config = getOrderTypeDisplay(order, dark)
    const displayName = getOrderDisplayName(order)
    const hasWaitlist = order.isOnWaitlist && order.waitlist && order.waitlist.length > 0
    const hasEntertainment = order.hasActiveEntertainment && order.entertainment && order.entertainment.length > 0
    const entertainmentItems = order.items.filter(item => item.blockTimeMinutes || item.blockTimeExpiresAt)

    if (viewStyle === 'condensed') {
      return (
        <div
          key={order.id}
          onClick={() => onViewOrder ? onViewOrder(order) : onSelectOrder(order)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
            dark
              ? 'bg-white/5 hover:bg-white/10 border border-white/10'
              : 'bg-white hover:bg-gray-50 border border-gray-200'
          }`}
        >
          <span className="text-sm">{config.icon}</span>
          <div className="flex-1 min-w-0">
            <span className={`font-semibold text-sm truncate block ${dark ? 'text-white' : 'text-gray-900'}`}>
              {displayName.primary}
            </span>
            <span className={`text-xs ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
              #{order.displayNumber || order.orderNumber} • {order.employee.name} • {formatTime(order.createdAt)}
            </span>
          </div>
          <span className={`font-bold text-sm ${dark ? 'text-green-400' : 'text-gray-900'}`}>
            {formatCurrency(order.total)}
          </span>
          {viewMode === 'open' && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelectOrder(order) }}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs font-bold text-white transition-colors"
            >
              Pay
            </button>
          )}
        </div>
      )
    }

    const isPaidOrClosed = order.status === 'paid' || order.status === 'closed'

    return (
      <div
        key={order.id}
        onClick={() => {
          if (isPaidOrClosed) { setClosedOrderModalOrder(order); return }
          onViewOrder ? onViewOrder(order) : onSelectOrder(order)
        }}
        className={`p-3 rounded-xl transition-all border ${
          isPaidOrClosed
            ? dark
              ? 'bg-green-900/20 border-green-500/30 opacity-80'
              : 'bg-green-50 border-green-300 border-2 opacity-90'
            : dark
              ? `bg-white/5 hover:bg-white/10 cursor-pointer ${
                  hasEntertainment ? 'border-green-500/50' : hasWaitlist ? 'border-amber-500/50' : 'border-white/10'
                }`
              : `hover:bg-gray-50 cursor-pointer border-2 ${
                  hasEntertainment ? 'border-green-500 bg-green-50' : hasWaitlist ? 'border-amber-400 bg-amber-50' : 'border-transparent bg-white'
                }`
        }`}
      >
        {/* Entertainment badges */}
        {hasEntertainment && (
          <div className="mb-2 flex flex-wrap gap-1">
            {order.entertainment!.map((e, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-green-600 text-white text-xs font-bold rounded-full">
                🎱 {e.menuItemName}
                {entertainmentItems.find(item => item.menuItemId === e.menuItemId)?.blockTimeExpiresAt && (
                  <span className="ml-1 font-mono">({getTimeRemaining(entertainmentItems.find(item => item.menuItemId === e.menuItemId) || {})})</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Waitlist badges */}
        {hasWaitlist && (
          <div className="mb-2 flex flex-wrap gap-1">
            {order.waitlist!.map((w, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500 text-white text-xs font-bold rounded-full">
                ⏳ #{w.position} for {w.menuItemName}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h4 className={`font-bold flex items-center gap-2 truncate ${dark ? 'text-white' : 'text-gray-900'}`}>
              <span>{config.icon}</span>
              <span className="truncate">{displayName.primary}</span>
            </h4>
            {displayName.secondary && (
              <p className={`text-sm font-semibold mt-0.5 ${dark ? 'text-blue-400' : 'text-blue-700'}`}>
                📍 {displayName.secondary}
              </p>
            )}
            <p className={`text-xs mt-1 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
              #{order.displayNumber || order.orderNumber}
              {order.isSplitTicket && <span className="ml-1 text-blue-500">(split)</span>}
              {' • '}{order.employee.name} • {formatTime(order.createdAt)}
            </p>
          </div>
          <div className="ml-2 text-right">
            <span className={`font-bold text-lg ${isPaidOrClosed ? (dark ? 'text-green-400' : 'text-green-700') : (dark ? 'text-green-400' : 'text-gray-900')}`}>
              {formatCurrency(order.total)}
            </span>
            {isPaidOrClosed && (
              <div className={`text-xs font-bold ${dark ? 'text-green-400' : 'text-green-600'}`}>PAID</div>
            )}
          </div>
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${config.color}`}>
            {config.label}
          </span>
          {(order.status === 'paid' || order.status === 'closed') && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${dark ? 'bg-green-600/30 text-green-300' : 'bg-green-100 text-green-800'}`}>
              Paid
            </span>
          )}
          {order.needsTip && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${dark ? 'bg-amber-600/30 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
              💰 Needs Tip
            </span>
          )}
          {order.guestCount > 1 && (
            <span className={`text-xs font-medium ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
              👥 {order.guestCount}
            </span>
          )}
          {order.hasDelayedItems && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${dark ? 'bg-amber-600/30 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
              ⏱ Delayed
            </span>
          )}
          {order.hasHeldItems && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${dark ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700'}`}>
              ⏸ Held
            </span>
          )}
          {(order.hasCoursingEnabled || (order.courseMode && order.courseMode !== 'off')) && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${dark ? 'bg-blue-600/30 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
              CRS
            </span>
          )}
        </div>

        {/* Pre-auth */}
        {order.hasPreAuth && order.preAuth && (
          <div className={`flex items-center gap-1 text-xs font-medium mb-2 ${dark ? 'text-blue-400' : 'text-blue-600'}`}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            {formatCardDisplay(order.preAuth.cardBrand, order.preAuth.last4)}
          </div>
        )}

        {/* Items preview */}
        <div className={`text-xs mb-2 space-y-0.5 ${dark ? 'text-slate-400' : 'text-gray-600'}`}>
          {order.items.slice(0, 3).map((item, idx) => (
            <div key={idx} className="truncate">
              <span className="font-medium">{item.quantity}x</span> {item.name}
            </div>
          ))}
          {order.items.length > 3 && (
            <div className={dark ? 'text-slate-500' : 'text-gray-400'}>+{order.items.length - 3} more items</div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between text-sm pt-2 border-t ${dark ? 'border-white/10 text-slate-400' : 'border-gray-100 text-gray-500'}`}>
          <span className="font-medium">{order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</span>
          {order.paidAmount > 0 && (
            <span className={`font-medium ${dark ? 'text-green-400' : 'text-green-600'}`}>
              Paid: {formatCurrency(order.paidAmount)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        {viewMode === 'open' && !isPaidOrClosed && (
          <div className="mt-2 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onSelectOrder(order) }}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold text-white transition-colors"
            >
              Open
            </button>
          </div>
        )}
        {viewMode === 'open' && isPaidOrClosed && (
          <button
            onClick={(e) => { e.stopPropagation(); setClosedOrderModalOrder(order) }}
            className={`mt-2 w-full text-center py-2 rounded-lg text-sm font-bold transition-colors ${dark ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
          >
            Manage
          </button>
        )}

        {/* Closed order actions */}
        {viewMode === 'closed' && (
          <div className="mt-2 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setClosedOrderModalOrder(order) }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${
                dark ? 'bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300' : 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700'
              }`}
            >
              Manage
            </button>
            {onViewReceipt && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewReceipt(order.id) }}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  dark ? 'bg-white/10 hover:bg-white/15 text-slate-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Receipt
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Main render ──

  const toolbarContent = (
    <>
      {/* Header */}
      <div className={`p-3 flex items-center justify-between ${dark ? 'border-b border-white/10' : 'border-b'}`}>
        <div className="flex items-center gap-2">
          <h3 className={`font-bold ${dark ? 'text-white text-lg' : 'font-semibold'}`}>
            {viewMode === 'open' ? 'Open Orders' : 'Closed Orders'}
          </h3>
          {renderSearchIcon()}
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'open' && (
            <Button
              variant={dark ? 'glass' : 'primary'}
              size="sm"
              onClick={onNewTab}
            >
              + New Tab
            </Button>
          )}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className={`p-2 rounded-lg transition-colors ${
                dark ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500'
              }`}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className={`p-2 flex gap-1 flex-wrap items-center ${dark ? 'border-b border-white/10' : 'border-b'}`}>
        {/* Open/Closed toggle */}
        <button
          onClick={() => setViewMode('open')}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            viewMode === 'open'
              ? (dark ? 'bg-indigo-600/40 text-white border border-indigo-500/50' : 'bg-blue-600 text-white')
              : (dark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
          }`}
        >
          Open ({orders.length})
        </button>
        <button
          onClick={() => setViewMode('closed')}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            viewMode === 'closed'
              ? (dark ? 'bg-indigo-600/40 text-white border border-indigo-500/50' : 'bg-blue-600 text-white')
              : (dark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
          }`}
        >
          Closed
        </button>

        <div className={`w-px h-6 mx-1 ${dark ? 'bg-white/10' : 'bg-gray-200'}`} />

        {/* Mine/All */}
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            filter === 'all'
              ? (dark ? 'bg-white/15 text-white' : 'bg-gray-800 text-white')
              : (dark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('mine')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            filter === 'mine'
              ? (dark ? 'bg-white/15 text-white' : 'bg-gray-800 text-white')
              : (dark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
          }`}
        >
          Mine
        </button>

        <div className="flex-1" />

        {/* View style toggle */}
        {isExpanded && (
          <div className="flex gap-1">
            <button
              onClick={() => setViewStyle('card')}
              className={`p-1.5 rounded transition-colors ${viewStyle === 'card' ? (dark ? 'bg-white/15 text-white' : 'bg-gray-800 text-white') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100')}`}
              title="Card view"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            </button>
            <button
              onClick={() => setViewStyle('condensed')}
              className={`p-1.5 rounded transition-colors ${viewStyle === 'condensed' ? (dark ? 'bg-white/15 text-white' : 'bg-gray-800 text-white') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100')}`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
            </button>
          </div>
        )}

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 transition-colors ${
              dark ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Sort: {SORT_OPTIONS.find(s => s.value === sortBy)?.label}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showSortMenu && (
            <div className={`absolute right-0 top-full mt-1 rounded-lg shadow-xl z-50 py-1 min-w-[140px] ${
              dark ? 'bg-slate-800 border border-white/10' : 'bg-white border border-gray-200'
            }`}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setSortBy(opt.value); setShowSortMenu(false) }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    sortBy === opt.value
                      ? (dark ? 'bg-indigo-600/30 text-white' : 'bg-blue-50 text-blue-700')
                      : (dark ? 'text-slate-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-50')
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Date preset pills (closed view only) */}
      {viewMode === 'closed' && isExpanded && (
        <div className={`p-2 flex gap-1 ${dark ? 'border-b border-white/10' : 'border-b'}`}>
          {(['today', 'yesterday', 'this_week'] as DatePreset[]).map(preset => (
            <button
              key={preset}
              onClick={() => setDatePreset(preset)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                datePreset === preset
                  ? (dark ? 'bg-indigo-600/40 text-white border border-indigo-500/50' : 'bg-blue-600 text-white')
                  : (dark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
              }`}
            >
              {preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : 'This Week'}
            </button>
          ))}
        </div>
      )}

      {/* Type filter pills */}
      {Object.keys(typeCounts).length > 1 && (
        <div className={`p-2 flex gap-1 flex-wrap ${dark ? 'border-b border-white/10' : 'border-b'}`}>
          <button
            className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
              typeFilter === null
                ? (dark ? 'bg-white/15 text-white' : 'bg-gray-800 text-white')
                : (dark ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
            }`}
            onClick={() => setTypeFilter(null)}
          >
            All
          </button>
          {Object.entries(ORDER_TYPE_CONFIG).map(([type, config]) => (
            typeCounts[type] ? (
              <button
                key={type}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors border ${
                  typeFilter === type
                    ? (dark ? 'bg-white/15 text-white border-white/20' : 'bg-gray-800 text-white border-transparent')
                    : (dark ? `${config.darkColor}` : `${config.color} border-transparent hover:opacity-80`)
                }`}
                onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              >
                {config.icon} {typeCounts[type]}
              </button>
            ) : null
          ))}
        </div>
      )}
    </>
  )

  const ordersList = (
    <div className={`flex-1 overflow-y-auto p-2 ${isExpanded ? 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-min items-start' : 'space-y-2'}`}>
      {isLoading && filteredOrders.length === 0 ? (
        <div className={`text-center py-8 ${isExpanded ? 'col-span-full' : ''} ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
          Loading orders...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className={`text-center py-8 ${isExpanded ? 'col-span-full' : ''} ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
          <p>No {viewMode} orders</p>
          <p className="text-sm mt-1">
            {viewMode === 'open'
              ? 'Orders will appear here after sending to kitchen'
              : 'Paid and closed orders will appear here'
            }
          </p>
        </div>
      ) : (
        <>
          {filteredOrders.map(order => renderOrderCard(order))}
          {viewMode === 'closed' && hasMoreClosed && (
            <div className={`${isExpanded ? 'col-span-full' : ''} text-center py-3`}>
              <button
                onClick={() => loadClosedOrders(closedCursor)}
                className={`px-6 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  dark ? 'bg-white/10 hover:bg-white/15 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Load More
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )

  // Expanded: full-screen overlay
  if (isExpanded) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'rgba(15, 15, 30, 0.98)', backdropFilter: 'blur(24px)' }}
        >
          {toolbarContent}
          {ordersList}
        </motion.div>
        {closedOrderModalOrder && employeeId && (
          <ClosedOrderActionsModal
            isOpen={true}
            onClose={() => setClosedOrderModalOrder(null)}
            order={closedOrderModalOrder}
            employeeId={employeeId}
            employeePermissions={employeePermissions}
            onActionComplete={() => {
              setClosedOrderModalOrder(null)
              if (onClosedOrderAction) onClosedOrderAction()
              loadOrders()
              loadClosedOrders(null)
            }}
            onOpenTipAdjustment={onOpenTipAdjustment}
          />
        )}
      </>
    )
  }

  const closedOrderModal = closedOrderModalOrder && employeeId && (
    <ClosedOrderActionsModal
      isOpen={true}
      onClose={() => setClosedOrderModalOrder(null)}
      order={closedOrderModalOrder}
      employeeId={employeeId}
      employeePermissions={employeePermissions}
      onActionComplete={() => {
        setClosedOrderModalOrder(null)
        // Refresh both open and closed orders
        if (onClosedOrderAction) onClosedOrderAction()
        loadOrders()
        loadClosedOrders(null)
      }}
      onOpenTipAdjustment={onOpenTipAdjustment}
    />
  )

  // Collapsed: sidebar
  return (
    <>
      <div className="h-full flex flex-col">
        {toolbarContent}
        {ordersList}
      </div>
      {closedOrderModal}
    </>
  )
}

export type { OpenOrder }

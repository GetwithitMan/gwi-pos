'use client'

import { memo } from 'react'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'
import { AuthStatusBadge } from '@/components/tabs/AuthStatusBadge'
import type { OpenOrder } from './OpenOrdersPanel'

// Helper functions (shared with OpenOrdersPanel)
function getAgeBadge(order: { ageMinutes?: number; isRolledOver?: boolean }, dark: boolean) {
  const age = order.ageMinutes
  if (age == null) return null
  if (order.isRolledOver) {
    const days = Math.floor(age / 1440)
    return { text: days > 0 ? `${days}d ago` : 'Rolled Over', cls: dark ? 'bg-red-600/40 text-red-300' : 'bg-red-100 text-red-800' }
  }
  if (age < 60) return { text: `${age}m`, cls: dark ? 'bg-emerald-600/30 text-emerald-300' : 'bg-emerald-100 text-emerald-700' }
  if (age < 240) {
    const h = Math.floor(age / 60); const m = age % 60
    return { text: m > 0 ? `${h}h ${m}m` : `${h}h`, cls: dark ? 'bg-yellow-600/30 text-yellow-300' : 'bg-yellow-100 text-yellow-700' }
  }
  if (age < 480) {
    return { text: `${Math.floor(age / 60)}h`, cls: dark ? 'bg-orange-600/30 text-orange-300' : 'bg-orange-100 text-orange-700' }
  }
  return { text: `${Math.floor(age / 60)}h`, cls: dark ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700' }
}

function getDisplayTotal(order: OpenOrder): number {
  if (order.hasSplits && order.splits && order.splits.length > 0) {
    return order.splits.reduce((sum, s) => sum + s.total, 0)
  }
  return order.total
}

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

function formatTime(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDateStarted(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getOrderDisplayName(order: OpenOrder): { primary: string; secondary: string | null } {
  let primary = `Order #${order.displayNumber || order.orderNumber}`
  let secondary: string | null = null
  if (order.tabName) {
    primary = order.tabName
    if (order.cardholderName && order.cardholderName !== order.tabName) {
      secondary = order.cardholderName
    }
  }
  else if (order.customer) primary = `${order.customer.firstName} ${order.customer.lastName}`
  if (order.table) {
    secondary = order.table.section ? `${order.table.section} - ${order.table.name}` : order.table.name
  }
  return { primary, secondary }
}

function getTimeRemaining(item: { blockTimeExpiresAt?: string | null }) {
  if (!item.blockTimeExpiresAt) return null
  const remainingMs = new Date(item.blockTimeExpiresAt).getTime() - Date.now()
  if (remainingMs <= 0) return 'EXPIRED'
  const mins = Math.floor(remainingMs / 60000)
  const secs = Math.floor((remainingMs % 60000) / 1000)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export interface OpenOrderCardProps {
  order: OpenOrder
  dark: boolean
  viewMode: 'open' | 'closed'
  viewStyle: 'card' | 'condensed'
  ageFilter: string
  employeeId?: string
  onViewOrder: (order: OpenOrder) => void
  onSelectOrder: (order: OpenOrder) => void
  onClosedOrderAction: (order: OpenOrder) => void
  onTabTransfer: (order: OpenOrder) => void
  onViewReceipt?: (orderId: string) => void
}

export const OpenOrderCard = memo(function OpenOrderCard({
  order,
  dark,
  viewMode,
  viewStyle,
  ageFilter,
  employeeId,
  onViewOrder,
  onSelectOrder,
  onClosedOrderAction,
  onTabTransfer,
  onViewReceipt,
}: OpenOrderCardProps) {
  const config = getOrderTypeDisplay(order, dark)
  const displayName = getOrderDisplayName(order)
  const hasWaitlist = order.isOnWaitlist && order.waitlist && order.waitlist.length > 0
  const hasEntertainment = order.hasActiveEntertainment && order.entertainment && order.entertainment.length > 0
  const entertainmentItems = order.items.filter(item => item.blockTimeMinutes || item.blockTimeExpiresAt)

  const isClaimedByOther = !!(
    order.claimedByEmployeeId &&
    order.claimedByEmployeeId !== employeeId &&
    order.claimedAt &&
    (Date.now() - new Date(order.claimedAt).getTime()) < 60_000
  )
  const claimedByName = order.claimedByEmployee?.displayName || 'Another employee'

  if (viewStyle === 'condensed') {
    return (
      <div
        key={order.id}
        onClick={() => onViewOrder(order)}
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
            {order.hasPreAuth && order.preAuth && (
              <> • •••{order.preAuth.last4}{order.preAuth.amount != null && ` ${formatCurrency(order.preAuth.amount)}`}</>
            )}
          </span>
          {order.tabStatus && order.tabStatus !== 'closed' && (
            <span className="inline-block mt-0.5">
              <AuthStatusBadge tabStatus={order.tabStatus as any} dark={dark} />
            </span>
          )}
          {order.reopenedAt && (
            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${dark ? 'bg-orange-600/30 text-orange-300' : 'bg-orange-100 text-orange-700'}`}>
              🔓 Reopened
            </span>
          )}
          {(ageFilter === 'previous' || order.isRolledOver) && (
            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${dark ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700'}`}>
              {formatDateStarted(order.createdAt)}
            </span>
          )}
          {order.scheduledFor && (
            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${dark ? 'bg-purple-600/30 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
              Scheduled: {new Date(order.scheduledFor).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {isClaimedByOther && (
            <span className={`inline-block mt-0.5 text-xs font-medium ${dark ? 'text-amber-400' : 'text-amber-600'}`}>
              Editing: {claimedByName}
            </span>
          )}
        </div>
        <span className={`font-bold text-sm ${dark ? 'text-green-400' : 'text-gray-900'}`}>
          {formatCurrency(getDisplayTotal(order))}
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
        if (isPaidOrClosed) { onClosedOrderAction(order); return }
        onViewOrder(order)
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
            <p className={`text-sm mt-0.5 ${order.table ? (dark ? 'text-blue-400 font-semibold' : 'text-blue-700 font-semibold') : (dark ? 'text-slate-400' : 'text-gray-500')}`}>
              {order.table ? '📍 ' : ''}{displayName.secondary}
            </p>
          )}
          <p className={`text-xs mt-1 ${dark ? 'text-slate-400' : 'text-gray-500'}`}>
            #{order.displayNumber || order.orderNumber}
            {order.hasSplits && <span className={`ml-1 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`}>({order.splitCount} splits)</span>}
            {' • '}{order.employee.name} • {formatTime(order.createdAt)}
          </p>
        </div>
        <div className="ml-2 text-right">
          <span className={`font-bold text-lg ${isPaidOrClosed ? (dark ? 'text-green-400' : 'text-green-700') : (dark ? 'text-green-400' : 'text-gray-900')}`}>
            {formatCurrency(getDisplayTotal(order))}
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
        {order.reopenedAt && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${dark ? 'bg-orange-600/30 text-orange-300 border border-orange-500/30' : 'bg-orange-100 text-orange-700'}`} title={order.reopenReason || 'Reopened'}>
            🔓 Reopened
          </span>
        )}
        {(() => {
          const badge = getAgeBadge(order, dark)
          return badge ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badge.cls}`}>{badge.text}</span> : null
        })()}
        {(ageFilter === 'previous' || order.isRolledOver) && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${dark ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700'}`}>
            {formatDateStarted(order.createdAt)}
          </span>
        )}
        {order.scheduledFor && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${dark ? 'bg-purple-600/30 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
            Scheduled: {new Date(order.scheduledFor).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
        {order.isCaptureDeclined && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold animate-pulse ${dark ? 'bg-red-600/40 text-red-300' : 'bg-red-100 text-red-700'}`}>
            Card Declined
          </span>
        )}
        {isClaimedByOther && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${dark ? 'bg-amber-600/30 text-amber-300 border border-amber-500/30' : 'bg-amber-100 text-amber-600 border border-amber-300'}`}>
            Editing: {claimedByName}
          </span>
        )}
      </div>

      {/* Split ticket tabs — nested under parent */}
      {order.hasSplits && order.splits && order.splits.length > 0 && (
        <div className={`mb-2 flex gap-1 flex-wrap ${dark ? 'border-t border-white/5 pt-2' : 'border-t border-gray-100 pt-2'}`}>
          {order.splits.map(split => (
            <button
              key={split.id}
              onClick={(e) => {
                e.stopPropagation()
                const splitOrder: OpenOrder = {
                  ...order,
                  id: split.id,
                  displayNumber: split.displayNumber,
                  orderNumber: order.orderNumber,
                  isSplitTicket: true,
                  parentOrderId: order.id,
                  total: split.total,
                  status: split.status,
                  hasSplits: false,
                  splits: [],
                  splitCount: 0,
                  items: [],
                  itemCount: 0,
                  paidAmount: split.isPaid ? split.total : 0,
                }
                onSelectOrder(splitOrder)
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center gap-1.5 ${
                split.isPaid
                  ? (dark ? 'bg-green-600/15 border-green-500/30 text-green-400' : 'bg-green-50 border-green-300 text-green-700')
                  : (dark ? 'bg-indigo-600/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/25' : 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100')
              }`}
            >
              <span>{split.displayNumber}</span>
              <span className="font-bold">{formatCurrency(split.total)}</span>
              {split.isPaid && (
                <span className={`text-[9px] font-bold ${dark ? 'text-green-400' : 'text-green-600'}`}>PAID</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Pre-auth / Tab card info */}
      {order.hasPreAuth && order.preAuth && (
        <div className={`flex items-center gap-2 text-xs font-medium mb-2 ${dark ? 'text-blue-400' : 'text-blue-600'}`}>
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span>{formatCardDisplay(order.preAuth.cardBrand, order.preAuth.last4)}</span>
          {order.preAuth.amount != null && (
            <span className={dark ? 'text-slate-400' : 'text-gray-500'}>
              {formatCurrency(order.preAuth.amount)} hold
            </span>
          )}
        </div>
      )}
      {/* Auth status badge */}
      {order.tabStatus && order.tabStatus !== 'closed' && (
        <div className="mb-2">
          <AuthStatusBadge tabStatus={order.tabStatus as any} dark={dark} />
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
          {order.orderType === 'bar_tab' && (
            <button
              onClick={(e) => { e.stopPropagation(); onTabTransfer(order) }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                dark ? 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30' : 'bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200'
              }`}
            >
              Transfer
            </button>
          )}
        </div>
      )}
      {viewMode === 'open' && isPaidOrClosed && (
        <button
          onClick={(e) => { e.stopPropagation(); onClosedOrderAction(order) }}
          className={`mt-2 w-full text-center py-2 rounded-lg text-sm font-bold transition-colors ${dark ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
        >
          Manage
        </button>
      )}

      {/* Closed order actions */}
      {viewMode === 'closed' && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onClosedOrderAction(order) }}
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
})

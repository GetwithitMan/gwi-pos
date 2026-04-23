'use client'

import { AuthStatusBadge } from '@/components/tabs/AuthStatusBadge'

const ORDER_TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  dine_in: { icon: '🍽️', label: 'Dine In' },
  takeout: { icon: '📦', label: 'Takeout' },
  delivery: { icon: '🚗', label: 'Delivery' },
  bar_tab: { icon: '🍺', label: 'Bar Tab' },
  drive_thru: { icon: '🚗', label: 'Drive Thru' },
  call_in: { icon: '📞', label: 'Call-in' },
}

interface MobileOrderCardOrder {
  id: string
  orderNumber: number
  displayNumber?: string
  orderType: string
  orderTypeConfig?: {
    name: string
    color?: string
    icon?: string
  } | null
  tabName: string | null
  tabStatus: string | null
  cardholderName?: string | null
  tableId?: string | null
  table?: {
    id: string
    name: string
    section: string | null
  } | null
  customer?: {
    id: string
    name: string
  } | null
  status: string
  employee: {
    id: string
    name: string
  }
  itemCount: number
  subtotal?: number
  total: number
  hasPreAuth?: boolean
  preAuth?: {
    cardBrand: string
    last4: string
    amount: number | null
  } | null
  createdAt: string
  openedAt?: string
  closedAt?: string | null
  paidAmount?: number
  paymentMethods?: string[]
  isRolledOver?: boolean
  isCaptureDeclined?: boolean
  reopenedAt?: string | null
  needsTip?: boolean
  hasSplits?: boolean
  splitCount?: number
  ageMinutes?: number
  isBottleService?: boolean
}

interface MobileOrderCardProps {
  order: MobileOrderCardOrder
  onTap: () => void
  showDate?: boolean
  /**
   * Optional handler for the inline "link customer" affordance.
   * When provided, a person icon is rendered next to the order header.
   * Tapping it fires this callback INSTEAD OF the card's onTap (event
   * propagation is stopped) so the modal opens for that specific order.
   */
  onLinkCustomer?: (order: MobileOrderCardOrder) => void
}

function getOrderIcon(order: MobileOrderCardOrder): string {
  if (order.orderTypeConfig?.icon) {
    const iconMap: Record<string, string> = {
      table: '🍽️', wine: '🍷', bag: '📦', truck: '🚚', phone: '📞', car: '🚗',
    }
    return iconMap[order.orderTypeConfig.icon] || '📋'
  }
  if (order.isBottleService) return '🍾'
  return ORDER_TYPE_CONFIG[order.orderType]?.icon || '📋'
}

function getOrderTypeLabel(order: MobileOrderCardOrder): string {
  if (order.orderTypeConfig?.name) return order.orderTypeConfig.name
  return ORDER_TYPE_CONFIG[order.orderType]?.label || order.orderType.replace(/_/g, ' ')
}

function getDisplayName(order: MobileOrderCardOrder): string {
  if (order.tabName) return order.tabName
  if (order.customer?.name) return order.customer.name
  if (order.table?.name) {
    return order.table.section
      ? `${order.table.section} - ${order.table.name}`
      : order.table.name
  }
  return `Order #${order.displayNumber || order.orderNumber}`
}

function getAgeBadge(ageMinutes?: number, isRolledOver?: boolean): { text: string; cls: string } | null {
  if (ageMinutes == null) return null
  if (isRolledOver) {
    const days = Math.floor(ageMinutes / 1440)
    return { text: days > 0 ? `${days}d ago` : 'Rolled', cls: 'bg-red-600/40 text-red-300' }
  }
  if (ageMinutes < 60) return { text: `${ageMinutes}m`, cls: 'bg-emerald-600/30 text-emerald-300' }
  const h = Math.floor(ageMinutes / 60)
  const m = ageMinutes % 60
  if (ageMinutes < 240) return { text: m > 0 ? `${h}h ${m}m` : `${h}h`, cls: 'bg-yellow-600/30 text-yellow-300' }
  return { text: `${h}h`, cls: ageMinutes < 480 ? 'bg-orange-600/30 text-orange-300' : 'bg-red-600/30 text-red-300' }
}

export default function MobileOrderCard({ order, onTap, showDate, onLinkCustomer }: MobileOrderCardProps) {
  const isPaid = order.status === 'paid' || order.status === 'closed'
  const icon = getOrderIcon(order)
  const typeLabel = getOrderTypeLabel(order)
  const displayName = getDisplayName(order)
  const ageBadge = getAgeBadge(order.ageMinutes, order.isRolledOver)

  const timeStr = new Date(order.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const dateStr = showDate
    ? new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · '
    : ''

  return (
    <button
      onClick={onTap}
      className={`w-full text-left p-4 rounded-xl transition-colors active:scale-[0.98] ${
        isPaid
          ? 'bg-green-900/20 border border-green-500/30'
          : order.isCaptureDeclined
            ? 'bg-red-500/10 border border-red-500/30'
            : order.isRolledOver
              ? 'bg-red-900/15 border border-red-500/20'
              : order.tabStatus === 'pending_auth'
                ? 'bg-amber-500/10 border border-amber-500/30 animate-pulse'
                : 'bg-white/5 border border-white/10 hover:bg-white/10'
      }`}
    >
      {/* Top row: icon + name + (optional) link-customer affordance + total */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-base flex-shrink-0">{icon}</span>
          <span className="font-semibold text-white truncate">{displayName}</span>
        </div>
        {onLinkCustomer && !isPaid && (
          <span
            role="button"
            tabIndex={0}
            aria-label={order.customer ? 'Edit linked customer' : 'Link customer'}
            onClick={(e) => {
              e.stopPropagation()
              onLinkCustomer(order)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onLinkCustomer(order)
              }
            }}
            className={`ml-2 inline-flex items-center justify-center min-h-[36px] min-w-[36px] px-2 rounded-lg flex-shrink-0 ${
              order.customer
                ? 'bg-blue-500/20 text-blue-300'
                : 'bg-white/10 text-white/50 hover:bg-white/20'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </span>
        )}
        <div className="ml-2 text-right flex-shrink-0">
          <span className={`text-lg font-bold ${isPaid ? 'text-green-400' : 'text-white'}`}>
            ${order.total.toFixed(2)}
          </span>
          {isPaid && (
            <div className="text-[10px] font-bold text-green-400">PAID</div>
          )}
        </div>
      </div>

      {/* Info row: order #, type badge, employee, time */}
      <div className="flex items-center gap-2 text-sm text-white/40 flex-wrap">
        <span className="text-xs">#{order.displayNumber || order.orderNumber}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white/60">
          {typeLabel}
        </span>
        <span className="text-xs">{order.employee.name}</span>
        <span className="text-xs">{dateStr}{timeStr}</span>
        <span className="text-xs">{order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {/* Table info */}
        {order.table && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-600/20 text-blue-300">
            📍 {order.table.section ? `${order.table.section} - ${order.table.name}` : order.table.name}
          </span>
        )}

        {/* Age badge */}
        {ageBadge && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ageBadge.cls}`}>
            {ageBadge.text}
          </span>
        )}

        {/* Split ticket indicator */}
        {order.hasSplits && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-600/30 text-indigo-300">
            {order.splitCount} splits
          </span>
        )}

        {/* Rolled over */}
        {order.isRolledOver && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600/30 text-red-300">
            📅 Rolled Over
          </span>
        )}

        {/* Capture declined */}
        {order.isCaptureDeclined && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600/40 text-red-300 animate-pulse">
            ⚠ Card Declined
          </span>
        )}

        {/* Reopened */}
        {order.reopenedAt && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-600/30 text-orange-300">
            🔓 Reopened
          </span>
        )}

        {/* Needs tip */}
        {order.needsTip && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-600/30 text-amber-300">
            💰 Needs Tip
          </span>
        )}

        {/* Auth status badge for bar tabs */}
        {order.tabStatus && order.tabStatus !== 'closed' && (
          <AuthStatusBadge tabStatus={order.tabStatus as any} dark />
        )}
      </div>

      {/* Pre-auth card info */}
      {order.hasPreAuth && order.preAuth && (
        <div className="flex items-center gap-2 text-xs font-medium mt-2 text-blue-400">
          <span>💳 {order.preAuth.cardBrand} ···{order.preAuth.last4}</span>
          {order.preAuth.amount != null && (
            <span className="text-white/30">${order.preAuth.amount.toFixed(2)} hold</span>
          )}
        </div>
      )}

      {/* Payment info for closed orders */}
      {isPaid && order.paymentMethods && order.paymentMethods.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2">
          {order.paymentMethods.map((method, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-600/20 text-green-300">
              {method}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

export type { MobileOrderCardOrder }

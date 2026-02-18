'use client'

import { useRef, useState, useEffect, useMemo, useCallback, memo } from 'react'
import { OrderPanelItem, type OrderPanelItemData } from './OrderPanelItem'
import { OrderPanelActions } from './OrderPanelActions'
import { getSeatColor, getSeatBgColor, getSeatTextColor, getSeatBorderColor } from '@/lib/seat-utils'
import { calculateItemTotal } from '@/lib/order-calculations'
import { formatCurrency } from '@/lib/utils'
import { OrderDelayBanner } from './OrderDelayBanner'
import SharedOwnershipModal from '@/components/tips/SharedOwnershipModal'
import type { DatacapResult } from '@/hooks/useDatacap'

export type { OrderPanelItemData }

export interface SeatGroup {
  seatNumber: number | null
  sourceTableId?: string | null
  label: string
  items: OrderPanelItemData[]
}

export interface OrderPanelProps {
  orderId?: string | null
  orderNumber?: number | string | null
  orderType?: string
  tabName?: string
  tableName?: string
  tableId?: string
  locationId?: string
  items: OrderPanelItemData[]
  subtotal: number
  tax: number
  cashTax?: number
  cardTax?: number
  discounts?: number
  total: number
  showItemControls?: boolean
  showEntertainmentTimers?: boolean
  cardLast4?: string
  cardBrand?: string
  hasCard?: boolean
  onItemClick?: (item: OrderPanelItemData) => void
  onItemRemove?: (itemId: string) => void
  onQuantityChange?: (itemId: string, delta: number) => void
  onSend?: () => void
  onPay?: (method?: 'cash' | 'credit') => void
  onPrintCheck?: () => void
  onStartTab?: () => void
  onOtherPayment?: () => void
  onDiscount?: () => void
  onClear?: () => void
  onCancelOrder?: () => void
  onHide?: () => void
  hasSentItems?: boolean
  onItemHoldToggle?: (itemId: string) => void
  onItemNoteEdit?: (itemId: string, currentNote?: string) => void
  onItemCourseChange?: (itemId: string, course: number | null) => void
  onItemEditModifiers?: (itemId: string) => void
  onItemCompVoid?: (item: OrderPanelItemData) => void
  onItemResend?: (item: OrderPanelItemData) => void
  onItemSplit?: (itemId: string) => void
  onSessionEnded?: () => void
  onTimerStarted?: () => void
  onTimeExtended?: () => void
  isSending?: boolean
  className?: string
  expandedItemId?: string | null
  onItemToggleExpand?: (itemId: string) => void
  maxSeats?: number
  maxCourses?: number
  onItemSeatChange?: (itemId: string, seat: number | null) => void
  // Header customization
  renderHeader?: () => React.ReactNode
  hideHeader?: boolean
  // Seat grouping
  seatGroups?: SeatGroup[]
  // OrderPanelActions pass-through props
  hasActiveTab?: boolean
  requireCardForTab?: boolean
  tabCardLast4?: string
  cashSubtotal?: number
  cardSubtotal?: number
  cashDiscountPct?: number
  taxPct?: number
  hasTaxInclusiveItems?: boolean
  roundingAdjustment?: number
  cashTotal?: number
  cardTotal?: number
  cashDiscountAmount?: number
  onPaymentModeChange?: (mode: 'cash' | 'card') => void
  onCloseOrder?: () => void
  onSaveOrderFirst?: () => void
  autoShowPayment?: boolean
  onAutoShowPaymentHandled?: () => void
  // Datacap payment integration
  terminalId?: string
  employeeId?: string
  onPaymentSuccess?: (result: DatacapResult & { tipAmount: number }) => void
  onPaymentCancel?: () => void
  // Quick Pick selection (supports multi-select)
  selectedItemId?: string | null
  selectedItemIds?: Set<string>
  onItemSelect?: (itemId: string) => void
  multiSelectMode?: boolean
  onToggleMultiSelect?: () => void
  onSelectAllPending?: () => void
  // Coursing
  coursingEnabled?: boolean
  courseDelays?: Record<number, { delayMinutes: number; startedAt?: string; firedAt?: string }>
  onSetCourseDelay?: (courseNumber: number, minutes: number) => void
  onFireCourse?: (courseNumber: number) => void
  // Order-level delay
  pendingDelay?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
  onFireDelayed?: () => void
  onCancelDelay?: () => void
  // Per-item delay
  onFireItem?: (itemId: string) => void
  onCancelItemDelay?: (itemId: string) => void
  // Reopened order tracking
  reopenedAt?: string | null
  reopenReason?: string | null
  // Seat filter (floor plan seat tap)
  filterSeatNumber?: number | null
  onClearSeatFilter?: () => void
  // Split ticket navigation
  splitInfo?: {
    displayNumber: string
    currentIndex: number
    totalSplits: number
    allSplitIds: string[]
  }
  onNavigateSplit?: (splitOrderId: string) => void
  onBackToSplitOverview?: () => void
  // Split chips (for showing all split checks in the header)
  splitChips?: {
    id: string
    label: string
    isPaid: boolean
    total: number
  }[]
  onSplitChipSelect?: (splitOrderId: string) => void
  onManageSplits?: () => void
  onPayAll?: () => void
  splitChipsFlashing?: boolean
  onAddSplit?: () => void
  cardPriceMultiplier?: number
}

export const OrderPanel = memo(function OrderPanel({
  orderId,
  orderNumber,
  orderType,
  tabName,
  tableName,
  tableId,
  locationId,
  items,
  subtotal,
  tax,
  cashTax,
  cardTax,
  discounts = 0,
  total,
  showItemControls = false,
  showEntertainmentTimers = false,
  cardLast4,
  cardBrand,
  hasCard,
  onItemClick,
  onItemRemove,
  onQuantityChange,
  onSend,
  onPay,
  onPrintCheck,
  onStartTab,
  onOtherPayment,
  onDiscount,
  onClear,
  onCancelOrder,
  onHide,
  hasSentItems,
  onItemHoldToggle,
  onItemNoteEdit,
  onItemCourseChange,
  onItemEditModifiers,
  onItemCompVoid,
  onItemResend,
  onItemSplit,
  onSessionEnded,
  onTimerStarted,
  onTimeExtended,
  isSending = false,
  className = '',
  expandedItemId,
  onItemToggleExpand,
  maxSeats,
  maxCourses,
  onItemSeatChange,
  // Header customization
  renderHeader,
  hideHeader,
  // Seat grouping
  seatGroups,
  // OrderPanelActions pass-through
  hasActiveTab,
  requireCardForTab,
  tabCardLast4,
  cashSubtotal,
  cardSubtotal,
  cashDiscountPct,
  taxPct,
  hasTaxInclusiveItems,
  roundingAdjustment,
  cashTotal: cashTotalProp,
  cardTotal: cardTotalProp,
  cashDiscountAmount,
  onPaymentModeChange,
  onCloseOrder,
  onSaveOrderFirst,
  autoShowPayment,
  onAutoShowPaymentHandled,
  // Datacap payment
  terminalId,
  employeeId,
  onPaymentSuccess,
  onPaymentCancel,
  // Quick Pick selection (multi-select)
  selectedItemId,
  selectedItemIds,
  onItemSelect,
  multiSelectMode,
  onToggleMultiSelect,
  onSelectAllPending,
  // Coursing
  coursingEnabled,
  courseDelays,
  onSetCourseDelay,
  onFireCourse,
  // Order-level delay
  pendingDelay,
  delayStartedAt,
  delayFiredAt,
  onFireDelayed,
  onCancelDelay,
  // Per-item delay
  onFireItem,
  onCancelItemDelay,
  // Reopened order tracking
  reopenedAt,
  reopenReason,
  // Seat filter
  filterSeatNumber,
  onClearSeatFilter,
  // Split ticket navigation
  splitInfo,
  onNavigateSplit,
  onBackToSplitOverview,
  // Split chips
  splitChips,
  onSplitChipSelect,
  onManageSplits,
  onPayAll,
  splitChipsFlashing,
  onAddSplit,
  cardPriceMultiplier,
}: OrderPanelProps) {
  const hasItems = items.length > 0
  const hasPendingItems = items.some(item =>
    !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')
  )

  // Shared ownership modal
  const [showShareOwnership, setShowShareOwnership] = useState(false)

  // Sort direction: 'newest-bottom' (default, newest appended at bottom) or 'newest-top' (newest at top)
  const [sortDirection, setSortDirection] = useState<'newest-bottom' | 'newest-top'>('newest-bottom')

  // Condensed view: combine like items visually
  const [condensedView, setCondensedView] = useState(false)
  // Track which condensed groups are expanded by the user
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Check overview popover (table name click)
  const [showCheckOverview, setShowCheckOverview] = useState(false)

  // Track newest item for highlight + auto-scroll
  const [newestItemId, setNewestItemId] = useState<string | null>(null)
  const prevItemCountRef = useRef(items.length)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const newestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detect when a new item is added
  useEffect(() => {
    const pendingItems = items.filter(item => !item.kitchenStatus || item.kitchenStatus === 'pending')
    const prevCount = prevItemCountRef.current
    prevItemCountRef.current = items.length

    if (items.length > prevCount && pendingItems.length > 0) {
      // New item was added — highlight the newest pending item
      const newest = sortDirection === 'newest-top' ? pendingItems[0] : pendingItems[pendingItems.length - 1]
      if (newest) {
        setNewestItemId(newest.id)

        // Auto-scroll to newest item
        requestAnimationFrame(() => {
          const container = scrollContainerRef.current
          if (!container) return
          const el = container.querySelector(`[data-item-id="${newest.id}"]`)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        })

        // Clear highlight after 2 seconds
        if (newestTimerRef.current) clearTimeout(newestTimerRef.current)
        newestTimerRef.current = setTimeout(() => setNewestItemId(null), 2000)
      }
    }
  }, [items, sortDirection])

  // Sort pending items based on direction
  const sortPendingItems = (pendingItems: OrderPanelItemData[]) => {
    if (sortDirection === 'newest-top') {
      return [...pendingItems].reverse()
    }
    return pendingItems
  }

  // Pending and sent items
  const pendingItems = useMemo(() =>
    items.filter(item => !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')),
    [items]
  )
  const sentItems = useMemo(() =>
    items.filter(item => item.sentToKitchen || (item.kitchenStatus && item.kitchenStatus !== 'pending')),
    [items]
  )

  // Auto-group items by seat number when multiple seats have items (pre-split checks)
  const autoSeatGroups = useMemo(() => {
    const seatSet = new Set<number>()
    for (const item of items) {
      if (item.seatNumber && (!item.status || item.status === 'active')) seatSet.add(item.seatNumber)
    }
    if (seatSet.size < 2) return null // No grouping needed for 0 or 1 seat
    const seats = Array.from(seatSet).sort((a, b) => a - b)
    const groups: { seatNumber: number | null; items: OrderPanelItemData[]; subtotal: number }[] = seats.map(seatNum => {
      const seatItems = items.filter(i => i.seatNumber === seatNum)
      const subtotal = seatItems
        .filter(i => !i.status || i.status === 'active')
        .reduce((sum, i) => sum + calculateItemTotal(i), 0)
      return { seatNumber: seatNum, items: seatItems, subtotal }
    })
    // Add "No Seat" group for active items without a seat assignment
    const unassignedItems = items.filter(i => !i.seatNumber && (!i.status || i.status === 'active'))
    if (unassignedItems.length > 0) {
      const subtotal = unassignedItems.reduce((sum, i) => sum + calculateItemTotal(i), 0)
      groups.push({ seatNumber: null, items: unassignedItems, subtotal })
    }
    return groups
  }, [items])

  // Auto-group items by split label when viewing a split parent order
  const splitGroups = useMemo(() => {
    const hasSplitLabels = items.some(i => i.splitLabel)
    if (!hasSplitLabels) return null
    const labelMap = new Map<string, OrderPanelItemData[]>()
    for (const item of items) {
      const label = item.splitLabel || 'Unsplit'
      const existing = labelMap.get(label) || []
      existing.push(item)
      labelMap.set(label, existing)
    }
    return Array.from(labelMap.entries()).map(([label, groupItems]) => ({
      label,
      items: groupItems,
      subtotal: groupItems
        .filter(i => !i.status || i.status === 'active')
        .reduce((sum, i) => sum + calculateItemTotal(i), 0),
    }))
  }, [items])

  // Shared item renderer — ensures identical rendering everywhere
  const renderItem = useCallback((item: OrderPanelItemData) => (
    <OrderPanelItem
      key={item.id}
      item={item}
      locationId={locationId}
      showControls={showItemControls}
      showEntertainmentTimer={showEntertainmentTimers}
      onClick={onItemClick}
      onRemove={onItemRemove}
      onQuantityChange={onQuantityChange}
      onSessionEnded={onSessionEnded}
      onTimerStarted={onTimerStarted}
      onTimeExtended={onTimeExtended}
      onHoldToggle={onItemHoldToggle}
      onNoteEdit={onItemNoteEdit}
      onCourseChange={onItemCourseChange}
      onEditModifiers={onItemEditModifiers}
      onCompVoid={onItemCompVoid}
      onResend={onItemResend}
      isExpanded={expandedItemId === item.id}
      onToggleExpand={onItemToggleExpand}
      maxSeats={maxSeats}
      maxCourses={maxCourses}
      onSeatChange={onItemSeatChange}
      isNewest={newestItemId === item.id}
      isSelected={selectedItemIds ? selectedItemIds.has(item.id) : selectedItemId === item.id}
      onSelect={onItemSelect}
      onFireItem={onFireItem}
      onCancelItemDelay={onCancelItemDelay}
      cardPriceMultiplier={cardPriceMultiplier}
    />
  ), [locationId, showItemControls, showEntertainmentTimers, onItemClick, onItemRemove, onQuantityChange, onSessionEnded, onTimerStarted, onTimeExtended, onItemHoldToggle, onItemNoteEdit, onItemCourseChange, onItemEditModifiers, onItemCompVoid, onItemResend, expandedItemId, onItemToggleExpand, maxSeats, maxCourses, onItemSeatChange, newestItemId, selectedItemIds, selectedItemId, onItemSelect, onFireItem, onCancelItemDelay, cardPriceMultiplier])

  // Build a match key for condensing like items
  const getCondenseKey = (item: OrderPanelItemData): string => {
    const mods = (item.modifiers || [])
      .map(m => `${m.name}|${m.price}|${m.preModifier || ''}`)
      .sort()
      .join(';')
    return `${item.name}|${item.price}|${mods}`
  }

  // Condense like items into groups (purely visual — never mutates store)
  const condenseItems = (itemList: OrderPanelItemData[]): (OrderPanelItemData & { _childIds?: string[] })[] => {
    if (!condensedView) return itemList

    const groups = new Map<string, { representative: OrderPanelItemData; childIds: string[]; totalQty: number }>()
    const result: (OrderPanelItemData & { _childIds?: string[] })[] = []

    for (const item of itemList) {
      // Never group voided/comped items — they need individual visibility
      if (item.status === 'voided' || item.status === 'comped') {
        result.push(item)
        continue
      }
      const key = getCondenseKey(item)
      if (expandedGroups.has(key)) {
        // User expanded this group — show individually
        result.push(item)
        continue
      }
      const existing = groups.get(key)
      if (existing) {
        existing.childIds.push(item.id)
        existing.totalQty += item.quantity
      } else {
        groups.set(key, { representative: item, childIds: [item.id], totalQty: item.quantity })
      }
    }

    // Build condensed items from groups
    for (const [, group] of groups) {
      if (group.childIds.length === 1) {
        result.push(group.representative)
      } else {
        result.push({
          ...group.representative,
          quantity: group.totalQty,
          _childIds: group.childIds,
        })
      }
    }

    return result
  }

  // Render a condensed item (with expand affordance)
  const renderCondensedItem = (item: OrderPanelItemData & { _childIds?: string[] }) => {
    if (!item._childIds) return renderItem(item)

    const key = getCondenseKey(item)
    return (
      <div key={item.id} style={{ position: 'relative' }}>
        {renderItem(item)}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpandedGroups(prev => {
              const next = new Set(prev)
              next.add(key)
              return next
            })
          }}
          style={{
            position: 'absolute', top: '4px', right: '4px',
            fontSize: '9px', color: '#818cf8', background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.3)', borderRadius: '4px',
            padding: '1px 5px', cursor: 'pointer', fontWeight: 600,
          }}
        >
          {item._childIds.length} items
        </button>
      </div>
    )
  }

  // Render items with condensing support
  const renderItemList = (itemList: OrderPanelItemData[]) => {
    const condensed = condenseItems(itemList)
    return condensed.map(item =>
      (item as any)._childIds ? renderCondensedItem(item as any) : renderItem(item)
    )
  }

  // Check overview: aggregate items by name for summary (fetches all splits if split order)
  const [checkOverviewItems, setCheckOverviewItems] = useState<{ name: string; qty: number; total: number }[]>([])
  const [checkOverviewTotal, setCheckOverviewTotal] = useState(0)

  useEffect(() => {
    if (!showCheckOverview) return
    if (splitInfo && splitInfo.allSplitIds.length > 0) {
      // Fetch ALL split order items for full-table overview
      Promise.all(
        splitInfo.allSplitIds.map(id =>
          fetch(`/api/orders/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      ).then(results => {
        const groups = new Map<string, { name: string; qty: number; total: number }>()
        let tot = 0
        for (const result of results) {
          // API returns order directly (no data wrapper)
          const order = result?.data ?? result
          if (!order?.items) continue
          tot += Number(order.total ?? 0)
          for (const item of order.items) {
            if (item.status === 'voided' || item.status === 'comped') continue
            const price = Number(item.price ?? 0)
            const qty = item.quantity ?? 1
            const itemTotal = price * qty + (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.price ?? 0) * qty, 0)
            const existing = groups.get(item.name)
            if (existing) { existing.qty += qty; existing.total += itemTotal }
            else groups.set(item.name, { name: item.name, qty, total: itemTotal })
          }
        }
        setCheckOverviewItems(Array.from(groups.values()).sort((a, b) => b.qty - a.qty))
        setCheckOverviewTotal(tot)
      })
    } else {
      // No splits — use current order items
      const groups = new Map<string, { name: string; qty: number; total: number }>()
      for (const item of items) {
        if (item.status === 'voided' || item.status === 'comped') continue
        const existing = groups.get(item.name)
        if (existing) { existing.qty += item.quantity; existing.total += calculateItemTotal(item) }
        else groups.set(item.name, { name: item.name, qty: item.quantity, total: calculateItemTotal(item) })
      }
      setCheckOverviewItems(Array.from(groups.values()).sort((a, b) => b.qty - a.qty))
      setCheckOverviewTotal(total)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCheckOverview, splitInfo?.allSplitIds?.length])

  const renderPendingItems = () => {
    if (pendingItems.length === 0) return null
    const sorted = sortPendingItems(pendingItems)

    return (
      <div>
        {/* Section header with sort toggle + multi-select controls */}
        <div style={{
          fontSize: '11px', fontWeight: 700, color: '#94a3b8',
          textTransform: 'uppercase' as const, letterSpacing: '0.05em',
          marginBottom: '12px', paddingBottom: '8px',
          borderBottom: '2px solid rgba(148, 163, 184, 0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '6px',
        }}>
          <span>PENDING ({pendingItems.length})</span>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Condense toggle */}
            <button
              onClick={() => {
                setCondensedView(v => !v)
                if (condensedView) setExpandedGroups(new Set())
              }}
              title={condensedView ? 'Expand all items' : 'Combine like items'}
              style={{
                background: condensedView ? 'rgba(99,102,241,0.2)' : 'rgba(255, 255, 255, 0.06)',
                border: `1px solid ${condensedView ? 'rgba(99,102,241,0.4)' : 'rgba(255, 255, 255, 0.12)'}`,
                borderRadius: '4px', color: condensedView ? '#a5b4fc' : '#94a3b8', cursor: 'pointer',
                padding: '2px 6px', fontSize: '10px', lineHeight: 1, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '3px',
                transition: 'all 0.15s ease',
              }}
            >
              {condensedView ? '⊞' : '⊟'}
            </button>
            {/* Sort toggle */}
            <button
              onClick={() => setSortDirection(d => d === 'newest-bottom' ? 'newest-top' : 'newest-bottom')}
              title={sortDirection === 'newest-bottom' ? 'Newest at bottom — click for top' : 'Newest at top — click for bottom'}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '4px', color: '#94a3b8', cursor: 'pointer',
                padding: '2px 6px', fontSize: '13px', lineHeight: 1,
                display: 'flex', alignItems: 'center', gap: '3px',
                transition: 'all 0.15s ease',
              }}
            >
              {sortDirection === 'newest-bottom' ? '\u2193' : '\u2191'}
              <span style={{ fontSize: '9px', letterSpacing: '0.03em' }}>NEW</span>
            </button>
          </div>
        </div>

        {/* Order-level delay banner */}
        {pendingDelay && pendingDelay > 0 && onFireDelayed && (
          <OrderDelayBanner
            delayMinutes={pendingDelay}
            startedAt={delayStartedAt ?? null}
            firedAt={delayFiredAt ?? null}
            onAutoFire={onFireDelayed}
            onFireNow={onFireDelayed}
            onCancelDelay={onCancelDelay || (() => {})}
          />
        )}

        {coursingEnabled ? (
          // Course-grouped rendering
          (() => {
            // Group pending items by course number
            const courseGroups = new Map<number, OrderPanelItemData[]>()
            const unassigned: OrderPanelItemData[] = []
            sorted.forEach(item => {
              if (item.courseNumber) {
                const existing = courseGroups.get(item.courseNumber) || []
                existing.push(item)
                courseGroups.set(item.courseNumber, existing)
              } else {
                unassigned.push(item)
              }
            })
            const courseNumbers = Array.from(courseGroups.keys()).sort((a, b) => a - b)

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                {courseNumbers.map(courseNum => {
                  const courseItems = courseGroups.get(courseNum)!
                  const delay = courseDelays?.[courseNum]
                  return (
                    <div key={`course-${courseNum}`}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        marginBottom: '8px', paddingBottom: '6px',
                        borderBottom: '1px solid rgba(59, 130, 246, 0.15)',
                      }}>
                        <span style={{
                          fontSize: '11px', fontWeight: 700,
                          color: '#60a5fa',
                          padding: '2px 8px',
                          background: 'rgba(59, 130, 246, 0.15)',
                          borderRadius: '4px',
                        }}>
                          COURSE {courseNum}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {courseItems.length} item{courseItems.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {renderItemList(courseItems)}
                      </div>
                      {/* Course delay status (fire controls are in the gutter strip) */}
                      {courseNum > 1 && delay?.firedAt && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          padding: '4px 10px', marginTop: '4px',
                          background: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px',
                        }}>
                          <svg width="12" height="12" fill="none" stroke="#22c55e" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span style={{ fontSize: '10px', color: '#4ade80', fontWeight: 600 }}>Fired</span>
                        </div>
                      )}
                      {courseNum > 1 && delay?.startedAt && !delay?.firedAt && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          padding: '4px 10px', marginTop: '4px',
                          background: 'rgba(251, 191, 36, 0.1)', borderRadius: '6px',
                        }}>
                          <svg width="12" height="12" fill="none" stroke="#fbbf24" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 600 }}>Timer running</span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Unassigned items */}
                {unassigned.length > 0 && (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      marginBottom: '8px', paddingBottom: '6px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 600,
                        color: '#94a3b8',
                        padding: '2px 8px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '4px',
                      }}>
                        NO COURSE
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {unassigned.length} item{unassigned.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {renderItemList(unassigned)}
                    </div>
                  </div>
                )}
              </div>
            )
          })()
        ) : splitGroups ? (
          // Split-grouped rendering (viewing split parent with all child items)
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
            {splitGroups.map(group => {
              const groupItems = group.items
              if (groupItems.length === 0) return null
              return (
                <div key={`split-${group.label}`} style={{
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  {/* Split check header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(139, 92, 246, 0.08)',
                    borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: '#8b5cf6',
                      }} />
                      <span style={{
                        fontSize: '12px', fontWeight: 700,
                        color: '#c4b5fd',
                      }}>
                        Check {group.label}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {groupItems.length} item{groupItems.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '12px', fontWeight: 600,
                      color: '#c4b5fd',
                    }}>
                      {formatCurrency(group.subtotal)}
                    </span>
                  </div>
                  {/* Split items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {renderItemList(groupItems)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : autoSeatGroups ? (
          // Auto seat-grouped rendering (pre-split checks)
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
            {autoSeatGroups.map(group => {
              const groupPending = group.items.filter(i =>
                !i.sentToKitchen && (!i.kitchenStatus || i.kitchenStatus === 'pending')
              )
              if (groupPending.length === 0) return null
              const groupSorted = sortDirection === 'newest-top' ? [...groupPending].reverse() : groupPending
              const isUnassigned = group.seatNumber === null
              const seatColor = isUnassigned ? '#94a3b8' : getSeatColor(group.seatNumber!)
              const seatSubtotal = groupPending
                .filter(i => !i.status || i.status === 'active')
                .reduce((sum, i) => sum + calculateItemTotal(i), 0)
              return (
                <div key={`seat-${group.seatNumber ?? 'none'}`} style={{
                  border: `1px solid ${isUnassigned ? 'rgba(148, 163, 184, 0.3)' : getSeatBorderColor(group.seatNumber!)}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  {/* Seat check header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: isUnassigned ? 'rgba(148, 163, 184, 0.08)' : getSeatBgColor(group.seatNumber!),
                    borderBottom: `1px solid ${isUnassigned ? 'rgba(148, 163, 184, 0.2)' : getSeatBorderColor(group.seatNumber!)}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: seatColor,
                      }} />
                      <span style={{
                        fontSize: '12px', fontWeight: 700,
                        color: isUnassigned ? '#94a3b8' : getSeatTextColor(group.seatNumber!),
                      }}>
                        {isUnassigned ? 'No Seat' : `Seat ${group.seatNumber}`}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {groupPending.length} item{groupPending.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '12px', fontWeight: 600,
                      color: isUnassigned ? '#94a3b8' : getSeatTextColor(group.seatNumber!),
                    }}>
                      {formatCurrency(seatSubtotal)}
                    </span>
                  </div>
                  {/* Seat items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {renderItemList(groupSorted)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          // Flat rendering (no seat grouping)
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {renderItemList(sorted)}
          </div>
        )}
      </div>
    )
  }

  const renderSentItems = () => {
    if (sentItems.length === 0) return null
    return (
      <div>
        <div style={{
          fontSize: '11px', fontWeight: 700, color: '#3b82f6',
          textTransform: 'uppercase' as const, letterSpacing: '0.05em',
          marginBottom: '12px', paddingBottom: '8px',
          borderBottom: '2px solid rgba(59, 130, 246, 0.3)'
        }}>
          SENT TO KITCHEN ({sentItems.length})
        </div>
        {splitGroups ? (
          // Split-grouped sent items
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {splitGroups.map(group => {
              const groupSent = group.items.filter(i =>
                i.sentToKitchen || (i.kitchenStatus && i.kitchenStatus !== 'pending')
              )
              if (groupSent.length === 0) return null
              return (
                <div key={`sent-split-${group.label}`} style={{
                  border: '1px solid rgba(139, 92, 246, 0.2)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  opacity: 0.7,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 12px',
                    background: 'rgba(139, 92, 246, 0.06)',
                    borderBottom: '1px solid rgba(139, 92, 246, 0.15)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: '#8b5cf6',
                      }} />
                      <span style={{
                        fontSize: '11px', fontWeight: 700,
                        color: '#c4b5fd',
                      }}>
                        Check {group.label}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px', fontWeight: 600,
                      color: '#c4b5fd',
                    }}>
                      {formatCurrency(group.subtotal)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {renderItemList(groupSent)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : autoSeatGroups ? (
          // Seat-grouped sent items
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {autoSeatGroups.map(group => {
              const groupSent = group.items.filter(i =>
                i.sentToKitchen || (i.kitchenStatus && i.kitchenStatus !== 'pending')
              )
              if (groupSent.length === 0) return null
              const isUnassigned = group.seatNumber === null
              const seatColor = isUnassigned ? '#94a3b8' : getSeatColor(group.seatNumber!)
              const seatSubtotal = groupSent
                .filter(i => !i.status || i.status === 'active')
                .reduce((sum, i) => sum + calculateItemTotal(i), 0)
              return (
                <div key={`sent-seat-${group.seatNumber ?? 'none'}`} style={{
                  border: `1px solid ${isUnassigned ? 'rgba(148, 163, 184, 0.3)' : getSeatBorderColor(group.seatNumber!)}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  opacity: 0.7,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 12px',
                    background: isUnassigned ? 'rgba(148, 163, 184, 0.08)' : getSeatBgColor(group.seatNumber!),
                    borderBottom: `1px solid ${isUnassigned ? 'rgba(148, 163, 184, 0.2)' : getSeatBorderColor(group.seatNumber!)}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: seatColor,
                      }} />
                      <span style={{
                        fontSize: '11px', fontWeight: 700,
                        color: isUnassigned ? '#94a3b8' : getSeatTextColor(group.seatNumber!),
                      }}>
                        {isUnassigned ? 'No Seat' : `Seat ${group.seatNumber}`}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px', fontWeight: 600,
                      color: isUnassigned ? '#94a3b8' : getSeatTextColor(group.seatNumber!),
                    }}>
                      {formatCurrency(seatSubtotal)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {renderItemList(groupSent)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {renderItemList(sentItems)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Header */}
      {!hideHeader && (
        renderHeader ? renderHeader() : (
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <div className="flex items-center justify-between">
              <div style={{ position: 'relative' }}>
                {tableName ? (
                  <>
                    <h2
                      onClick={() => hasItems && setShowCheckOverview(v => !v)}
                      style={{
                        fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0,
                        cursor: hasItems ? 'pointer' : 'default',
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                      }}
                    >
                      {tableName}
                      {hasItems && (
                        <svg width="10" height="10" fill="none" stroke="#64748b" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </h2>
                    {orderNumber && (
                      <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        Order #{orderNumber}
                      </p>
                    )}
                  </>
                ) : orderNumber ? (
                  <h2
                    onClick={() => hasItems && setShowCheckOverview(v => !v)}
                    style={{
                      fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0,
                      cursor: hasItems ? 'pointer' : 'default',
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                    }}
                  >
                    Order #{orderNumber}
                    {hasItems && (
                      <svg width="10" height="10" fill="none" stroke="#64748b" viewBox="0 0 24 24" style={{ opacity: 0.6 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </h2>
                ) : (
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                    New Order
                  </h2>
                )}
                {/* Check Overview Popover */}
                {showCheckOverview && (hasItems || (splitInfo && splitInfo.allSplitIds.length > 0)) && (
                  <>
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 49 }}
                      onClick={() => setShowCheckOverview(false)}
                    />
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: '6px',
                      background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '8px', padding: '12px 16px', zIndex: 50,
                      minWidth: '220px', maxWidth: '300px', maxHeight: '300px', overflowY: 'auto',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    }}>
                      <div style={{
                        fontSize: '10px', fontWeight: 700, color: '#64748b',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        marginBottom: '8px', paddingBottom: '6px',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                      }}>
                        {splitInfo ? 'Table Overview (All Checks)' : 'Check Overview'}
                      </div>
                      {checkOverviewItems.length > 0 ? (
                        <>
                          {checkOverviewItems.map(g => (
                            <div key={g.name} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '3px 0', fontSize: '13px',
                            }}>
                              <span style={{ color: '#e2e8f0' }}>
                                <span style={{ color: '#94a3b8', fontWeight: 600, marginRight: '4px' }}>{g.qty}x</span>
                                {g.name}
                              </span>
                              <span style={{ color: '#94a3b8', fontWeight: 500, marginLeft: '12px', whiteSpace: 'nowrap' }}>
                                {formatCurrency(g.total)}
                              </span>
                            </div>
                          ))}
                          <div style={{
                            display: 'flex', justifyContent: 'space-between',
                            marginTop: '8px', paddingTop: '6px',
                            borderTop: '1px solid rgba(255,255,255,0.08)',
                            fontSize: '13px', fontWeight: 700,
                          }}>
                            <span style={{ color: '#e2e8f0' }}>Total</span>
                            <span style={{ color: '#f1f5f9' }}>{formatCurrency(checkOverviewTotal)}</span>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#64748b', padding: '4px 0' }}>Loading...</div>
                      )}
                    </div>
                  </>
                )}
                {splitInfo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <span style={{ fontSize: '12px', color: '#a5b4fc', fontWeight: 600 }}>
                      Split {splitInfo.displayNumber} ({splitInfo.currentIndex}/{splitInfo.totalSplits})
                    </span>
                    <button
                      onClick={() => {
                        const prevIdx = splitInfo.currentIndex - 2
                        if (prevIdx >= 0 && onNavigateSplit) onNavigateSplit(splitInfo.allSplitIds[prevIdx])
                      }}
                      disabled={splitInfo.currentIndex <= 1}
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '14px',
                        border: 'none',
                        background: splitInfo.currentIndex > 1 ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                        color: splitInfo.currentIndex > 1 ? '#a5b4fc' : '#475569',
                        cursor: splitInfo.currentIndex > 1 ? 'pointer' : 'default',
                      }}
                    >
                      &larr;
                    </button>
                    <button
                      onClick={() => {
                        const nextIdx = splitInfo.currentIndex
                        if (nextIdx < splitInfo.allSplitIds.length && onNavigateSplit) onNavigateSplit(splitInfo.allSplitIds[nextIdx])
                      }}
                      disabled={splitInfo.currentIndex >= splitInfo.totalSplits}
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '14px',
                        border: 'none',
                        background: splitInfo.currentIndex < splitInfo.totalSplits ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                        color: splitInfo.currentIndex < splitInfo.totalSplits ? '#a5b4fc' : '#475569',
                        cursor: splitInfo.currentIndex < splitInfo.totalSplits ? 'pointer' : 'default',
                      }}
                    >
                      &rarr;
                    </button>
                    {onBackToSplitOverview && (
                      <button
                        onClick={onBackToSplitOverview}
                        style={{
                          fontSize: '11px',
                          color: '#8b5cf6',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: '2px 4px',
                        }}
                      >
                        All Splits
                      </button>
                    )}
                  </div>
                )}
                {orderType && (
                  <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', textTransform: 'capitalize' }}>
                    {orderType.replace('_', ' ')}
                  </p>
                )}
                {/* Share Table/Tab button */}
                {orderId && (
                  <button
                    onClick={() => setShowShareOwnership(true)}
                    style={{
                      marginTop: '4px',
                      fontSize: '11px',
                      fontWeight: 500,
                      color: '#a78bfa',
                      padding: '2px 8px',
                      background: 'rgba(167, 139, 250, 0.15)',
                      border: '1px solid rgba(167, 139, 250, 0.3)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Share
                  </button>
                )}
                {/* Card status */}
                {hasCard !== undefined && (
                  <div style={{ marginTop: '6px' }}>
                    {hasCard && cardLast4 ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#4ade80',
                      }}>
                        💳 ****{cardLast4}
                      </span>
                    ) : (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#f87171',
                      }}>
                        ⚠️ No Card
                      </span>
                    )}
                  </div>
                )}
              </div>
              {onHide && (
                <button
                  onClick={onHide}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(100, 116, 139, 0.3)',
                    background: 'rgba(100, 116, 139, 0.15)',
                    color: '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Hide
                </button>
              )}
            </div>
          </div>
        )
      )}

      {/* Split Chips (visible in OrderPanel header when order has splits) */}
      {splitChips && splitChips.length > 0 && (
        <div style={{
          padding: '8px 20px 10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 10, color: '#64748b', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              Split Checks
            </span>
            <div style={{ display: 'flex', gap: 5 }}>
              {splitChips.some(s => !s.isPaid) && onPayAll && (
                <button
                  type="button"
                  onClick={onPayAll}
                  style={{
                    padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(34,197,94,0.5)',
                    background: 'rgba(34,197,94,0.15)',
                    color: '#4ade80', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Pay All
                </button>
              )}
              {onManageSplits && (
                <button
                  type="button"
                  onClick={onManageSplits}
                  style={{
                    padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(168,85,247,0.5)',
                    background: 'rgba(168,85,247,0.15)',
                    color: '#e9d5ff', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Manage Splits
                </button>
              )}
            </div>
          </div>
          <div style={{
            display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4,
            animation: splitChipsFlashing ? 'splitChipsFlash 0.3s ease-in-out 3' : undefined,
          }}>
            <style>{`
              @keyframes splitChipsFlash {
                0%, 100% { background: transparent; }
                50% { background: rgba(168, 85, 247, 0.2); }
              }
            `}</style>
            {splitChips.map(split => (
              <button
                key={split.id}
                type="button"
                onClick={() => onSplitChipSelect?.(split.id)}
                style={{
                  padding: '3px 7px', borderRadius: 6,
                  border: `1px solid ${split.id === orderId ? 'rgba(99,102,241,0.7)' : split.isPaid ? 'rgba(34,197,94,0.5)' : 'rgba(148,163,184,0.3)'}`,
                  background: split.id === orderId ? 'rgba(99,102,241,0.25)' : split.isPaid ? 'rgba(34,197,94,0.12)' : 'rgba(15,23,42,0.9)',
                  color: split.id === orderId ? '#a5b4fc' : split.isPaid ? '#4ade80' : '#e2e8f0',
                  fontSize: 11, fontWeight: split.id === orderId || split.isPaid ? 600 : 500,
                  display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                }}
              >
                <span>{split.label}</span>
                <span style={{ opacity: 0.7 }}>${(cardPriceMultiplier ? split.total * cardPriceMultiplier : split.total).toFixed(2)}</span>
                {split.isPaid && (
                  <span style={{
                    fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '1px 3px', borderRadius: 3, background: 'rgba(34,197,94,0.25)',
                  }}>
                    Paid
                  </span>
                )}
              </button>
            ))}
            {onAddSplit && (
              <button
                type="button"
                onClick={onAddSplit}
                style={{
                  padding: '3px 7px', borderRadius: 6,
                  border: '1px dashed rgba(168,85,247,0.5)',
                  background: 'rgba(168,85,247,0.08)',
                  color: '#c084fc',
                  fontSize: 11, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
                }}
              >
                + New
              </button>
            )}
          </div>
        </div>
      )}

      {/* Seat filter indicator */}
      {filterSeatNumber && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 20px',
          background: getSeatBgColor(filterSeatNumber),
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: getSeatColor(filterSeatNumber),
            }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: getSeatTextColor(filterSeatNumber) }}>
              Showing Seat {filterSeatNumber}
            </span>
          </div>
          {onClearSeatFilter && (
            <button
              onClick={onClearSeatFilter}
              style={{
                fontSize: '12px',
                color: '#94a3b8',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '4px',
                padding: '2px 10px',
                cursor: 'pointer',
              }}
            >
              Show All
            </button>
          )}
        </div>
      )}

      {/* Items list (scrollable) */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {hasItems ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {renderPendingItems()}
            {renderSentItems()}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            textAlign: 'center',
            padding: '40px 20px',
          }}>
            <div>
              <svg
                style={{ margin: '0 auto 16px', opacity: 0.4 }}
                width="48"
                height="48"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#64748b"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <p style={{ fontSize: '14px', color: '#64748b' }}>No items yet</p>
              <p style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                Add items to start an order
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Reopened order banner */}
      {reopenedAt && (
        <div style={{
          margin: '0 8px 8px',
          padding: '8px 12px',
          background: 'rgba(234, 88, 12, 0.15)',
          border: '1px solid rgba(234, 88, 12, 0.4)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '16px' }}>🔓</span>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#fb923c' }}>REOPENED ORDER</span>
            {reopenReason && (
              <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>{reopenReason}</span>
            )}
          </div>
        </div>
      )}

      {/* Footer: Cash/Card toggle + expandable total + Send/Pay/Discount/Clear */}
      <div style={{ flexShrink: 0 }}>
        <OrderPanelActions
          hasItems={hasItems}
          hasPendingItems={hasPendingItems}
          isSending={isSending}
          items={items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, price: i.price, modifiers: i.modifiers }))}
          subtotal={subtotal}
          cashSubtotal={cashSubtotal}
          cardSubtotal={cardSubtotal}
          tax={tax}
          cashTax={cashTax}
          cardTax={cardTax}
          discounts={discounts}
          total={total}
          onSend={onSend}
          onPay={onPay}
          onPrintCheck={onPrintCheck}
          onStartTab={onStartTab}
          onOtherPayment={onOtherPayment}
          onDiscount={onDiscount}
          hasActiveTab={hasActiveTab}
          requireCardForTab={requireCardForTab}
          tabCardLast4={tabCardLast4}
          onClear={onClear}
          onCancelOrder={onCancelOrder}
          onHide={onHide}
          hasSentItems={hasSentItems}
          orderId={orderId}
          terminalId={terminalId}
          employeeId={employeeId}
          onPaymentSuccess={onPaymentSuccess}
          onPaymentCancel={onPaymentCancel}
          cashDiscountPct={cashDiscountPct}
          taxPct={taxPct}
          hasTaxInclusiveItems={hasTaxInclusiveItems}
          roundingAdjustment={roundingAdjustment}
          cashTotal={cashTotalProp}
          cardTotal={cardTotalProp}
          cashDiscount={cashDiscountAmount}
          onPaymentModeChange={onPaymentModeChange}
          onCloseOrder={onCloseOrder}
          onSaveOrderFirst={onSaveOrderFirst}
          autoShowPayment={autoShowPayment}
          onAutoShowPaymentHandled={onAutoShowPaymentHandled}
          onSplit={onItemSplit ? () => onItemSplit('') : undefined}
          orderType={orderType}
        />
      </div>

      {/* Shared Ownership Modal */}
      {orderId && locationId && employeeId && (
        <SharedOwnershipModal
          orderId={orderId}
          locationId={locationId}
          employeeId={employeeId}
          isOpen={showShareOwnership}
          onClose={() => setShowShareOwnership(false)}
        />
      )}
    </div>
  )
})

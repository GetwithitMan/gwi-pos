'use client'

import { useRef, useState, useEffect, useMemo } from 'react'
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
  tableId?: string
  locationId?: string
  items: OrderPanelItemData[]
  subtotal: number
  tax: number
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
  viewMode?: 'floor-plan' | 'bartender' | 'legacy'
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
}

export function OrderPanel({
  orderId,
  orderNumber,
  orderType,
  tabName,
  tableId,
  locationId,
  items,
  subtotal,
  tax,
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
  viewMode,
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
}: OrderPanelProps) {
  const hasItems = items.length > 0
  const hasPendingItems = items.some(item =>
    !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')
  )

  // Shared ownership modal
  const [showShareOwnership, setShowShareOwnership] = useState(false)

  // Sort direction: 'newest-bottom' (default, newest appended at bottom) or 'newest-top' (newest at top)
  const [sortDirection, setSortDirection] = useState<'newest-bottom' | 'newest-top'>('newest-bottom')

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
    return seats.map(seatNum => {
      const seatItems = items.filter(i => i.seatNumber === seatNum)
      const subtotal = seatItems
        .filter(i => !i.status || i.status === 'active')
        .reduce((sum, i) => sum + calculateItemTotal(i), 0)
      return { seatNumber: seatNum, items: seatItems, subtotal }
    })
  }, [items])

  // Card price multiplier for dual pricing display (e.g. 1.04 for 4%)
  const cardPriceMultiplier = cashDiscountPct && cashDiscountPct > 0 ? 1 + cashDiscountPct / 100 : undefined

  // Shared item renderer — ensures identical rendering everywhere
  const renderItem = (item: OrderPanelItemData) => (
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
  )

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
                        {courseItems.map(renderItem)}
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
                      {unassigned.map(renderItem)}
                    </div>
                  </div>
                )}
              </div>
            )
          })()
        ) : autoSeatGroups ? (
          // Auto seat-grouped rendering (pre-split checks)
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
            {autoSeatGroups.map(group => {
              const groupPending = group.items.filter(i =>
                !i.sentToKitchen && (!i.kitchenStatus || i.kitchenStatus === 'pending')
              )
              if (groupPending.length === 0) return null
              const groupSorted = sortDirection === 'newest-top' ? [...groupPending].reverse() : groupPending
              const seatColor = getSeatColor(group.seatNumber)
              const seatSubtotal = groupPending
                .filter(i => !i.status || i.status === 'active')
                .reduce((sum, i) => sum + calculateItemTotal(i), 0)
              return (
                <div key={`seat-${group.seatNumber}`} style={{
                  border: `1px solid ${getSeatBorderColor(group.seatNumber)}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  {/* Seat check header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: getSeatBgColor(group.seatNumber),
                    borderBottom: `1px solid ${getSeatBorderColor(group.seatNumber)}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: seatColor,
                      }} />
                      <span style={{
                        fontSize: '12px', fontWeight: 700,
                        color: getSeatTextColor(group.seatNumber),
                      }}>
                        Seat {group.seatNumber}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {groupPending.length} item{groupPending.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '12px', fontWeight: 600,
                      color: getSeatTextColor(group.seatNumber),
                    }}>
                      {formatCurrency(seatSubtotal)}
                    </span>
                  </div>
                  {/* Seat items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {groupSorted.map(renderItem)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          // Flat rendering (no seat grouping)
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {sorted.map(renderItem)}
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
        {autoSeatGroups ? (
          // Seat-grouped sent items
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {autoSeatGroups.map(group => {
              const groupSent = group.items.filter(i =>
                i.sentToKitchen || (i.kitchenStatus && i.kitchenStatus !== 'pending')
              )
              if (groupSent.length === 0) return null
              const seatColor = getSeatColor(group.seatNumber)
              const seatSubtotal = groupSent
                .filter(i => !i.status || i.status === 'active')
                .reduce((sum, i) => sum + calculateItemTotal(i), 0)
              return (
                <div key={`sent-seat-${group.seatNumber}`} style={{
                  border: `1px solid ${getSeatBorderColor(group.seatNumber)}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  opacity: 0.7,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 12px',
                    background: getSeatBgColor(group.seatNumber),
                    borderBottom: `1px solid ${getSeatBorderColor(group.seatNumber)}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: seatColor,
                      }} />
                      <span style={{
                        fontSize: '11px', fontWeight: 700,
                        color: getSeatTextColor(group.seatNumber),
                      }}>
                        Seat {group.seatNumber}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px', fontWeight: 600,
                      color: getSeatTextColor(group.seatNumber),
                    }}>
                      {formatCurrency(seatSubtotal)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {groupSent.map(renderItem)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sentItems.map(renderItem)}
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
              <div>
                {orderNumber && (
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                    Order #{orderNumber}
                  </h2>
                )}
                {tabName && !orderNumber && (
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                    {tabName}
                  </h2>
                )}
                {!orderNumber && !tabName && (
                  <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                    New Order
                  </h2>
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
              {orderId && (
                <div style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace' }}>
                  {orderId.slice(-8)}
                </div>
              )}
            </div>
          </div>
        )
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
          discounts={discounts}
          total={total}
          onSend={onSend}
          onPay={onPay}
          onPrintCheck={onPrintCheck}
          onStartTab={onStartTab}
          onOtherPayment={onOtherPayment}
          onDiscount={onDiscount}
          viewMode={viewMode}
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
}

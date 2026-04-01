'use client'

import { useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { OrderPanelItem, type OrderPanelItemData } from './OrderPanelItem'
import { OrderDelayBanner } from './OrderDelayBanner'
import { getSeatColor, getSeatBgColor, getSeatTextColor, getSeatBorderColor } from '@/lib/seat-utils'
import { calculateItemTotal } from '@/lib/order-calculations'
import { formatCurrency } from '@/lib/utils'
import { useOrderPanelStore } from '@/stores/order-panel-store'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrderPanelItemListProps {
  orderId?: string | null
  items: OrderPanelItemData[]
  locationId?: string
  showItemControls?: boolean
  showEntertainmentTimers?: boolean
  expandedItemId?: string | null
  maxSeats?: number
  maxCourses?: number
  selectedItemId?: string | null
  selectedItemIds?: Set<string>
  lastSentItemIds?: Set<string>
  cardPriceMultiplier?: number
  selectedSeatNumber?: number | null

  // Coursing
  coursingEnabled?: boolean
  courseDelays?: Record<number, { delayMinutes: number; startedAt?: string; firedAt?: string }>

  // Order-level delay
  pendingDelay?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
  onFireDelayed?: () => void
  onCancelDelay?: () => void

  // Seat selection
  onSeatSelect?: (seatNumber: number | null) => void

  // All item callbacks (ref-based for stability)
  onItemClick?: (item: OrderPanelItemData) => void
  onItemRemove?: (itemId: string) => void
  onQuantityChange?: (itemId: string, delta: number) => void
  onSessionEnded?: () => void
  onTimerStarted?: () => void
  onTimeExtended?: () => void
  onItemHoldToggle?: (itemId: string) => void
  onItemNoteEdit?: (itemId: string, currentNote?: string) => void
  onItemCourseChange?: (itemId: string, course: number | null) => void
  onItemEditModifiers?: (itemId: string) => void
  onItemCompVoid?: (item: OrderPanelItemData) => void
  onItemDiscount?: (itemId: string) => void
  onItemDiscountRemove?: (itemId: string, discountId: string) => void
  onItemResend?: (item: OrderPanelItemData) => void
  onItemRepeat?: (item: OrderPanelItemData) => void
  onItemToggleExpand?: (itemId: string) => void
  onItemSeatChange?: (itemId: string, seat: number | null) => void
  onItemSelect?: (itemId: string) => void
  onFireItem?: (itemId: string) => void
  onCancelItemDelay?: (itemId: string) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export const OrderPanelItemList = memo(function OrderPanelItemList(props: OrderPanelItemListProps) {
  const {
    items,
    locationId,
    showItemControls = false,
    showEntertainmentTimers = false,
    expandedItemId,
    maxSeats,
    maxCourses,
    selectedItemId,
    selectedItemIds,
    lastSentItemIds,
    cardPriceMultiplier,
    selectedSeatNumber,
    coursingEnabled,
    courseDelays,
    pendingDelay,
    delayStartedAt,
    delayFiredAt,
    onFireDelayed,
    onCancelDelay,
    onSeatSelect,
    onItemClick,
    onItemRemove,
    onQuantityChange,
    onSessionEnded,
    onTimerStarted,
    onTimeExtended,
    onItemHoldToggle,
    onItemNoteEdit,
    onItemCourseChange,
    onItemEditModifiers,
    onItemCompVoid,
    onItemDiscount,
    onItemDiscountRemove,
    onItemResend,
    onItemRepeat,
    onItemToggleExpand,
    onItemSeatChange,
    onItemSelect,
    onFireItem,
    onCancelItemDelay,
  } = props

  // Store state
  const sortDirection = useOrderPanelStore(s => s.sortDirection)
  const setSortDirection = useOrderPanelStore(s => s.setSortDirection)
  const condensedView = useOrderPanelStore(s => s.condensedView)
  const setCondensedView = useOrderPanelStore(s => s.setCondensedView)
  const expandedGroups = useOrderPanelStore(s => s.expandedGroups)
  const setExpandedGroups = useOrderPanelStore(s => s.setExpandedGroups)
  const newestItemId = useOrderPanelStore(s => s.newestItemId)
  const setNewestItemId = useOrderPanelStore(s => s.setNewestItemId)
  const seatAllergyNotes = useOrderPanelStore(s => s.seatAllergyNotes)
  const setAllergyModalSeat = useOrderPanelStore(s => s.setAllergyModalSeat)

  // ── Stable callback refs ──
  const onItemClickRef = useRef(onItemClick)
  useEffect(() => { onItemClickRef.current = onItemClick }, [onItemClick])
  const onItemRemoveRef = useRef(onItemRemove)
  useEffect(() => { onItemRemoveRef.current = onItemRemove }, [onItemRemove])
  const onQuantityChangeRef = useRef(onQuantityChange)
  useEffect(() => { onQuantityChangeRef.current = onQuantityChange }, [onQuantityChange])
  const onSessionEndedRef = useRef(onSessionEnded)
  useEffect(() => { onSessionEndedRef.current = onSessionEnded }, [onSessionEnded])
  const onTimerStartedRef = useRef(onTimerStarted)
  useEffect(() => { onTimerStartedRef.current = onTimerStarted }, [onTimerStarted])
  const onTimeExtendedRef = useRef(onTimeExtended)
  useEffect(() => { onTimeExtendedRef.current = onTimeExtended }, [onTimeExtended])
  const onItemHoldToggleRef = useRef(onItemHoldToggle)
  useEffect(() => { onItemHoldToggleRef.current = onItemHoldToggle }, [onItemHoldToggle])
  const onItemNoteEditRef = useRef(onItemNoteEdit)
  useEffect(() => { onItemNoteEditRef.current = onItemNoteEdit }, [onItemNoteEdit])
  const onItemCourseChangeRef = useRef(onItemCourseChange)
  useEffect(() => { onItemCourseChangeRef.current = onItemCourseChange }, [onItemCourseChange])
  const onItemEditModifiersRef = useRef(onItemEditModifiers)
  useEffect(() => { onItemEditModifiersRef.current = onItemEditModifiers }, [onItemEditModifiers])
  const onItemCompVoidRef = useRef(onItemCompVoid)
  useEffect(() => { onItemCompVoidRef.current = onItemCompVoid }, [onItemCompVoid])
  const onItemDiscountRef = useRef(onItemDiscount)
  useEffect(() => { onItemDiscountRef.current = onItemDiscount }, [onItemDiscount])
  const onItemDiscountRemoveRef = useRef(onItemDiscountRemove)
  useEffect(() => { onItemDiscountRemoveRef.current = onItemDiscountRemove }, [onItemDiscountRemove])
  const onItemResendRef = useRef(onItemResend)
  useEffect(() => { onItemResendRef.current = onItemResend }, [onItemResend])
  const onItemRepeatRef = useRef(onItemRepeat)
  useEffect(() => { onItemRepeatRef.current = onItemRepeat }, [onItemRepeat])
  const onItemToggleExpandRef = useRef(onItemToggleExpand)
  useEffect(() => { onItemToggleExpandRef.current = onItemToggleExpand }, [onItemToggleExpand])
  const onItemSeatChangeRef = useRef(onItemSeatChange)
  useEffect(() => { onItemSeatChangeRef.current = onItemSeatChange }, [onItemSeatChange])
  const onItemSelectRef = useRef(onItemSelect)
  useEffect(() => { onItemSelectRef.current = onItemSelect }, [onItemSelect])
  const onFireItemRef = useRef(onFireItem)
  useEffect(() => { onFireItemRef.current = onFireItem }, [onFireItem])
  const onCancelItemDelayRef = useRef(onCancelItemDelay)
  useEffect(() => { onCancelItemDelayRef.current = onCancelItemDelay }, [onCancelItemDelay])

  // ── Long-press refs for seat allergy ──
  const seatLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seatLongPressTriggeredRef = useRef(false)

  // ── Scroll + newest item tracking ──
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevItemCountRef = useRef(items.length)
  const newestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const pendingItems = items.filter(item => !item.kitchenStatus || item.kitchenStatus === 'pending')
    const prevCount = prevItemCountRef.current
    prevItemCountRef.current = items.length

    if (items.length > prevCount && pendingItems.length > 0) {
      const newest = sortDirection === 'newest-top' ? pendingItems[0] : pendingItems[pendingItems.length - 1]
      if (newest) {
        setNewestItemId(newest.id)

        requestAnimationFrame(() => {
          const container = scrollContainerRef.current
          if (!container) return
          const el = container.querySelector(`[data-item-id="${newest.id}"]`)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        })

        if (newestTimerRef.current) clearTimeout(newestTimerRef.current)
        newestTimerRef.current = setTimeout(() => setNewestItemId(null), 2000)
      }
    }
  }, [items, sortDirection, setNewestItemId])

  // ── Computed item groups ──
  const pendingItems = useMemo(() =>
    items.filter(item => !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')),
    [items]
  )
  const sentItems = useMemo(() =>
    items.filter(item => item.sentToKitchen || (item.kitchenStatus && item.kitchenStatus !== 'pending')),
    [items]
  )

  const sortPendingItems = (pending: OrderPanelItemData[]) => {
    if (sortDirection === 'newest-top') return [...pending].reverse()
    return pending
  }

  // ── Auto seat groups ──
  const autoSeatGroups = useMemo(() => {
    const seatSet = new Set<number>()
    for (const item of items) {
      if (item.seatNumber && (!item.status || item.status === 'active')) seatSet.add(item.seatNumber)
    }
    if (seatSet.size < 2) return null
    const seats = Array.from(seatSet).sort((a, b) => a - b)
    const groups: { seatNumber: number | null; items: OrderPanelItemData[]; subtotal: number }[] = seats.map(seatNum => {
      const seatItems = items.filter(i => i.seatNumber === seatNum)
      const subtotal = seatItems
        .filter(i => !i.status || i.status === 'active')
        .reduce((sum, i) => sum + calculateItemTotal(i), 0)
      return { seatNumber: seatNum, items: seatItems, subtotal }
    })
    const unassignedItems = items.filter(i => !i.seatNumber && (!i.status || i.status === 'active'))
    if (unassignedItems.length > 0) {
      const subtotal = unassignedItems.reduce((sum, i) => sum + calculateItemTotal(i), 0)
      groups.push({ seatNumber: null, items: unassignedItems, subtotal })
    }
    return groups
  }, [items])

  // ── Split groups ──
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

  // ── Shared item renderer ──
  const renderItem = useCallback((item: OrderPanelItemData) => (
    <OrderPanelItem
      key={item.id}
      item={item}
      locationId={locationId}
      showControls={showItemControls}
      showEntertainmentTimer={showEntertainmentTimers}
      onClick={onItemClickRef.current}
      onRemove={onItemRemoveRef.current}
      onQuantityChange={onQuantityChangeRef.current}
      onSessionEnded={onSessionEndedRef.current}
      onTimerStarted={onTimerStartedRef.current}
      onTimeExtended={onTimeExtendedRef.current}
      onHoldToggle={onItemHoldToggleRef.current}
      onNoteEdit={onItemNoteEditRef.current}
      onCourseChange={onItemCourseChangeRef.current}
      onEditModifiers={onItemEditModifiersRef.current}
      onCompVoid={onItemCompVoidRef.current}
      onItemDiscount={onItemDiscountRef.current}
      onItemDiscountRemove={onItemDiscountRemoveRef.current}
      onResend={onItemResendRef.current}
      onRepeat={onItemRepeatRef.current}
      isExpanded={expandedItemId === item.id}
      onToggleExpand={onItemToggleExpandRef.current}
      maxSeats={maxSeats}
      maxCourses={maxCourses}
      onSeatChange={onItemSeatChangeRef.current}
      isNewest={newestItemId === item.id}
      isLastSent={lastSentItemIds?.has(item.id)}
      isSelected={selectedItemIds ? selectedItemIds.has(item.id) : selectedItemId === item.id}
      onSelect={onItemSelectRef.current}
      onFireItem={onFireItemRef.current}
      onCancelItemDelay={onCancelItemDelayRef.current}
      cardPriceMultiplier={cardPriceMultiplier}
    />
  ), [locationId, showItemControls, showEntertainmentTimers, expandedItemId, maxSeats, maxCourses, newestItemId, lastSentItemIds, selectedItemIds, selectedItemId, cardPriceMultiplier])

  // ── Condense helpers ──
  const getCondenseKey = (item: OrderPanelItemData): string => {
    const mods = (item.modifiers || [])
      .map(m => `${m.name}|${m.price}|${m.preModifier || ''}`)
      .sort()
      .join(';')
    return `${item.name}|${item.price}|${mods}`
  }

  const condenseItems = (itemList: OrderPanelItemData[]): (OrderPanelItemData & { _childIds?: string[] })[] => {
    if (!condensedView) return itemList
    const groups = new Map<string, { representative: OrderPanelItemData; childIds: string[]; totalQty: number }>()
    const result: (OrderPanelItemData & { _childIds?: string[] })[] = []

    for (const item of itemList) {
      if (item.status === 'voided' || item.status === 'comped') {
        result.push(item)
        continue
      }
      const key = getCondenseKey(item)
      if (expandedGroups.has(key)) {
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

  const renderItemList = (itemList: OrderPanelItemData[]) => {
    const condensed = condenseItems(itemList)
    return condensed.map(item =>
      (item as any)._childIds ? renderCondensedItem(item as any) : renderItem(item)
    )
  }

  // ── Seat header renderer (shared for pending + sent) ──
  const renderSeatHeader = (
    group: { seatNumber: number | null; items: OrderPanelItemData[] },
    seatSubtotal: number,
    options?: { withAllergyLongPress?: boolean; opacity?: number }
  ) => {
    const isUnassigned = group.seatNumber === null
    const seatColor = isUnassigned ? '#94a3b8' : getSeatColor(group.seatNumber!)
    const isSelected = group.seatNumber === selectedSeatNumber
    const hasAllergyNotes = group.seatNumber !== null && !!seatAllergyNotes[group.seatNumber]
    const itemCount = group.items.length

    const touchHandlers = options?.withAllergyLongPress ? {
      onContextMenu: (e: React.MouseEvent) => {
        if (group.seatNumber !== null) {
          e.preventDefault()
          setAllergyModalSeat({ seatNumber: group.seatNumber, position: { x: e.clientX, y: e.clientY } })
        }
      },
      onTouchStart: (e: React.TouchEvent) => {
        seatLongPressTriggeredRef.current = false
        if (group.seatNumber === null) return
        const touch = e.touches[0]
        const pos = { x: touch.clientX, y: touch.clientY }
        seatLongPressTimerRef.current = setTimeout(() => {
          seatLongPressTriggeredRef.current = true
          setAllergyModalSeat({ seatNumber: group.seatNumber!, position: pos })
        }, 600)
      },
      onTouchEnd: () => {
        if (seatLongPressTimerRef.current) {
          clearTimeout(seatLongPressTimerRef.current)
          seatLongPressTimerRef.current = null
        }
      },
      onTouchMove: () => {
        if (seatLongPressTimerRef.current) {
          clearTimeout(seatLongPressTimerRef.current)
          seatLongPressTimerRef.current = null
        }
      },
    } : {}

    return (
      <div
        onClick={() => {
          if (options?.withAllergyLongPress && seatLongPressTriggeredRef.current) {
            seatLongPressTriggeredRef.current = false
            return
          }
          onSeatSelect?.(group.seatNumber)
        }}
        {...touchHandlers}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 10px',
          background: isSelected
            ? 'rgba(99, 102, 241, 0.1)'
            : isUnassigned ? 'rgba(148, 163, 184, 0.08)' : getSeatBgColor(group.seatNumber!),
          borderBottom: `1px solid ${isUnassigned ? 'rgba(148, 163, 184, 0.2)' : getSeatBorderColor(group.seatNumber!)}`,
          borderRadius: '6px 6px 0 0',
          cursor: onSeatSelect ? 'pointer' : undefined,
          borderLeft: isSelected ? '3px solid rgba(99, 102, 241, 0.6)' : `3px solid ${seatColor}`,
          transition: 'border-left-color 0.15s ease, background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: seatColor,
          }} />
          {options?.withAllergyLongPress && hasAllergyNotes && (
            <span style={{
              fontSize: '10px',
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#f87171',
              borderRadius: '4px',
              padding: '1px 5px',
              fontWeight: 600,
            }}>
              ALLERGY
            </span>
          )}
          <span style={{
            fontSize: options?.withAllergyLongPress ? '12px' : '11px',
            fontWeight: 700,
            color: isUnassigned ? '#94a3b8' : getSeatTextColor(group.seatNumber!),
          }}>
            {isUnassigned ? 'No Seat' : `Seat ${group.seatNumber}`}
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {itemCount} item{itemCount !== 1 ? 's' : ''}
          </span>
        </div>
        <span style={{
          fontSize: options?.withAllergyLongPress ? '12px' : '11px',
          fontWeight: 600,
          color: isUnassigned ? '#94a3b8' : getSeatTextColor(group.seatNumber!),
        }}>
          {formatCurrency(seatSubtotal)}
        </span>
      </div>
    )
  }

  // ── Pending items section ──
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
              {condensedView ? '\u229E' : '\u229F'}
            </button>
            {/* Sort toggle */}
            <button
              onClick={() => setSortDirection(d => d === 'newest-bottom' ? 'newest-top' : 'newest-bottom')}
              title={sortDirection === 'newest-bottom' ? 'Newest at bottom \u2014 click for top' : 'Newest at top \u2014 click for bottom'}
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
          // Split-grouped rendering
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {renderItemList(groupItems)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : autoSeatGroups ? (
          // Auto seat-grouped rendering
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
            {autoSeatGroups.map(group => {
              const groupPending = group.items.filter(i =>
                !i.sentToKitchen && (!i.kitchenStatus || i.kitchenStatus === 'pending')
              )
              if (groupPending.length === 0) return null
              const groupSorted = sortDirection === 'newest-top' ? [...groupPending].reverse() : groupPending
              const isUnassigned = group.seatNumber === null
              const seatSubtotal = groupPending
                .filter(i => !i.status || i.status === 'active')
                .reduce((sum, i) => sum + calculateItemTotal(i), 0)
              return (
                <div key={`seat-${group.seatNumber ?? 'none'}`} style={{
                  border: `1px solid ${isUnassigned ? 'rgba(148, 163, 184, 0.3)' : getSeatBorderColor(group.seatNumber!)}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  {renderSeatHeader(
                    { seatNumber: group.seatNumber, items: groupPending },
                    seatSubtotal,
                    { withAllergyLongPress: true }
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 12px' }}>
                    {renderItemList(groupSorted)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          // Flat rendering
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {renderItemList(sorted)}
          </div>
        )}
      </div>
    )
  }

  // ── Sent items section ──
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {autoSeatGroups.map(group => {
              const groupSent = group.items.filter(i =>
                i.sentToKitchen || (i.kitchenStatus && i.kitchenStatus !== 'pending')
              )
              if (groupSent.length === 0) return null
              const isUnassigned = group.seatNumber === null
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
                  {renderSeatHeader(
                    { seatNumber: group.seatNumber, items: groupSent },
                    seatSubtotal,
                  )}
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

  const hasItems = items.length > 0

  return (
    <div ref={scrollContainerRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}>
      {hasItems ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {renderPendingItems()}
          {renderSentItems()}
        </div>
      ) : props.orderId && !props.orderId.startsWith('temp-') ? (
        /* Skeleton: existing order items are loading from server */
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {[0.7, 0.5, 0.85, 0.6].map((w, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{
                height: '14px',
                width: `${w * 100}%`,
                background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s linear infinite',
                borderRadius: '4px',
              }} />
              <div style={{
                height: '12px',
                width: '48px',
                background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s linear infinite',
                borderRadius: '4px',
                marginLeft: '12px',
              }} />
            </div>
          ))}
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
  )
})


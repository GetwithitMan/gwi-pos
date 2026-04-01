'use client'

import { useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { type OrderPanelItemData } from './OrderPanelItem'
import { OrderPanelActions } from './OrderPanelActions'
import { OrderPanelItemList } from './OrderPanelItemList'
import { OrderPanelSplitNav } from './OrderPanelSplitNav'
import { OrderPanelPager } from './OrderPanelPager'
import { OrderPanelModals } from './OrderPanelModals'
import { getSeatColor, getSeatBgColor, getSeatTextColor } from '@/lib/seat-utils'
import { calculateItemTotal } from '@/lib/order-calculations'
import { formatCurrency } from '@/lib/utils'
import { roundToCents } from '@/lib/pricing'
import { ConflictBanner } from './ConflictBanner'
import { ComboSuggestionBanner } from './ComboSuggestionBanner'
import { UpsellPromptBanner } from './UpsellPromptBanner'
import { getSharedSocket } from '@/lib/shared-socket'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { toast } from '@/stores/toast-store'
import { clientLog } from '@/lib/client-logger'
import { useOrderPanelStore } from '@/stores/order-panel-store'
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
  onItemDiscount?: (itemId: string) => void
  onItemDiscountRemove?: (itemId: string, discountId: string) => void
  onItemResend?: (item: OrderPanelItemData) => void
  onItemRepeat?: (item: OrderPanelItemData) => void
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
  // Seat selection (tap seat header to select for adding items)
  onSeatSelect?: (seatNumber: number | null) => void
  selectedSeatNumber?: number | null
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
  onQuickSplitEvenly?: (numWays: number) => void
  onTransferItems?: () => void
  onTransferOrder?: () => void
  onMergeOrders?: () => void
  // Upsell prompt integration
  onAddUpsellItem?: (menuItemId: string) => void
  // Last-sent-batch highlight
  lastSentItemIds?: Set<string>
  // Repeat Round — repeats all items from the last sent batch
  onRepeatRound?: () => void
  // Notification pager support
  pagerNumber?: string | null
  pagerStatus?: string | null
  notificationProvidersActive?: boolean
  onPagerAssigned?: (pagerNumber: string) => void
  // W18: Manual page-now callback (wired to OrderPanelActions)
  onPageNow?: () => void
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
  onItemDiscount,
  onItemDiscountRemove,
  onItemResend,
  onItemRepeat,
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
  // Seat selection
  onSeatSelect,
  selectedSeatNumber,
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
  onQuickSplitEvenly,
  onTransferItems,
  onTransferOrder,
  onMergeOrders,
  // Upsell prompt integration
  onAddUpsellItem,
  // Last-sent-batch highlight
  lastSentItemIds,
  // Repeat Round
  onRepeatRound,
  // Notification pager
  pagerNumber,
  pagerStatus,
  notificationProvidersActive,
  onPagerAssigned,
  onPageNow: onPageNowProp,
}: OrderPanelProps) {
  // ── Store state ──
  const store = useOrderPanelStore()
  const {
    showShareOwnership, setShowShareOwnership,
    showCustomerModal, setShowCustomerModal,
    showCustomerProfile, setShowCustomerProfile,
    showTaxExemptDialog, setShowTaxExemptDialog,
    showCheckOverview, setShowCheckOverview,
    assigningPager, setAssigningPager,
    unassigningPager, setUnassigningPager,
    isPagingNow, setIsPagingNow,
    isTaxExempt, setIsTaxExempt,
    taxExemptToggling, setTaxExemptToggling,
    taxExemptReason, setTaxExemptReason,
    taxExemptId,
    linkedCustomer, setLinkedCustomer,
    loyaltyEnabled, setLoyaltyEnabled,
    setSeatAllergyNotes,
    checkOverviewItems, setCheckOverviewItems,
    checkOverviewTotal, setCheckOverviewTotal,
  } = store

  const hasItems = items.length > 0
  const hasPendingItems = items.some(item =>
    !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')
  )

  // Employee role + permissions for manager-gated features
  const employeeRole = useAuthStore(s => s.employee?.role?.name?.toLowerCase())
  const employeePermissions = useAuthStore(s => s.employee?.permissions ?? [])
  const canTaxExempt = hasPermission(employeePermissions, PERMISSIONS.MGR_TAX_EXEMPT)

  // ── Pager handlers ──
  const customerFetchedForRef = useRef<string | null>(null)
  const orderIdRef = useRef(orderId)
  orderIdRef.current = orderId

  const handleAssignPager = useCallback(async (replaceExisting = false) => {
    if (!orderId || assigningPager) return
    setAssigningPager(true)
    try {
      const res = await fetch('/api/notifications/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectType: 'order', subjectId: orderId, replaceExisting }),
      })
      if (res.ok) {
        const data = await res.json()
        const pager = data?.data?.pagerNumber || data?.data?.deviceNumber
        if (pager) {
          onPagerAssigned?.(pager)
          toast.success(replaceExisting ? `Pager changed to #${pager}` : `Pager #${pager} assigned`)
        }
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error || 'Failed to assign pager')
      }
    } catch {
      toast.error('Failed to assign pager')
    } finally {
      setAssigningPager(false)
    }
  }, [orderId, assigningPager, onPagerAssigned, setAssigningPager])

  const handleUnassignPager = useCallback(async () => {
    if (!orderId || unassigningPager) return
    setUnassigningPager(true)
    try {
      const res = await fetch('/api/notifications/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectType: 'order', subjectId: orderId }),
      })
      if (res.ok) {
        onPagerAssigned?.('')
        toast.success('Pager unassigned')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error || 'Failed to unassign pager')
      }
    } catch {
      toast.error('Failed to unassign pager')
    } finally {
      setUnassigningPager(false)
    }
  }, [orderId, unassigningPager, onPagerAssigned, setUnassigningPager])

  // W18: Default page-now handler
  const handlePageNow = useCallback(async () => {
    if (isPagingNow) return
    if (onPageNowProp) {
      onPageNowProp()
      return
    }
    if (!orderId) return
    setIsPagingNow(true)
    try {
      const res = await fetch('/api/notifications/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectType: 'order', subjectId: orderId }),
      })
      if (res.ok) {
        toast.success('Page sent')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error || 'Failed to send page')
      }
    } catch {
      toast.error('Failed to send page')
    } finally {
      setIsPagingNow(false)
    }
  }, [orderId, onPageNowProp, isPagingNow, setIsPagingNow])

  // ── Customer data fetch ──
  useEffect(() => {
    if (!orderId || orderId.startsWith('temp-')) {
      setLinkedCustomer(null)
      setLoyaltyEnabled(false)
      setIsTaxExempt(false)
      customerFetchedForRef.current = null
      return
    }
    if (customerFetchedForRef.current === orderId) return
    customerFetchedForRef.current = orderId

    const controller = new AbortController()
    void fetch(`/api/orders/${orderId}/customer`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(raw => {
        const data = raw?.data ?? raw
        if (data?.customer) {
          setLinkedCustomer({
            id: data.customer.id,
            firstName: data.customer.firstName,
            lastName: data.customer.lastName,
            loyaltyPoints: data.customer.loyaltyPoints ?? 0,
            tags: data.customer.tags ?? [],
            birthday: data.customer.birthday ?? null,
          })
        } else {
          setLinkedCustomer(null)
        }
        setLoyaltyEnabled(!!data?.loyaltyEnabled)
        setIsTaxExempt(!!data?.isTaxExempt)
      })
      .catch(err => {
        if (err?.name === 'AbortError') return
        setLinkedCustomer(null)
        customerFetchedForRef.current = null
      })
    return () => controller.abort()
  }, [orderId, setLinkedCustomer, setLoyaltyEnabled, setIsTaxExempt])

  // Cross-terminal customer sync
  useEffect(() => {
    if (!orderId || orderId.startsWith('temp-')) return
    const socket = getSharedSocket()
    const handler = (data: { orderId: string; changes?: string[] }) => {
      if (data.orderId === orderId && data.changes?.includes('customer')) {
        customerFetchedForRef.current = null
        void fetch(`/api/orders/${orderId}/customer`)
          .then(r => r.ok ? r.json() : null)
          .then(raw => {
            const d = raw?.data ?? raw
            if (d?.customer) {
              setLinkedCustomer({
                id: d.customer.id,
                firstName: d.customer.firstName,
                lastName: d.customer.lastName,
                loyaltyPoints: d.customer.loyaltyPoints ?? 0,
                tags: d.customer.tags ?? [],
                birthday: d.customer.birthday ?? null,
              })
            } else {
              setLinkedCustomer(null)
            }
            setLoyaltyEnabled(!!d?.loyaltyEnabled)
            setIsTaxExempt(!!d?.isTaxExempt)
            customerFetchedForRef.current = orderId
          })
          .catch(err => clientLog.warn('fire-and-forget failed in orders.OrderPanel:', err))
      }
    }
    socket.on('order:updated', handler)
    return () => { socket.off('order:updated', handler) }
  }, [orderId, setLinkedCustomer, setLoyaltyEnabled, setIsTaxExempt])

  // Handle customer selection from modal
  const handleSelectCustomer = useCallback((customer: any) => {
    const currentOrderId = orderIdRef.current
    if (!currentOrderId) return
    const customerId = customer?.id ?? null

    if (customer) {
      setLinkedCustomer({
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        loyaltyPoints: customer.loyaltyPoints ?? 0,
        tags: customer.tags ?? [],
        birthday: customer.birthday ?? null,
      })
    } else {
      setLinkedCustomer(null)
    }

    void fetch(`/api/orders/${currentOrderId}/customer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId }),
    })
      .then(r => {
        if (!r.ok) {
          setLinkedCustomer(null)
          customerFetchedForRef.current = null
          console.error('Failed to link customer')
        } else {
          return r.json().then(raw => {
            const data = raw?.data ?? raw
            setLoyaltyEnabled(!!data?.loyaltyEnabled)
          })
        }
      })
      .catch(err => clientLog.warn('Operation failed:', err))
  }, [setLinkedCustomer, setLoyaltyEnabled])

  // ── Tax exempt handlers ──
  const handleTaxExemptToggle = useCallback(() => {
    if (!orderId || taxExemptToggling) return
    if (!isTaxExempt) {
      setTaxExemptReason('')
      useOrderPanelStore.getState().setTaxExemptId('')
      setShowTaxExemptDialog(true)
      return
    }
    setTaxExemptToggling(true)
    setIsTaxExempt(false)
    void fetch(`/api/orders/${orderId}/tax-exempt`, {
      method: 'DELETE',
      headers: {
        ...(employeeId ? { 'x-employee-id': employeeId } : {}),
      },
    })
      .then(r => {
        if (!r.ok) {
          setIsTaxExempt(true)
          toast.error(r.status === 403 ? 'Manager permission required for tax exempt' : 'Failed to remove tax exempt')
          console.error('Failed to remove tax exempt')
        }
      })
      .catch(err => {
        setIsTaxExempt(true)
        toast.error('Failed to remove tax exempt')
        console.error('Tax exempt remove error:', err)
      })
      .finally(() => setTaxExemptToggling(false))
  }, [orderId, isTaxExempt, taxExemptToggling, employeeId, setTaxExemptReason, setShowTaxExemptDialog, setTaxExemptToggling, setIsTaxExempt])

  const submitTaxExempt = useCallback(() => {
    if (!orderId || !taxExemptReason.trim()) return
    setTaxExemptToggling(true)
    setShowTaxExemptDialog(false)
    setIsTaxExempt(true)
    void fetch(`/api/orders/${orderId}/tax-exempt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(employeeId ? { 'x-employee-id': employeeId } : {}),
      },
      body: JSON.stringify({ reason: taxExemptReason.trim(), taxId: useOrderPanelStore.getState().taxExemptId.trim() || undefined, employeeId }),
    })
      .then(r => {
        if (!r.ok) {
          setIsTaxExempt(false)
          toast.error(r.status === 403 ? 'Manager permission required for tax exempt' : 'Failed to set tax exempt')
          console.error('Failed to set tax exempt')
        }
      })
      .catch(err => {
        setIsTaxExempt(false)
        toast.error('Failed to set tax exempt')
        console.error('Tax exempt submit error:', err)
      })
      .finally(() => setTaxExemptToggling(false))
  }, [orderId, taxExemptReason, employeeId, setTaxExemptToggling, setShowTaxExemptDialog, setIsTaxExempt])

  // ── Birthday proximity check ──
  const birthdayAlert = useMemo(() => {
    if (!linkedCustomer?.birthday) return null
    const bday = new Date(linkedCustomer.birthday)
    const now = new Date()
    const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate())
    const checkDate = thisYearBday < new Date(now.getFullYear(), now.getMonth(), now.getDate())
      ? new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate())
      : thisYearBday
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diffDays = Math.round((checkDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'today' as const
    if (diffDays <= 7) return diffDays
    return null
  }, [linkedCustomer?.birthday])

  const TAG_COLORS: Record<string, string> = {
    VIP: 'bg-yellow-100 text-yellow-800',
    Regular: 'bg-green-100 text-green-800',
    'First-Timer': 'bg-blue-100 text-blue-800',
    Staff: 'bg-purple-100 text-purple-800',
    Family: 'bg-pink-100 text-pink-800',
    Business: 'bg-gray-100 text-gray-800',
    'Birthday Club': 'bg-red-100 text-red-800',
  }

  // ── Seat allergy notes fetch ──
  useEffect(() => {
    if (!orderId) {
      setSeatAllergyNotes({})
      return
    }
    let cancelled = false
    fetch(`/api/orders/${orderId}/seat-notes`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data?.data?.seatAllergies) return
        const loaded: Record<number, string> = {}
        for (const [seat, notes] of Object.entries(data.data.seatAllergies)) {
          if (typeof notes === 'string' && notes.trim()) {
            loaded[Number(seat)] = notes
          }
        }
        setSeatAllergyNotes(loaded)
      })
      .catch(err => clientLog.warn('Operation failed:', err))
    return () => { cancelled = true }
  }, [orderId, setSeatAllergyNotes])

  // ── Check overview ──
  useEffect(() => {
    if (!showCheckOverview) return
    if (splitInfo && splitInfo.allSplitIds.length > 0) {
      Promise.all(
        splitInfo.allSplitIds.map(id =>
          fetch(`/api/orders/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      ).then(results => {
        const groups = new Map<string, { name: string; qty: number; total: number }>()
        let tot = 0
        for (const result of results) {
          const order = result?.data ?? result
          if (!order?.items) continue
          tot += Number(order.total ?? 0)
          for (const item of order.items) {
            if (item.status === 'voided' || item.status === 'comped') continue
            const rawPrice = Number(item.price ?? 0)
            const price = cardPriceMultiplier ? roundToCents(rawPrice * cardPriceMultiplier) : rawPrice
            const qty = item.quantity ?? 1
            const itemTotal = price * qty + (item.modifiers || []).reduce((s: number, m: any) => {
              const modPrice = Number(m.price ?? 0)
              return s + (cardPriceMultiplier ? roundToCents(modPrice * cardPriceMultiplier) : modPrice) * qty
            }, 0)
            const existing = groups.get(item.name)
            if (existing) { existing.qty += qty; existing.total += itemTotal }
            else groups.set(item.name, { name: item.name, qty, total: itemTotal })
          }
        }
        setCheckOverviewItems(Array.from(groups.values()).sort((a, b) => b.qty - a.qty))
        setCheckOverviewTotal(tot)
      })
    } else {
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

  // ── Computed ──
  const pendingItems = useMemo(() =>
    items.filter(item => !item.sentToKitchen && (!item.kitchenStatus || item.kitchenStatus === 'pending')),
    [items]
  )

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      style={{
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
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
                {/* Pager section */}
                <OrderPanelPager
                  pagerNumber={pagerNumber}
                  pagerStatus={pagerStatus}
                  orderId={orderId}
                  notificationProvidersActive={notificationProvidersActive}
                  assigningPager={assigningPager}
                  unassigningPager={unassigningPager}
                  onAssignPager={handleAssignPager}
                  onUnassignPager={handleUnassignPager}
                />
                {/* Share Table/Tab button + Customer button */}
                {orderId && (<>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setShowShareOwnership(true)}
                      style={{
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
                    {/* Customer button */}
                    {linkedCustomer ? (
                      <button
                        onClick={() => setShowCustomerProfile(true)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#f1f5f9',
                          padding: '2px 8px',
                          background: 'rgba(51, 65, 85, 0.9)',
                          border: '1px solid rgba(100, 116, 139, 0.4)',
                          borderRadius: '9999px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkedCustomer.firstName} {(linkedCustomer.lastName || '').charAt(0)}.</span>
                        {loyaltyEnabled && (
                          <>
                            <span style={{ color: '#475569' }}>|</span>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              fontSize: '10px',
                              fontWeight: 600,
                              color: '#67e8f9',
                              background: 'rgba(103, 232, 249, 0.12)',
                              padding: '0px 5px',
                              borderRadius: '9999px',
                            }}>
                              <svg width="9" height="9" fill="#67e8f9" viewBox="0 0 24 24">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                              {linkedCustomer.loyaltyPoints} pts
                            </span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowCustomerModal(true)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 500,
                          color: '#94a3b8',
                          padding: '2px 8px',
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(100, 116, 139, 0.3)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Add Customer
                      </button>
                    )}
                    {/* Tax Exempt toggle */}
                    {orderId && !orderId.startsWith('temp-') && canTaxExempt && (
                      <button
                        onClick={handleTaxExemptToggle}
                        disabled={taxExemptToggling}
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          color: isTaxExempt ? '#fbbf24' : '#64748b',
                          padding: '2px 8px',
                          background: isTaxExempt ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                          border: `1px solid ${isTaxExempt ? 'rgba(251, 191, 36, 0.4)' : 'rgba(100, 116, 139, 0.3)'}`,
                          borderRadius: '4px',
                          cursor: taxExemptToggling ? 'wait' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s ease',
                          minHeight: '24px',
                          opacity: taxExemptToggling ? 0.6 : 1,
                        }}
                      >
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '2px',
                          border: `1.5px solid ${isTaxExempt ? '#fbbf24' : '#64748b'}`,
                          background: isTaxExempt ? '#fbbf24' : 'transparent',
                          position: 'relative',
                        }}>
                          {isTaxExempt && (
                            <svg width="6" height="6" viewBox="0 0 12 12" fill="none" style={{ position: 'absolute', top: '-0.5px', left: '0px' }}>
                              <path d="M2 6l3 3 5-5" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        Tax Exempt
                      </button>
                    )}
                  </div>
                  {/* Customer tag badges + birthday alert */}
                  {linkedCustomer && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                      {linkedCustomer.tags && linkedCustomer.tags.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          {linkedCustomer.tags.includes('banned') && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white">
                              BANNED
                            </span>
                          )}
                          {linkedCustomer.tags.filter(t => t !== 'banned').slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${TAG_COLORS[tag] || 'bg-gray-100 text-gray-700'}`}
                            >
                              {tag}
                            </span>
                          ))}
                          {linkedCustomer.tags.filter(t => t !== 'banned').length > 3 && (
                            <span style={{
                              fontSize: '9px',
                              color: '#64748b',
                              fontWeight: 500,
                            }}>
                              +{linkedCustomer.tags.filter(t => t !== 'banned').length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                      {birthdayAlert !== null && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: birthdayAlert === 'today' ? '#f472b6' : '#a78bfa',
                          padding: '2px 8px',
                          background: birthdayAlert === 'today' ? 'rgba(244, 114, 182, 0.12)' : 'rgba(167, 139, 250, 0.1)',
                          border: `1px solid ${birthdayAlert === 'today' ? 'rgba(244, 114, 182, 0.3)' : 'rgba(167, 139, 250, 0.2)'}`,
                          borderRadius: '6px',
                          alignSelf: 'flex-start',
                        }}>
                          {birthdayAlert === 'today'
                            ? '\uD83C\uDF82 Birthday today!'
                            : `\uD83C\uDF82 Birthday in ${birthdayAlert} day${birthdayAlert === 1 ? '' : 's'}`}
                        </div>
                      )}
                    </div>
                  )}
                </>)}
                {/* Card status */}
                {hasCard !== undefined && (
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                        {'\uD83D\uDCB3'} ****{cardLast4}
                      </span>
                    ) : (
                      <>
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
                          {'\u26A0\uFE0F'} No Card
                        </span>
                        {onStartTab && (orderType === 'bar_tab' || orderType?.includes('tab')) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onStartTab() }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '2px 10px',
                              borderRadius: '4px',
                              background: 'rgba(245, 158, 11, 0.2)',
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              color: '#fbbf24',
                              cursor: 'pointer',
                            }}
                          >
                            {'\uD83D\uDCB3'} Attach Card
                          </button>
                        )}
                      </>
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

      {/* Multi-terminal conflict banner */}
      {orderId && (
        <div style={{ padding: '0 20px' }}>
          <ConflictBanner orderId={orderId} />
        </div>
      )}

      {/* Split Chips */}
      <OrderPanelSplitNav
        orderId={orderId}
        splitChips={splitChips ?? []}
        splitChipsFlashing={splitChipsFlashing}
        cardPriceMultiplier={cardPriceMultiplier}
        onSplitChipSelect={onSplitChipSelect}
        onManageSplits={onManageSplits}
        onPayAll={onPayAll}
        onAddSplit={onAddSplit}
      />

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

      {/* Items list (scrollable) — delegated to sub-component */}
      <OrderPanelItemList
        orderId={orderId}
        items={items}
        locationId={locationId}
        showItemControls={showItemControls}
        showEntertainmentTimers={showEntertainmentTimers}
        expandedItemId={expandedItemId}
        maxSeats={maxSeats}
        maxCourses={maxCourses}
        selectedItemId={selectedItemId}
        selectedItemIds={selectedItemIds}
        lastSentItemIds={lastSentItemIds}
        cardPriceMultiplier={cardPriceMultiplier}
        selectedSeatNumber={selectedSeatNumber}
        coursingEnabled={coursingEnabled}
        courseDelays={courseDelays}
        pendingDelay={pendingDelay}
        delayStartedAt={delayStartedAt}
        delayFiredAt={delayFiredAt}
        onFireDelayed={onFireDelayed}
        onCancelDelay={onCancelDelay}
        onSeatSelect={onSeatSelect}
        onItemClick={onItemClick}
        onItemRemove={onItemRemove}
        onQuantityChange={onQuantityChange}
        onSessionEnded={onSessionEnded}
        onTimerStarted={onTimerStarted}
        onTimeExtended={onTimeExtended}
        onItemHoldToggle={onItemHoldToggle}
        onItemNoteEdit={onItemNoteEdit}
        onItemCourseChange={onItemCourseChange}
        onItemEditModifiers={onItemEditModifiers}
        onItemCompVoid={onItemCompVoid}
        onItemDiscount={onItemDiscount}
        onItemDiscountRemove={onItemDiscountRemove}
        onItemResend={onItemResend}
        onItemRepeat={onItemRepeat}
        onItemToggleExpand={onItemToggleExpand}
        onItemSeatChange={onItemSeatChange}
        onItemSelect={onItemSelect}
        onFireItem={onFireItem}
        onCancelItemDelay={onCancelItemDelay}
      />

      {/* Combo auto-suggest banner */}
      {hasPendingItems && !hasSentItems && (
        <ComboSuggestionBanner
          orderId={orderId ?? null}
          itemCount={pendingItems.length}
          hasSentItems={!!hasSentItems}
        />
      )}

      {/* Upsell prompt banner */}
      {hasItems && (
        <UpsellPromptBanner
          orderId={orderId ?? null}
          locationId={locationId}
          employeeId={employeeId}
          itemCount={items.length}
          onAddItem={onAddUpsellItem}
        />
      )}

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
          <span style={{ fontSize: '16px' }}>{'\uD83D\uDD13'}</span>
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
          onQuickSplitEvenly={onQuickSplitEvenly}
          orderType={orderType}
          onTransferItems={onTransferItems}
          onTransferOrder={onTransferOrder}
          onMergeOrders={onMergeOrders}
          tableId={tableId}
          isTaxExempt={isTaxExempt}
          lastSentItemIds={lastSentItemIds}
          onRepeatRound={onRepeatRound}
          pagerNumber={pagerNumber}
          notificationProvidersActive={notificationProvidersActive}
          onPageNow={handlePageNow}
          isPagingNow={isPagingNow}
        />
      </div>

      {/* Modals — delegated to sub-component */}
      <OrderPanelModals
        orderId={orderId}
        locationId={locationId}
        employeeId={employeeId}
        employeeRole={employeeRole}
        handleSelectCustomer={handleSelectCustomer}
        submitTaxExempt={submitTaxExempt}
      />
    </div>
  )
})

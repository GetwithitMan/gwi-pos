'use client'

import { useCallback } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { useFloorPlanStore } from '@/components/floor-plan/use-floor-plan'
import { calculateCardPrice } from '@/lib/pricing'
import { fetchAndLoadSplitOrder } from '@/lib/split-order-loader'
import { OfflineManager } from '@/lib/offline-manager'
import { SilentErrorBoundary } from '@/components/ui/SilentErrorBoundary'
import { OrderPanel, type OrderPanelItemData } from '@/components/orders/OrderPanel'
import { QuickPickStrip } from '@/components/orders/QuickPickStrip'
import { toast } from '@/stores/toast-store'
import type { WorkflowRules } from '@/types/order-types'
import type { ViewMode, SplitChip, TabCardInfo } from '../types'
import type { OrderTypeConfig } from '@/types/order-types'

interface SharedOrderPanelProps {
  viewMode: ViewMode
  locationId?: string
  employeeId: string
  employee: any

  // Order state
  savedOrderId: string | null
  orderTypes: OrderTypeConfig[]

  // Items
  filteredOrderPanelItems: OrderPanelItemData[]
  orderPanelItems: OrderPanelItemData[]
  filterSeatNumber: number | null
  selectedSeat: { seatNumber: number } | null

  // Pricing
  pricing: any
  requireCardForTab: boolean
  taxInclusiveLiquor: boolean
  taxInclusiveFood: boolean

  // Panel callbacks
  panelCallbacks: any
  activeOrderFull: any

  // Quick pick
  quickPickSelectedId: string | null
  quickPickSelectedIds: Set<string>
  selectQuickPickItem: (id: string) => void
  quickPickMultiSelect: boolean
  toggleQuickPickMultiSelect: () => void
  selectAllPendingQuickPick: () => void
  handleQuickPickNumber: (num: number) => void

  // Split state
  editingChildSplit: boolean
  orderSplitChips: SplitChip[]
  splitChipsFlashing: boolean
  splitParentId: string | null

  // Tab card info
  tabCardInfo: TabCardInfo | null

  // Handlers
  handleSendToKitchen: () => Promise<void>
  handleOpenPayment: () => Promise<void>
  handleOpenDiscount: () => Promise<void>
  handleItemDiscount: (itemId: string) => Promise<void>
  handleItemDiscountRemove: (itemId: string, discountId: string) => Promise<void>
  handleQuickSplitEvenly: (numWays: number) => Promise<void>
  ensureOrderInDB: (employeeId?: string) => Promise<string | null>
  isSendingOrder: boolean

  // Split handlers
  setSplitManageMode: (v: boolean) => void
  setShowSplitTicketManager: (v: boolean) => void
  setOrderSplitChips: (v: any[] | ((prev: any[]) => any[])) => void
  setSavedOrderId: (v: string | null) => void
  setShowPaymentModal: (v: boolean) => void
  setInitialPayMethod: (v: string | undefined) => void
  setOrderToPayId: (v: string | null) => void
  setPaymentTabCards: (v: any[]) => void
  setPayAllSplitsParentId: (v: string | null) => void
  setPayAllSplitsTotal: (v: number) => void
  setPayAllSplitsCardTotal: (v: number) => void
  setShowPayAllSplitsConfirm: (v: boolean) => void

  // View mode
  setViewMode: (v: ViewMode) => void
  setMode: (v: 'bar' | 'food') => void

  // Order cleanup
  clearOrder: () => void
  setOrderSent: (v: boolean) => void
  setSelectedOrderType: (v: any) => void
  setOrderCustomFields: (v: any) => void
  setAppliedDiscounts: (v: any[]) => void

  // Tab flow
  setShowCardTabFlow: (v: boolean) => void
  setCardTabOrderId: (v: string | null) => void
  setShowTabNamePrompt: (v: boolean) => void
  setTabNameCallback: (v: (() => void) | null) => void
  setTabCardInfo: (v: TabCardInfo) => void
  setIsSendingOrder: (v: boolean) => void
  setTabsRefreshTrigger: (fn: (prev: number) => number) => void

  // Refs
  bartenderDeselectTabRef: React.MutableRefObject<(() => void) | null>
  floorPlanDeselectTableRef: React.MutableRefObject<(() => void) | null>
  orderReadyPromiseRef: React.MutableRefObject<Promise<string | null> | null>
}

export function SharedOrderPanel(props: SharedOrderPanelProps) {
  const {
    viewMode,
    locationId,
    employeeId,
    employee,
    savedOrderId,
    orderTypes,
    filteredOrderPanelItems,
    orderPanelItems,
    filterSeatNumber,
    selectedSeat,
    pricing,
    requireCardForTab,
    taxInclusiveLiquor,
    taxInclusiveFood,
    panelCallbacks,
    activeOrderFull,
    quickPickSelectedId,
    quickPickSelectedIds,
    selectQuickPickItem,
    quickPickMultiSelect,
    toggleQuickPickMultiSelect,
    selectAllPendingQuickPick,
    handleQuickPickNumber,
    editingChildSplit,
    orderSplitChips,
    splitChipsFlashing,
    splitParentId,
    tabCardInfo,
    handleSendToKitchen,
    handleOpenPayment,
    handleOpenDiscount,
    handleItemDiscount,
    handleItemDiscountRemove,
    handleQuickSplitEvenly,
    ensureOrderInDB,
    isSendingOrder,
    setSplitManageMode,
    setShowSplitTicketManager,
    setOrderSplitChips,
    setSavedOrderId,
    setShowPaymentModal,
    setInitialPayMethod,
    setOrderToPayId,
    setPaymentTabCards,
    setPayAllSplitsParentId,
    setPayAllSplitsTotal,
    setPayAllSplitsCardTotal,
    setShowPayAllSplitsConfirm,
    setViewMode,
    setMode,
    clearOrder,
    setOrderSent,
    setSelectedOrderType,
    setOrderCustomFields,
    setAppliedDiscounts,
    setShowCardTabFlow,
    setCardTabOrderId,
    setShowTabNamePrompt,
    setTabNameCallback,
    setTabCardInfo,
    setIsSendingOrder,
    setTabsRefreshTrigger,
    bartenderDeselectTabRef,
    floorPlanDeselectTableRef,
    orderReadyPromiseRef,
  } = props

  const currentOrder = useOrderStore(s => s.currentOrder)
  const clearSelectedSeat = useFloorPlanStore(s => s.clearSelectedSeat)

  const handleSeatSelect = useCallback((seatNumber: number | null) => {
    const tableId = currentOrder?.tableId
    if (!tableId) return
    if (seatNumber === null || seatNumber === 0) {
      useFloorPlanStore.getState().clearSelectedSeat()
    } else {
      useFloorPlanStore.getState().selectSeat(tableId, seatNumber)
    }
  }, [currentOrder?.tableId])

  if (!(viewMode === 'floor-plan' || viewMode === 'bartender') || !locationId) {
    return null
  }

  return (
    <div className="flex h-full">
      <SilentErrorBoundary name="OrderPanel">
        <OrderPanel
          orderId={currentOrder?.id || savedOrderId}
          orderNumber={currentOrder?.orderNumber}
          orderType={currentOrder?.orderType || (viewMode === 'bartender' ? 'bar_tab' : undefined)}
          tabName={currentOrder?.tabName}
          tableName={currentOrder?.tableName}
          tableId={currentOrder?.tableId}
          locationId={locationId}
          employeeId={employeeId}
          items={filteredOrderPanelItems}
          filterSeatNumber={filterSeatNumber}
          onClearSeatFilter={clearSelectedSeat}
          onSeatSelect={handleSeatSelect}
          selectedSeatNumber={selectedSeat?.seatNumber ?? null}
          subtotal={pricing.subtotal}
          cashSubtotal={pricing.cashSubtotal}
          cardSubtotal={pricing.cardSubtotal}
          tax={pricing.tax}
          cashTax={pricing.cashTax}
          cardTax={pricing.cardTax}
          discounts={pricing.discounts}
          total={pricing.total}
          showItemControls={true}
          showEntertainmentTimers={true}
          onItemClick={panelCallbacks.onItemClick}
          onItemRemove={panelCallbacks.onItemRemove}
          onQuantityChange={panelCallbacks.onQuantityChange}
          onItemHoldToggle={panelCallbacks.onItemHoldToggle}
          onItemNoteEdit={panelCallbacks.onItemNoteEdit}
          onItemCourseChange={panelCallbacks.onItemCourseChange}
          onItemEditModifiers={panelCallbacks.onItemEditModifiers}
          onItemCompVoid={panelCallbacks.onItemCompVoid}
          onItemDiscount={handleItemDiscount}
          onItemDiscountRemove={handleItemDiscountRemove}
          onItemResend={panelCallbacks.onItemResend}
          onItemSplit={editingChildSplit || orderSplitChips.some(c => c.id === currentOrder?.id) ? undefined : panelCallbacks.onItemSplit}
          onQuickSplitEvenly={savedOrderId && !editingChildSplit && !orderSplitChips.some(c => c.id === currentOrder?.id) ? handleQuickSplitEvenly : undefined}
          onItemSeatChange={panelCallbacks.onItemSeatChange}
          expandedItemId={panelCallbacks.expandedItemId}
          onItemToggleExpand={panelCallbacks.onItemToggleExpand}
          onSend={handleSendToKitchen}
          onPay={async (method) => {
            if (useOrderStore.getState().currentOrder?.status === 'split') {
              setSplitManageMode(true)
              setShowSplitTicketManager(true)
              return
            }
            const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employeeId)
            if (orderId) {
              setInitialPayMethod(method)
              setOrderToPayId(orderId)
              fetch(`/api/orders/${orderId}/cards`)
                .then(r => r.ok ? r.json() : { data: [] })
                .then(d => {
                  const authorized = (d.data || []).filter((c: { status: string }) => c.status === 'authorized')
                  setPaymentTabCards(authorized)
                })
                .catch(() => setPaymentTabCards([]))
              setShowPaymentModal(true)
            }
          }}
          onPrintCheck={async () => {
            const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employeeId)
            if (orderId) {
              try {
                await fetch('/api/print/receipt', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderId, type: 'check' }),
                })
                toast.success('Check sent to printer')
              } catch {
                void OfflineManager.queuePrintJob(orderId, '', 0, []).catch(() => {})
                toast.info('Print queued — will retry when printer available')
              }
            }
          }}
          isSending={isSendingOrder}
          hasActiveTab={!!(tabCardInfo?.cardLast4 || currentOrder?.tabName)}
          requireCardForTab={(() => {
            const barTabOT = orderTypes.find(t => t.slug === 'bar_tab')
            return (barTabOT?.workflowRules as WorkflowRules)?.requireCardOnFile ?? requireCardForTab
          })()}
          tabCardLast4={tabCardInfo?.cardLast4}
          onStartTab={async () => {
            // This is the complex "Start Tab" handler — we keep it inline as it
            // references many local setters and would become hard to pass through
            // a hook. The original page.tsx had the same pattern.
            const store = useOrderStore.getState()
            const items = store.currentOrder?.items
            if (!items?.length) return

            const rawOrderId = store.currentOrder?.id || null
            const { isTempId } = await import('@/lib/order-utils')
            const existingOrderId = rawOrderId && !isTempId(rawOrderId) ? rawOrderId : null

            // Existing tab with saved order
            if (existingOrderId) {
              const capturedOrderId = existingOrderId
              const capturedEmployeeId = employeeId
              const capturedNewItems = items.filter(i => !i.sentToKitchen)
              const optimisticCardLast4 = tabCardInfo?.cardLast4 ?? ''

              const serialisedItems = capturedNewItems.map(item => ({
                menuItemId: item.menuItemId,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                isHeld: item.isHeld || false,
                modifiers: (item.modifiers || []).map(mod => ({
                  modifierId: (mod.id || mod.modifierId) ?? '',
                  name: mod.name,
                  price: Number(mod.price),
                  depth: mod.depth ?? 0,
                  preModifier: mod.preModifier ?? null,
                  spiritTier: mod.spiritTier ?? null,
                  linkedBottleProductId: mod.linkedBottleProductId ?? null,
                  parentModifierId: mod.parentModifierId ?? null,
                })),
                specialNotes: item.specialNotes,
              }))

              bartenderDeselectTabRef.current?.()
              clearOrder()
              setSavedOrderId(null)
              setOrderSent(false)
              setSelectedOrderType(null)
              setOrderCustomFields({})
              toast.success(
                optimisticCardLast4
                  ? `Sending to tab \u2022\u2022\u2022${optimisticCardLast4}\u2026`
                  : 'Sending to tab\u2026'
              )

              void (async () => {
                try {
                  let verifiedCardLast4 = ''
                  try {
                    const cardsRes = await fetch(`/api/orders/${capturedOrderId}/cards`)
                    if (cardsRes.ok) {
                      const cardsData = await cardsRes.json()
                      const activeCard = (cardsData.data || []).find(
                        (c: { status: string }) => c.status === 'authorized'
                      )
                      if (activeCard) {
                        verifiedCardLast4 = activeCard.cardLast4 || ''
                        setTabCardInfo({
                          cardholderName: activeCard.cardholderName || undefined,
                          cardLast4: activeCard.cardLast4,
                          cardType: activeCard.cardType,
                          recordNo: activeCard.recordNo || undefined,
                          authAmount: activeCard.authAmount != null ? Number(activeCard.authAmount) : undefined,
                        })
                      }
                    }
                  } catch { /* use optimistic value */ }

                  const effectiveLast4 = verifiedCardLast4 || optimisticCardLast4

                  if (serialisedItems.length > 0) {
                    const appendRes = await fetch(`/api/orders/${capturedOrderId}/items`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ items: serialisedItems }),
                    })
                    if (!appendRes.ok) {
                      toast.error('Failed to save items \u2014 check the tab')
                      return
                    }
                  }

                  const sendRes = await fetch(`/api/orders/${capturedOrderId}/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employeeId: capturedEmployeeId }),
                  })
                  if (!sendRes.ok) {
                    toast.error('Failed to send to kitchen \u2014 check open orders')
                    return
                  }

                  if (effectiveLast4) {
                    try {
                      const authRes = await fetch(`/api/orders/${capturedOrderId}/auto-increment`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ employeeId: capturedEmployeeId, force: true }),
                      })
                      if (authRes.ok) {
                        const d = await authRes.json()
                        if (d.data?.incremented) {
                          toast.success(`Re-auth \u2713 \u2014 hold $${d.data.newAuthorizedTotal.toFixed(2)} \u2022\u2022\u2022${effectiveLast4}`)
                        } else if (d.data?.action === 'increment_failed') {
                          toast.error(`Re-auth declined \u2022\u2022\u2022${effectiveLast4} \u2014 hold $${d.data.totalAuthorized?.toFixed(2) ?? '?'}`)
                        }
                      }
                    } catch { /* auto-increment is best-effort */ }
                  }
                } catch (err) {
                  console.error('[onStartTab] Background tab update failed:', err)
                  toast.error('Tab may not have updated \u2014 check open orders')
                } finally {
                  setTabsRefreshTrigger(prev => prev + 1)
                }
              })()

              return
            }

            // New tab (no existing order)
            const currentStore = useOrderStore.getState()
            if (currentStore.currentOrder && currentStore.currentOrder.orderType !== 'bar_tab') {
              currentStore.updateOrderType('bar_tab')
            }

            const barTabOT = orderTypes.find(t => t.slug === 'bar_tab')
            const cardRequired = (barTabOT?.workflowRules as WorkflowRules)?.requireCardOnFile ?? requireCardForTab

            if (cardRequired) {
              if (existingOrderId) {
                setCardTabOrderId(existingOrderId)
                setShowCardTabFlow(true)
              } else {
                setCardTabOrderId(null)
                setShowCardTabFlow(true)

                void (async () => {
                  try {
                    const shellRes = await fetch('/api/orders', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        employeeId,
                        locationId,
                        orderType: 'bar_tab',
                        items: [],
                      }),
                    })
                    if (!shellRes.ok) {
                      toast.error('Failed to create order')
                      setShowCardTabFlow(false)
                      return
                    }
                    const shellRaw = await shellRes.json()
                    const shell = shellRaw.data ?? shellRaw
                    const store2 = useOrderStore.getState()
                    store2.updateOrderId(shell.id, shell.orderNumber)
                    setSavedOrderId(shell.id)
                    setCardTabOrderId(shell.id)
                  } catch {
                    toast.error('Failed to save order \u2014 please try again')
                    setShowCardTabFlow(false)
                  }
                })()
              }
            } else {
              setTabNameCallback(() => async () => {
                const store = useOrderStore.getState()
                const tabName = store.currentOrder?.tabName
                if (!tabName) return

                const capturedOrder = store.currentOrder
                if (!capturedOrder || capturedOrder.items.length === 0) return
                const capturedItems = [...capturedOrder.items]
                const capturedEmployeeId = employeeId
                const capturedLocationId = capturedOrder.locationId || locationId

                toast.success('Order sent to kitchen')
                clearOrder()
                setSavedOrderId(null)
                setOrderSent(false)
                setSelectedOrderType(null)
                setOrderCustomFields({})

                void (async () => {
                  try {
                    const res = await fetch('/api/orders', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        employeeId: capturedEmployeeId,
                        locationId: capturedLocationId,
                        orderType: 'bar_tab',
                        tabName,
                        guestCount: capturedOrder.guestCount || 1,
                        items: capturedItems.map(item => ({
                          menuItemId: item.menuItemId,
                          name: item.name,
                          price: item.price,
                          quantity: item.quantity,
                          modifiers: item.modifiers?.map(m => ({
                            modifierId: m.modifierId || m.id,
                            name: m.name,
                            price: m.price,
                            preModifier: m.preModifier,
                            depth: m.depth,
                          })) || [],
                        })),
                      }),
                    })

                    if (!res.ok) {
                      console.error('[onStartTab] Background create failed')
                      toast.error('Tab may not have saved \u2014 check open orders')
                      return
                    }

                    const created = await res.json()

                    const sendRes = await fetch(`/api/orders/${created.id}/send`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ employeeId: capturedEmployeeId }),
                    })
                    if (!sendRes.ok) {
                      console.error('[onStartTab] Background send failed')
                    }
                  } catch (err) {
                    console.error('[onStartTab] Background tab creation failed:', err)
                    toast.error('Tab may not have saved \u2014 check open orders')
                  } finally {
                    setTabsRefreshTrigger(prev => prev + 1)
                  }
                })()
              })
              setShowTabNamePrompt(true)
            }
          }}
          onOtherPayment={async () => {
            const orderId = savedOrderId || useOrderStore.getState().currentOrder?.id || await ensureOrderInDB(employeeId)
            if (orderId) {
              setInitialPayMethod(undefined)
              setOrderToPayId(orderId)
              setShowPaymentModal(true)
            }
          }}
          onDiscount={handleOpenDiscount}
          cashDiscountPct={pricing.cashDiscountRate}
          taxPct={Math.round(pricing.taxRate * 100)}
          cashTotal={pricing.cashTotal}
          cardTotal={pricing.cardTotal}
          cashDiscountAmount={pricing.isDualPricingEnabled ? pricing.cardTotal - pricing.cashTotal : 0}
          hasTaxInclusiveItems={taxInclusiveLiquor || taxInclusiveFood}
          roundingAdjustment={pricing.cashRoundingDelta !== 0 ? pricing.cashRoundingDelta : undefined}
          hasSentItems={currentOrder?.items?.some(i => i.sentToKitchen) ?? false}
          onCancelOrder={() => {
            clearOrder()
            setSavedOrderId(null)
            setSelectedOrderType(null)
            setOrderCustomFields({})
            setOrderSent(false)
            setAppliedDiscounts([])
            useFloorPlanStore.getState().clearSelectedSeat()
          }}
          onHide={() => {
            if (viewMode === 'bartender') {
              bartenderDeselectTabRef.current?.()
            } else {
              floorPlanDeselectTableRef.current?.()
            }
            setSavedOrderId(null)
            setSelectedOrderType(null)
            setOrderCustomFields({})
            setOrderSent(false)
            useFloorPlanStore.getState().clearSelectedSeat()
          }}
          selectedItemId={quickPickSelectedId}
          selectedItemIds={quickPickSelectedIds}
          onItemSelect={selectQuickPickItem}
          multiSelectMode={quickPickMultiSelect}
          onToggleMultiSelect={toggleQuickPickMultiSelect}
          onSelectAllPending={selectAllPendingQuickPick}
          pendingDelay={currentOrder?.pendingDelay ?? undefined}
          delayStartedAt={currentOrder?.delayStartedAt ?? undefined}
          delayFiredAt={currentOrder?.delayFiredAt ?? undefined}
          onFireDelayed={activeOrderFull.handleFireDelayed}
          onCancelDelay={() => useOrderStore.getState().setPendingDelay(null)}
          onFireItem={activeOrderFull.handleFireItem}
          onCancelItemDelay={(itemId) => useOrderStore.getState().setItemDelay([itemId], null)}
          reopenedAt={currentOrder?.reopenedAt}
          reopenReason={currentOrder?.reopenReason}
          hideHeader={viewMode === 'floor-plan'}
          className={viewMode === 'bartender' ? 'w-[360px] flex-shrink-0' : 'flex-1 min-h-0'}
          splitChips={orderSplitChips.length > 0 ? orderSplitChips : undefined}
          splitChipsFlashing={splitChipsFlashing}
          cardPriceMultiplier={pricing.isDualPricingEnabled ? 1 + pricing.cashDiscountRate / 100 : undefined}
          onAddSplit={orderSplitChips.length > 0 ? async () => {
            const parentId = splitParentId || currentOrder?.id
            if (!parentId) return
            try {
              const res = await fetch(`/api/orders/${parentId}/split-tickets/create-check`, { method: 'POST' })
              if (!res.ok) {
                toast.error('Failed to create new split')
                return
              }
              const newSplit = await res.json()
              setOrderSplitChips(prev => [...prev, {
                id: newSplit.id,
                label: newSplit.displayNumber,
                isPaid: false,
                total: 0,
              }])
              const success = await fetchAndLoadSplitOrder(newSplit.id, currentOrder?.tableId ?? undefined)
              if (success) {
                setSavedOrderId(newSplit.id)
              }
              toast.success(`Split ${newSplit.displayNumber} created`)
            } catch {
              toast.error('Failed to create new split')
            }
          } : undefined}
          onSplitChipSelect={orderSplitChips.length > 0 ? async (splitId) => {
            const success = await fetchAndLoadSplitOrder(splitId, currentOrder?.tableId ?? undefined)
            if (success) {
              setSavedOrderId(splitId)
            }
          } : undefined}
          onManageSplits={orderSplitChips.length > 0 ? () => {
            setSplitManageMode(true)
            setShowSplitTicketManager(true)
          } : undefined}
          onPayAll={orderSplitChips.length > 0 ? () => {
            const unpaid = orderSplitChips.filter(c => !c.isPaid)
            if (unpaid.length === 0) return
            const parentId = splitParentId || savedOrderId || currentOrder?.id || ''
            const combinedTotal = unpaid.reduce((sum, c) => sum + c.total, 0)
            const combinedCardTotal = pricing.isDualPricingEnabled
              ? calculateCardPrice(combinedTotal, pricing.cashDiscountRate)
              : combinedTotal
            setPayAllSplitsParentId(parentId)
            setPayAllSplitsTotal(combinedTotal)
            setPayAllSplitsCardTotal(combinedCardTotal)
            setShowPayAllSplitsConfirm(true)
          } : undefined}
        />
      </SilentErrorBoundary>
      {/* Quick Pick Strip */}
      <QuickPickStrip
        selectedItemId={quickPickSelectedId}
        selectedItemQty={quickPickSelectedId ? orderPanelItems.find(i => i.id === quickPickSelectedId)?.quantity : undefined}
        selectedCount={quickPickSelectedIds.size}
        onNumberTap={handleQuickPickNumber}
        multiSelectMode={quickPickMultiSelect}
        onToggleMultiSelect={toggleQuickPickMultiSelect}
        onHoldToggle={quickPickSelectedId ? () => {
          const item = currentOrder?.items.find(i => i.id === quickPickSelectedId)
          if (item) useOrderStore.getState().updateItem(quickPickSelectedId, { isHeld: !item.isHeld })
        } : undefined}
        isHeld={quickPickSelectedId ? currentOrder?.items.find(i => i.id === quickPickSelectedId)?.isHeld : false}
        onSetDelay={(minutes) => {
          const selectedIds = Array.from(quickPickSelectedIds)
          if (selectedIds.length > 0) {
            const store = useOrderStore.getState()
            const allHaveThisDelay = selectedIds.every(id => {
              const item = store.currentOrder?.items.find(i => i.id === id)
              return item?.delayMinutes === minutes
            })
            store.setItemDelay(selectedIds, allHaveThisDelay ? null : minutes)
          } else {
            const current = currentOrder?.pendingDelay
            useOrderStore.getState().setPendingDelay(current === minutes ? null : minutes)
          }
        }}
        activeDelay={(() => {
          const selectedIds = Array.from(quickPickSelectedIds)
          if (selectedIds.length === 0) return currentOrder?.pendingDelay ?? null
          const firstItem = currentOrder?.items.find(i => i.id === selectedIds[0])
          return firstItem?.delayMinutes ?? null
        })()}
      />
    </div>
  )
}

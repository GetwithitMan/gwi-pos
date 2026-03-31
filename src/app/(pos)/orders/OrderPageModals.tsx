'use client'

import { lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { POSDisplaySettingsModal } from '@/components/orders/POSDisplaySettings'
import { NoteEditModal } from '@/components/orders/NoteEditModal'
import { OpenOrdersPanel, type OpenOrder } from '@/components/orders/OpenOrdersPanel'
import { SilentErrorBoundary } from '@/lib/error-boundary'
import { TimeClockModal } from '@/components/time-clock/TimeClockModal'
import { ShiftStartModal } from '@/components/shifts/ShiftStartModal'
import { useAuthStore } from '@/stores/auth-store'
import { useEntertainmentUiStore } from '@/stores/entertainment-ui-store'
import { useOrderStore } from '@/stores/order-store'
import { useOrderPageStore } from '@/stores/order-page-store'
import type { OrderItem, SelectedModifier } from '@/types'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'

const PaymentModal = lazy(() => import('@/components/payment/PaymentModal').then(m => ({ default: m.PaymentModal })))
const DiscountModal = lazy(() => import('@/components/orders/DiscountModal').then(m => ({ default: m.DiscountModal })))
const CompVoidModal = lazy(() => import('@/components/orders/CompVoidModal').then(m => ({ default: m.CompVoidModal })))
const ItemTransferModal = lazy(() => import('@/components/orders/ItemTransferModal').then(m => ({ default: m.ItemTransferModal })))
const TabTransferModal = lazy(() => import('@/components/orders/TabTransferModal').then(m => ({ default: m.TabTransferModal })))
const SplitCheckScreen = lazy(() => import('@/components/orders/SplitCheckScreen').then(m => ({ default: m.SplitCheckScreen })))
const PayAllSplitsModal = lazy(() => import('@/components/orders/PayAllSplitsModal').then(m => ({ default: m.PayAllSplitsModal })))
const ShiftCloseoutModal = lazy(() => import('@/components/shifts/ShiftCloseoutModal').then(m => ({ default: m.ShiftCloseoutModal })))
const ReceiptModal = lazy(() => import('@/components/receipt/ReceiptModal').then(m => ({ default: m.ReceiptModal })))
const ModifierModal = lazy(() => import('@/components/modifiers/ModifierModal').then(m => ({ default: m.ModifierModal })))
const PizzaBuilderModal = lazy(() => import('@/components/pizza/PizzaBuilderModal').then(m => ({ default: m.PizzaBuilderModal })))
const EntertainmentSessionStart = lazy(() => import('@/components/entertainment/EntertainmentSessionStart').then(m => ({ default: m.EntertainmentSessionStart })))
const TimedRentalStartModal = lazy(() => import('@/components/entertainment/TimedRentalStartModal').then(m => ({ default: m.TimedRentalStartModal })))
const TipAdjustmentOverlay = lazy(() => import('@/components/tips/TipAdjustmentOverlay'))
const CardFirstTabFlow = lazy(() => import('@/components/tabs/CardFirstTabFlow').then(m => ({ default: m.CardFirstTabFlow })))
const TabNamePromptModal = lazy(() => import('@/components/tabs/TabNamePromptModal').then(m => ({ default: m.TabNamePromptModal })))
const ComboStepFlow = lazy(() => import('@/components/modifiers/ComboStepFlow').then(m => ({ default: m.ComboStepFlow })))

/**
 * OrderPageModalsProps — dramatically reduced from ~120 props to ~35.
 * All modal open/close state + modal data now lives in useOrderPageStore.
 * Only callbacks, settings, refs, and data from parent hooks remain as props.
 */
export interface OrderPageModalsProps {
  // Employee (needed by many child modals)
  employee: {
    id: string
    displayName?: string
    firstName?: string
    lastName?: string
    location?: { id: string }
    role?: { id?: string; name?: string }
    availableRoles?: { isPrimary: boolean; cashHandlingMode?: string }[]
  }
  permissionsArray: string[]
  savedOrderId: string | null

  // Display settings (settings data from hooks)
  displaySettings: any
  onUpdateSetting: any
  onBatchUpdateSettings: (settings: Record<string, any>) => void

  // Open Orders callbacks
  onSelectOpenOrder: (order: OpenOrder) => void
  onViewOpenOrder: (order: OpenOrder) => void
  onNewTab: () => void
  onClosedOrderAction: () => void
  onViewReceipt: (orderId: string) => void

  // Modifier callbacks + settings
  dualPricing: any
  inlineModifierCallbackRef: React.MutableRefObject<((...args: any[]) => void) | null>
  onAddItemWithModifiers: (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: any[], pourCustomPrice?: number | null) => void
  onUpdateItemWithModifiers: (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: any[], pourCustomPrice?: number | null) => void
  quickPreModifiers?: string[]
  quickPreModifiersEnabled?: boolean

  // Pizza callback + ref
  inlinePizzaCallbackRef: React.MutableRefObject<((config: any) => void) | null>
  onAddPizzaToOrder: (config: any) => void

  // Combo callback + ref
  inlineComboCallbackRef?: React.MutableRefObject<((modifiers: { id: string; name: string; price: number; depth?: number }[]) => void) | null>
  onComboConfirm: (selections: Record<string, Record<string, string[]>>) => void

  // Entertainment callbacks
  onStartEntertainmentWithCurrentOrder: (pkg?: PrepaidPackage) => Promise<void>
  onStartEntertainmentWithNewTab: (tabName: string, pkg?: PrepaidPackage) => Promise<void>
  onStartEntertainmentWithExistingTab: (orderId: string, pkg?: PrepaidPackage) => Promise<void>

  // Timed rental callback + ref
  inlineTimedRentalCallbackRef: React.MutableRefObject<((price: number, blockMinutes: number) => void) | null>
  onStartTimedSession: (rateType?: 'per15Min' | 'per30Min' | 'perHour') => Promise<void>

  // Payment settings + callbacks
  onTabCardsChanged: () => void
  paymentSettings: any
  priceRounding: any
  entertainmentTipsEnabled?: boolean
  currentOrder: any | null
  onPaymentComplete: (receiptData?: any) => void
  orderReadyPromiseRef: React.MutableRefObject<Promise<string | null> | null>
  terminalId: string

  // Receipt settings
  receiptSettings: any
  setPaidOrderId: (v: string | null) => void

  // Card tab callbacks
  onCardTabComplete: (result: any) => Promise<void>
  onCardTabCancel: () => void

  // Discount callback
  onDiscountApplied: (newTotals: { subtotal?: number; discountTotal: number; taxTotal: number; total: number }) => void

  // Comp/Void callback
  onCompVoidComplete: (result: any) => Promise<void>

  // Resend callback
  onConfirmResend: () => Promise<void>

  // Transfer callback
  onTransferComplete: (transferredItemIds: string[]) => Promise<void>

  // Split callbacks
  splitCheckItems: { id: string; seatNumber?: number | null; name: string; price: number; quantity: number; categoryType?: string | null; sentToKitchen?: boolean; isPaid: boolean }[]
  setFloorPlanRefreshTrigger: React.Dispatch<React.SetStateAction<number>>
  setSavedOrderId: (v: string | null) => void
  clearOrder: () => void
  setOrderSent: (v: boolean) => void
  onSplitApplied: () => void
  onPaySplit: (splitId: string) => void
  onPayAllSplits: (splitIds: string[], combinedTotal: number) => void
  onAddCard: (splitId: string) => void
  onAddItems: (splitId: string) => Promise<void>

  // Note edit (from useActiveOrder)
  noteEditTarget: { itemId: string; currentNote?: string; itemName?: string } | null
  closeNoteEditor: () => void
  saveNote: (itemId: string, note: string) => Promise<void>

  // Pay All callbacks
  onPayAllCash: () => void
  onPayAllCard: (cardResult: any) => void

  // Pricing info (for dual pricing in split modals)
  pricing: {
    isDualPricingEnabled: boolean
    cashDiscountRate: number
  }

  // Last Call
  lastCallEnabled?: boolean
}

export function OrderPageModals(props: OrderPageModalsProps) {
  const {
    employee,
    permissionsArray,
    savedOrderId,
    displaySettings,
    onUpdateSetting,
    onBatchUpdateSettings,
    onSelectOpenOrder,
    onViewOpenOrder,
    onNewTab,
    onClosedOrderAction,
    onViewReceipt,
    dualPricing,
    inlineModifierCallbackRef,
    onAddItemWithModifiers,
    onUpdateItemWithModifiers,
    quickPreModifiers,
    quickPreModifiersEnabled,
    inlinePizzaCallbackRef,
    onAddPizzaToOrder,
    inlineComboCallbackRef,
    onComboConfirm,
    onStartEntertainmentWithCurrentOrder,
    onStartEntertainmentWithNewTab,
    onStartEntertainmentWithExistingTab,
    inlineTimedRentalCallbackRef,
    onStartTimedSession,
    onTabCardsChanged,
    paymentSettings,
    priceRounding,
    entertainmentTipsEnabled = true,
    currentOrder,
    onPaymentComplete,
    orderReadyPromiseRef,
    terminalId,
    receiptSettings,
    setPaidOrderId,
    onCardTabComplete,
    onCardTabCancel,
    onDiscountApplied,
    onCompVoidComplete,
    onConfirmResend,
    onTransferComplete,
    splitCheckItems,
    setFloorPlanRefreshTrigger,
    setSavedOrderId,
    clearOrder,
    setOrderSent,
    onSplitApplied,
    onPaySplit,
    onPayAllSplits,
    onAddCard,
    onAddItems,
    noteEditTarget,
    closeNoteEditor,
    saveNote,
    onPayAllCash,
    onPayAllCard,
  } = props

  // ── Read all modal state from the store (atomic selectors) ──
  const showDisplaySettings = useOrderPageStore(s => s.showDisplaySettings)
  const setShowDisplaySettings = useOrderPageStore(s => s.setShowDisplaySettings)

  const showTabsPanel = useOrderPageStore(s => s.showTabsPanel)
  const setShowTabsPanel = useOrderPageStore(s => s.setShowTabsPanel)
  const isTabManagerExpanded = useOrderPageStore(s => s.isTabManagerExpanded)
  const setIsTabManagerExpanded = useOrderPageStore(s => s.setIsTabManagerExpanded)
  const tabsRefreshTrigger = useOrderPageStore(s => s.tabsRefreshTrigger)
  const setShowTipAdjustment = useOrderPageStore(s => s.setShowTipAdjustment)
  const showTipAdjustment = useOrderPageStore(s => s.showTipAdjustment)

  const showModifierModal = useOrderPageStore(s => s.showModifierModal)
  const selectedItem = useOrderPageStore(s => s.selectedItem)
  const itemModifierGroups = useOrderPageStore(s => s.itemModifierGroups)
  const loadingModifiers = useOrderPageStore(s => s.loadingModifiers)
  const editingOrderItem = useOrderPageStore(s => s.editingOrderItem)
  const closeModifierModal = useOrderPageStore(s => s.closeModifierModal)

  const showPizzaModal = useOrderPageStore(s => s.showPizzaModal)
  const selectedPizzaItem = useOrderPageStore(s => s.selectedPizzaItem)
  const selectedPizzaSpecialty = useOrderPageStore(s => s.selectedPizzaSpecialty)
  const editingPizzaItem = useOrderPageStore(s => s.editingPizzaItem)
  const closePizzaModal = useOrderPageStore(s => s.closePizzaModal)

  const showComboModal = useOrderPageStore(s => s.showComboModal)
  const selectedComboItem = useOrderPageStore(s => s.selectedComboItem)
  const comboTemplate = useOrderPageStore(s => s.comboTemplate)
  const closeComboModal = useOrderPageStore(s => s.closeComboModal)

  const showEntertainmentStart = useOrderPageStore(s => s.showEntertainmentStart)
  const entertainmentItem = useOrderPageStore(s => s.entertainmentItem)
  const setShowEntertainmentStart = useOrderPageStore(s => s.setShowEntertainmentStart)
  const setEntertainmentItem = useOrderPageStore(s => s.setEntertainmentItem)

  const showTimedRentalModal = useOrderPageStore(s => s.showTimedRentalModal)
  const selectedTimedItem = useOrderPageStore(s => s.selectedTimedItem)
  const loadingSession = useOrderPageStore(s => s.loadingSession)
  const setShowTimedRentalModal = useOrderPageStore(s => s.setShowTimedRentalModal)
  const setSelectedTimedItem = useOrderPageStore(s => s.setSelectedTimedItem)

  const showPaymentModal = useOrderPageStore(s => s.showPaymentModal)
  const orderToPayId = useOrderPageStore(s => s.orderToPayId)
  const initialPayMethod = useOrderPageStore(s => s.initialPayMethod)
  const paymentTabCards = useOrderPageStore(s => s.paymentTabCards)
  const setShowPaymentModal = useOrderPageStore(s => s.setShowPaymentModal)
  const setOrderToPayId = useOrderPageStore(s => s.setOrderToPayId)
  const setInitialPayMethod = useOrderPageStore(s => s.setInitialPayMethod)

  const showReceiptModal = useOrderPageStore(s => s.showReceiptModal)
  const receiptOrderId = useOrderPageStore(s => s.receiptOrderId)
  const preloadedReceiptData = useOrderPageStore(s => s.preloadedReceiptData)
  const setShowReceiptModal = useOrderPageStore(s => s.setShowReceiptModal)
  const setReceiptOrderId = useOrderPageStore(s => s.setReceiptOrderId)
  const setPreloadedReceiptData = useOrderPageStore(s => s.setPreloadedReceiptData)

  const showCardTabFlow = useOrderPageStore(s => s.showCardTabFlow)
  const cardTabOrderId = useOrderPageStore(s => s.cardTabOrderId)
  const setShowCardTabFlow = useOrderPageStore(s => s.setShowCardTabFlow)

  const showDiscountModal = useOrderPageStore(s => s.showDiscountModal)
  const appliedDiscounts = useOrderPageStore(s => s.appliedDiscounts)
  const itemDiscountTargetId = useOrderPageStore(s => s.itemDiscountTargetId)
  const setShowDiscountModal = useOrderPageStore(s => s.setShowDiscountModal)

  const showCompVoidModal = useOrderPageStore(s => s.showCompVoidModal)
  const compVoidItem = useOrderPageStore(s => s.compVoidItem)
  const setShowCompVoidModal = useOrderPageStore(s => s.setShowCompVoidModal)
  const setCompVoidItem = useOrderPageStore(s => s.setCompVoidItem)

  const resendModal = useOrderPageStore(s => s.resendModal)
  const resendNote = useOrderPageStore(s => s.resendNote)
  const resendLoading = useOrderPageStore(s => s.resendLoading)
  const setResendModal = useOrderPageStore(s => s.setResendModal)
  const setResendNote = useOrderPageStore(s => s.setResendNote)

  const showItemTransferModal = useOrderPageStore(s => s.showItemTransferModal)
  const setShowItemTransferModal = useOrderPageStore(s => s.setShowItemTransferModal)

  const showTabTransferModal = useOrderPageStore(s => s.showTabTransferModal)
  const setShowTabTransferModal = useOrderPageStore(s => s.setShowTabTransferModal)

  const showSplitTicketManager = useOrderPageStore(s => s.showSplitTicketManager)
  const splitManageMode = useOrderPageStore(s => s.splitManageMode)
  const splitParentId = useOrderPageStore(s => s.splitParentId)
  const setShowSplitTicketManager = useOrderPageStore(s => s.setShowSplitTicketManager)
  const setSplitManageMode = useOrderPageStore(s => s.setSplitManageMode)
  const editingChildSplit = useOrderPageStore(s => s.editingChildSplit)
  const setEditingChildSplit = useOrderPageStore(s => s.setEditingChildSplit)
  const splitParentToReturnTo = useOrderPageStore(s => s.splitParentToReturnTo)
  const setSplitParentToReturnTo = useOrderPageStore(s => s.setSplitParentToReturnTo)
  const payAllSplitsQueue = useOrderPageStore(s => s.payAllSplitsQueue)
  const setPayAllSplitsQueue = useOrderPageStore(s => s.setPayAllSplitsQueue)

  const showPayAllSplitsConfirm = useOrderPageStore(s => s.showPayAllSplitsConfirm)
  const payAllSplitsParentId = useOrderPageStore(s => s.payAllSplitsParentId)
  const payAllSplitsTotal = useOrderPageStore(s => s.payAllSplitsTotal)
  const payAllSplitsCardTotal = useOrderPageStore(s => s.payAllSplitsCardTotal)
  const payAllSplitsProcessing = useOrderPageStore(s => s.payAllSplitsProcessing)
  const orderSplitChips = useOrderPageStore(s => s.orderSplitChips)
  const setShowPayAllSplitsConfirm = useOrderPageStore(s => s.setShowPayAllSplitsConfirm)
  const setPayAllSplitsParentId = useOrderPageStore(s => s.setPayAllSplitsParentId)
  const setPayAllSplitsStep = useOrderPageStore(s => s.setPayAllSplitsStep)

  const showTabNamePrompt = useOrderPageStore(s => s.showTabNamePrompt)
  const tabNameCallback = useOrderPageStore(s => s.tabNameCallback)
  const tabCardInfo = useOrderPageStore(s => s.tabCardInfo)
  const setShowTabNamePrompt = useOrderPageStore(s => s.setShowTabNamePrompt)
  const setTabNameCallback = useOrderPageStore(s => s.setTabNameCallback)

  const showTimeClockModal = useOrderPageStore(s => s.showTimeClockModal)
  const setShowTimeClockModal = useOrderPageStore(s => s.setShowTimeClockModal)
  const currentShift = useOrderPageStore(s => s.currentShift)
  const setCurrentShift = useOrderPageStore(s => s.setCurrentShift)
  const setShowShiftCloseoutModal = useOrderPageStore(s => s.setShowShiftCloseoutModal)
  const showShiftStartModal = useOrderPageStore(s => s.showShiftStartModal)
  const setShowShiftStartModal = useOrderPageStore(s => s.setShowShiftStartModal)
  const showShiftCloseoutModal = useOrderPageStore(s => s.showShiftCloseoutModal)

  const setTabsRefreshTrigger = useOrderPageStore(s => s.setTabsRefreshTrigger)

  return (
    <>
      {/* Display Settings Modal */}
      <POSDisplaySettingsModal
        isOpen={showDisplaySettings}
        onClose={() => setShowDisplaySettings(false)}
        settings={displaySettings}
        onUpdate={onUpdateSetting}
        onBatchUpdate={onBatchUpdateSettings}
      />

      {/* Open Orders / Tabs Panel */}
      <>
        {showTabsPanel && !isTabManagerExpanded && (
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowTabsPanel(false)}
          />
        )}
        <div className={isTabManagerExpanded ? '' : 'fixed left-0 top-0 bottom-0 w-80 bg-slate-900 shadow-xl z-50'} style={!showTabsPanel && !isTabManagerExpanded ? { display: 'none' } : undefined}>
          <SilentErrorBoundary name="OpenOrders">
          <OpenOrdersPanel
            locationId={employee?.location?.id}
            employeeId={employee.id}
            employeePermissions={permissionsArray}
            refreshTrigger={tabsRefreshTrigger}
            isExpanded={isTabManagerExpanded}
            onToggleExpand={() => setIsTabManagerExpanded(!isTabManagerExpanded)}
            currentOrderId={savedOrderId || undefined}
            onSelectOrder={onSelectOpenOrder}
            onViewOrder={onViewOpenOrder}
            onNewTab={onNewTab}
            onClosedOrderAction={onClosedOrderAction}
            onOpenTipAdjustment={() => setShowTipAdjustment(true)}
            onViewReceipt={onViewReceipt}
            lastCallEnabled={props.lastCallEnabled}
          />
          </SilentErrorBoundary>
        </div>
      </>

      {/* Modifier Modal */}
      {showModifierModal && selectedItem && (
        <Suspense fallback={null}>
          <ModifierModal
            item={selectedItem}
            modifierGroups={itemModifierGroups}
            loading={loadingModifiers}
            editingItem={editingOrderItem}
            dualPricing={dualPricing}
            initialNotes={editingOrderItem?.specialNotes}
            quickPreModifiers={quickPreModifiers}
            quickPreModifiersEnabled={quickPreModifiersEnabled}
            onConfirm={editingOrderItem && !inlineModifierCallbackRef.current ? onUpdateItemWithModifiers : onAddItemWithModifiers}
            onCancel={() => {
              closeModifierModal()
              inlineModifierCallbackRef.current = null
            }}
          />
        </Suspense>
      )}

      {/* Pizza Builder Modal */}
      {showPizzaModal && selectedPizzaItem && (
        <Suspense fallback={null}>
          <PizzaBuilderModal
            item={selectedPizzaItem}
            specialty={selectedPizzaSpecialty}
            editingItem={editingPizzaItem}
            onConfirm={onAddPizzaToOrder}
            onCancel={() => {
              closePizzaModal()
              inlinePizzaCallbackRef.current = null
            }}
          />
        </Suspense>
      )}

      {/* Combo Builder Modal */}
      {showComboModal && selectedComboItem && comboTemplate && (
        <Suspense fallback={null}>
          <ComboStepFlow
            item={selectedComboItem}
            template={comboTemplate}
            onConfirm={(selections) => {
              onComboConfirm(selections)
            }}
            onCancel={() => {
              closeComboModal()
              if (inlineComboCallbackRef) inlineComboCallbackRef.current = null
            }}
          />
        </Suspense>
      )}

      {/* Entertainment Session Start Modal */}
      {showEntertainmentStart && entertainmentItem && (
        <Suspense fallback={null}>
          <Modal isOpen={showEntertainmentStart && !!entertainmentItem} onClose={() => {
            // Clear pending lock on cancel/dismiss
            if (entertainmentItem?.id) {
              useEntertainmentUiStore.getState().clearPending(entertainmentItem.id)
            }
            setShowEntertainmentStart(false)
            setEntertainmentItem(null)
          }} size="md">
            <EntertainmentSessionStart
              itemName={entertainmentItem.name}
              itemId={entertainmentItem.id}
              locationId={employee?.location?.id || ''}
              ratePerMinute={entertainmentItem.ratePerMinute || 0.25}
              prepaidPackages={entertainmentItem.prepaidPackages}
              happyHour={entertainmentItem.happyHourEnabled ? {
                enabled: true,
                discount: 0,
                start: '',
                end: '',
                days: [],
              } : undefined}
              currentOrderId={savedOrderId || null}
              currentOrderName={currentOrder?.tabName || null}
              openTabs={[]}
              onStartWithCurrentOrder={onStartEntertainmentWithCurrentOrder}
              onStartWithNewTab={onStartEntertainmentWithNewTab}
              onStartWithExistingTab={onStartEntertainmentWithExistingTab}
              onClose={() => {
                if (entertainmentItem?.id) {
                  useEntertainmentUiStore.getState().clearPending(entertainmentItem.id)
                }
                setShowEntertainmentStart(false)
                setEntertainmentItem(null)
              }}
            />
          </Modal>
        </Suspense>
      )}

      {/* Timed Rental Start Modal */}
      {showTimedRentalModal && selectedTimedItem && (
        <Suspense fallback={null}>
          <TimedRentalStartModal
            isOpen={showTimedRentalModal && !!selectedTimedItem}
            item={selectedTimedItem}
            onStart={onStartTimedSession}
            onClose={() => { setShowTimedRentalModal(false); setSelectedTimedItem(null); inlineTimedRentalCallbackRef.current = null }}
            loading={loadingSession}
          />
        </Suspense>
      )}

      {/* Payment Modal */}
      {showPaymentModal && orderToPayId && (
        <Suspense fallback={null}>
          <PaymentModal
            key={orderToPayId}
            isOpen={showPaymentModal}
            initialMethod={initialPayMethod}
            onClose={() => {
              setShowPaymentModal(false)
              setOrderToPayId(null)
              setInitialPayMethod(undefined)
            }}
            orderId={orderToPayId}
            orderTotal={currentOrder?.total ?? 0}
            subtotal={currentOrder?.subtotal}
            remainingBalance={currentOrder?.total ?? 0}
            tipExemptAmount={
              currentOrder?.items
                ?.filter((i: any) => i.status !== 'voided' && (
                  i.tipExempt ||
                  (!entertainmentTipsEnabled && i.categoryType === 'entertainment')
                ))
                .reduce((sum: number, i: any) => sum + (Number(i.itemTotal) || (Number(i.price) * (i.quantity || 1))), 0) || undefined
            }
            tabCards={paymentTabCards}
            onTabCardsChanged={onTabCardsChanged}
            dualPricing={dualPricing}
            paymentSettings={paymentSettings}
            priceRounding={priceRounding}
            onPaymentComplete={onPaymentComplete}
            employeeId={employee?.id}
            terminalId={terminalId}
            locationId={employee?.location?.id}
            waitForOrderReady={async () => {
              if (orderReadyPromiseRef.current) {
                await orderReadyPromiseRef.current
                orderReadyPromiseRef.current = null
              }
            }}
          />
        </Suspense>
      )}

      {/* Receipt Modal */}
      <Suspense fallback={null}>
        <ReceiptModal
          isOpen={showReceiptModal}
          onClose={() => {
            if (receiptOrderId) {
              setPaidOrderId(receiptOrderId)
            }
            setShowReceiptModal(false)
            setReceiptOrderId(null)
            setPreloadedReceiptData(null)
          }}
          orderId={receiptOrderId}
          locationId={employee.location?.id || ''}
          receiptSettings={receiptSettings}
          preloadedData={preloadedReceiptData}
        />
      </Suspense>

      {/* Tip Adjustment Overlay */}
      <Suspense fallback={null}>
        <TipAdjustmentOverlay
          isOpen={showTipAdjustment}
          onClose={() => setShowTipAdjustment(false)}
          locationId={employee?.location?.id}
          employeeId={employee?.id}
        />
      </Suspense>

      {/* Card-First Tab Flow Modal */}
      {showCardTabFlow && employee && (
        <Suspense fallback={null}>
          <Modal isOpen={showCardTabFlow && !!employee} onClose={() => setShowCardTabFlow(false)} size="md">
            <div className="rounded-2xl shadow-2xl w-full overflow-hidden -m-5" style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <CardFirstTabFlow
                orderId={cardTabOrderId}
                readerId="reader-1"
                employeeId={employee.id}
                onComplete={onCardTabComplete}
                onCancel={onCardTabCancel}
              />
            </div>
          </Modal>
        </Suspense>
      )}

      {/* Discount Modal */}
      {showDiscountModal && currentOrder && savedOrderId && employee && (() => {
        const targetItem = itemDiscountTargetId
          ? currentOrder.items?.find((i: any) => i.id === itemDiscountTargetId)
          : null
        const subtotal = targetItem
          ? (Number(targetItem.itemTotal) || Number(targetItem.price) * (targetItem.quantity || 1))
          : (currentOrder.subtotal || 0)
        return (
          <Suspense fallback={null}>
            <DiscountModal
              isOpen={showDiscountModal}
              onClose={() => setShowDiscountModal(false)}
              orderId={savedOrderId}
              orderSubtotal={subtotal}
              locationId={employee.location?.id || ''}
              employeeId={employee.id}
              appliedDiscounts={targetItem ? [] : appliedDiscounts}
              onDiscountApplied={onDiscountApplied}
              itemId={itemDiscountTargetId ?? undefined}
              itemName={targetItem?.name}
            />
          </Suspense>
        )
      })()}

      {/* Comp/Void Modal */}
      {showCompVoidModal && (savedOrderId || orderToPayId) && compVoidItem && employee && (
        <Suspense fallback={null}>
          <CompVoidModal
            isOpen={showCompVoidModal}
            onClose={() => {
              setShowCompVoidModal(false)
              setCompVoidItem(null)
            }}
            orderId={(savedOrderId || orderToPayId)!}
            item={compVoidItem as OrderItem}
            employeeId={employee.id}
            locationId={employee.location?.id || ''}
            onComplete={onCompVoidComplete}
          />
        </Suspense>
      )}

      {/* Resend to Kitchen Modal */}
      {resendModal && (
        <Modal isOpen={!!resendModal} onClose={() => { setResendModal(null); setResendNote('') }} title="Resend to Kitchen" size="md">
          <p className="text-gray-600 mb-4">
            Resend &quot;{resendModal.itemName}&quot; to kitchen?
          </p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for resend <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={resendNote}
              onChange={(e) => setResendNote(e.target.value)}
              placeholder="e.g., Wrong temp, customer requested remake"
              className={`w-full p-3 border rounded-lg text-lg ${!resendNote.trim() ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-gray-300 focus:border-blue-500'}`}
              autoFocus
            />
            {!resendNote.trim() && (
              <p className="mt-1 text-xs text-red-500">A reason is required before resending</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setResendModal(null)
                setResendNote('')
              }}
              disabled={resendLoading}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={onConfirmResend}
              disabled={resendLoading || !resendNote.trim()}
            >
              {resendLoading ? 'Sending...' : 'Resend'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Item Transfer Modal */}
      {showItemTransferModal && savedOrderId && employee && (
        <Suspense fallback={null}>
          <ItemTransferModal
            isOpen={showItemTransferModal}
            onClose={() => setShowItemTransferModal(false)}
            currentOrderId={savedOrderId}
            items={currentOrder?.items.map((item: any) => ({
              id: item.id,
              tempId: item.id,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              modifiers: item.modifiers.map((mod: any) => ({
                name: mod.name,
                price: mod.price,
              })),
              sent: item.sentToKitchen,
            })) || []}
            locationId={employee.location?.id || ''}
            employeeId={employee.id}
            onTransferComplete={onTransferComplete}
          />
        </Suspense>
      )}

      {/* Tab/Order Transfer Modal */}
      {showTabTransferModal && savedOrderId && employee && (
        <Suspense fallback={null}>
          <TabTransferModal
            isOpen={showTabTransferModal}
            onClose={() => setShowTabTransferModal(false)}
            tabId={savedOrderId}
            tabName={currentOrder?.tabName || currentOrder?.tableName || `Order #${currentOrder?.orderNumber}`}
            currentEmployeeId={employee.id}
            currentEmployeeName={employee.displayName || `${employee.firstName} ${employee.lastName}`}
            locationId={employee.location?.id || ''}
            onTransferComplete={() => {
              setShowTabTransferModal(false)
              setTabsRefreshTrigger((prev: number) => prev + 1)
            }}
          />
        </Suspense>
      )}

      {/* Split Check Screen */}
      {showSplitTicketManager && (currentOrder || splitManageMode) && (
        <Suspense fallback={null}>
          <SplitCheckScreen
            mode={splitManageMode ? 'manage' : 'edit'}
            orderId={splitManageMode ? (splitParentId || savedOrderId || '') : (savedOrderId || '')}
            parentOrderId={splitManageMode ? (splitParentId || savedOrderId || '') : undefined}
            items={splitManageMode ? [] : splitCheckItems}
            onClose={() => {
              setShowSplitTicketManager(false)
              setSplitManageMode(false)
              setFloorPlanRefreshTrigger(prev => prev + 1)
            }}
            onSplitApplied={onSplitApplied}
            onPaySplit={onPaySplit}
            onPayAllSplits={onPayAllSplits}
            onAddCard={onAddCard}
            onAddItems={onAddItems}
          />
        </Suspense>
      )}

      {/* Kitchen Note Editor */}
      <NoteEditModal
        isOpen={!!noteEditTarget}
        onClose={closeNoteEditor}
        onSave={async (note) => {
          if (noteEditTarget?.itemId) {
            await saveNote(noteEditTarget.itemId, note)
          }
          closeNoteEditor()
        }}
        currentNote={noteEditTarget?.currentNote}
        itemName={noteEditTarget?.itemName}
      />

      {/* Pay All Splits Confirmation */}
      {showPayAllSplitsConfirm && payAllSplitsParentId && employee?.location?.id && (
        <Suspense fallback={null}>
          <PayAllSplitsModal
            isOpen={showPayAllSplitsConfirm && !!payAllSplitsParentId}
            parentOrderId={payAllSplitsParentId}
            total={payAllSplitsTotal}
            cardTotal={payAllSplitsCardTotal !== payAllSplitsTotal ? payAllSplitsCardTotal : undefined}
            unpaidCount={orderSplitChips.filter((c: { isPaid: boolean }) => !c.isPaid).length}
            terminalId={terminalId}
            employeeId={employee.id}
            locationId={employee?.location?.id}
            onPayCash={onPayAllCash}
            onPayCard={onPayAllCard}
            onClose={() => { setShowPayAllSplitsConfirm(false); setPayAllSplitsParentId(null); setPayAllSplitsStep('confirm') }}
            processing={payAllSplitsProcessing}
          />
        </Suspense>
      )}

      {/* Tab Name Prompt */}
      {showTabNamePrompt && (
        <Suspense fallback={null}>
          <TabNamePromptModal
            isOpen={showTabNamePrompt}
            onClose={() => { setShowTabNamePrompt(false); setTabNameCallback(null) }}
            onSubmit={(name) => {
              if (name) {
                useOrderStore.getState().updateOrderType('bar_tab', { tabName: name })
              }
              setShowTabNamePrompt(false)
              tabNameCallback?.()
              setTabNameCallback(null)
            }}
            cardInfo={tabCardInfo}
          />
        </Suspense>
      )}

      {/* Time Clock Modal */}
      <TimeClockModal
        isOpen={showTimeClockModal}
        onClose={() => setShowTimeClockModal(false)}
        employeeId={employee?.id || ''}
        employeeName={employee?.displayName || `${employee?.firstName} ${employee?.lastName}` || ''}
        locationId={employee?.location?.id || ''}
        onClockOut={() => {
          if (currentShift) {
            setShowShiftCloseoutModal(true)
          }
        }}
      />

      {/* Shift Start Modal */}
      <ShiftStartModal
        isOpen={showShiftStartModal}
        onClose={() => setShowShiftStartModal(false)}
        employeeId={employee?.id || ''}
        employeeName={employee?.displayName || `${employee?.firstName} ${employee?.lastName}` || ''}
        locationId={employee?.location?.id || ''}
        cashHandlingMode={useAuthStore.getState().workingRole?.cashHandlingMode || employee?.availableRoles?.find(r => r.isPrimary)?.cashHandlingMode || 'drawer'}
        workingRoleId={useAuthStore.getState().workingRole?.id || null}
        onShiftStarted={(shiftId) => {
          fetch(`/api/shifts/${shiftId}`)
            .then(res => res.json())
            .then(data => {
              setCurrentShift({
                id: data.shift.id,
                startedAt: data.shift.startedAt,
                startingCash: data.shift.startingCash,
                employee: {
                  ...data.shift.employee,
                  roleId: employee?.role?.id,
                },
                locationId: employee?.location?.id,
              })
            })
            .catch(err => console.error('Failed to fetch shift:', err))
        }}
      />

      {/* Shift Closeout Modal */}
      {currentShift && (
        <Suspense fallback={null}>
          <ShiftCloseoutModal
            isOpen={showShiftCloseoutModal}
            onClose={() => setShowShiftCloseoutModal(false)}
            shift={currentShift}
            onCloseoutComplete={() => {
              setCurrentShift(null)
            }}
            permissions={permissionsArray}
            cashHandlingMode={useAuthStore.getState().workingRole?.cashHandlingMode || employee?.availableRoles?.find(r => r.isPrimary)?.cashHandlingMode || 'drawer'}
          />
        </Suspense>
      )}
    </>
  )
}

'use client'

import { lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { POSDisplaySettingsModal } from '@/components/orders/POSDisplaySettings'
import { NoteEditModal } from '@/components/orders/NoteEditModal'
import { OpenOrdersPanel, type OpenOrder } from '@/components/orders/OpenOrdersPanel'
import { TimeClockModal } from '@/components/time-clock/TimeClockModal'
import { ShiftStartModal } from '@/components/shifts/ShiftStartModal'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import type { OrderItem, MenuItem, PizzaOrderConfig, SelectedModifier } from '@/types'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'
import type { DatacapResult } from '@/hooks/useDatacap'

const PaymentModal = lazy(() => import('@/components/payment/PaymentModal').then(m => ({ default: m.PaymentModal })))
const DiscountModal = lazy(() => import('@/components/orders/DiscountModal').then(m => ({ default: m.DiscountModal })))
const CompVoidModal = lazy(() => import('@/components/orders/CompVoidModal').then(m => ({ default: m.CompVoidModal })))
const ItemTransferModal = lazy(() => import('@/components/orders/ItemTransferModal').then(m => ({ default: m.ItemTransferModal })))
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

export interface OrderPageModalsProps {
  // Employee
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

  // Display settings
  showDisplaySettings: boolean
  onCloseDisplaySettings: () => void
  displaySettings: any
  onUpdateSetting: any
  onBatchUpdateSettings: (settings: Record<string, any>) => void

  // Tabs panel / Open Orders
  showTabsPanel: boolean
  setShowTabsPanel: (v: boolean) => void
  isTabManagerExpanded: boolean
  setIsTabManagerExpanded: (v: boolean) => void
  tabsRefreshTrigger: number
  setTabsRefreshTrigger: React.Dispatch<React.SetStateAction<number>>
  savedOrderId: string | null
  onSelectOpenOrder: (order: OpenOrder) => void
  onViewOpenOrder: (order: OpenOrder) => void
  onNewTab: () => void
  onClosedOrderAction: () => void
  onOpenTipAdjustment: () => void
  onViewReceipt: (orderId: string) => void

  // Modifier modal
  showModifierModal: boolean
  setShowModifierModal: (v: boolean) => void
  selectedItem: MenuItem | null
  setSelectedItem: (v: MenuItem | null) => void
  itemModifierGroups: any[]
  setItemModifierGroups: (v: any[]) => void
  loadingModifiers: boolean
  editingOrderItem: any | null
  setEditingOrderItem: (v: any | null) => void
  dualPricing: any
  inlineModifierCallbackRef: React.MutableRefObject<((...args: any[]) => void) | null>
  onAddItemWithModifiers: (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: any[]) => void
  onUpdateItemWithModifiers: (modifiers: SelectedModifier[], specialNotes?: string, pourSize?: string, pourMultiplier?: number, ingredientModifications?: any[]) => void

  // Pizza builder
  showPizzaModal: boolean
  setShowPizzaModal: (v: boolean) => void
  selectedPizzaItem: MenuItem | null
  setSelectedPizzaItem: (v: MenuItem | null) => void
  editingPizzaItem: { id: string; pizzaConfig?: PizzaOrderConfig } | null
  setEditingPizzaItem: (v: { id: string; pizzaConfig?: PizzaOrderConfig } | null) => void
  inlinePizzaCallbackRef: React.MutableRefObject<((config: PizzaOrderConfig) => void) | null>
  onAddPizzaToOrder: (config: PizzaOrderConfig) => void

  // Entertainment
  showEntertainmentStart: boolean
  setShowEntertainmentStart: (v: boolean) => void
  entertainmentItem: {
    id: string
    name: string
    ratePerMinute?: number
    prepaidPackages?: PrepaidPackage[]
    happyHourEnabled?: boolean
    happyHourPrice?: number | null
  } | null
  setEntertainmentItem: (v: any | null) => void
  onStartEntertainmentWithCurrentOrder: (pkg?: PrepaidPackage) => Promise<void>
  onStartEntertainmentWithNewTab: (tabName: string, pkg?: PrepaidPackage) => Promise<void>
  onStartEntertainmentWithExistingTab: (orderId: string, pkg?: PrepaidPackage) => Promise<void>

  // Timed rental
  showTimedRentalModal: boolean
  setShowTimedRentalModal: (v: boolean) => void
  selectedTimedItem: MenuItem | null
  setSelectedTimedItem: (v: MenuItem | null) => void
  inlineTimedRentalCallbackRef: React.MutableRefObject<((price: number, blockMinutes: number) => void) | null>
  onStartTimedSession: (rateType?: 'per15Min' | 'per30Min' | 'perHour') => Promise<void>
  loadingSession: boolean

  // Payment modal
  showPaymentModal: boolean
  setShowPaymentModal: (v: boolean) => void
  orderToPayId: string | null
  setOrderToPayId: (v: string | null) => void
  initialPayMethod: 'cash' | 'credit' | undefined
  setInitialPayMethod: (v: 'cash' | 'credit' | undefined) => void
  paymentTabCards: any[]
  onTabCardsChanged: () => void
  paymentSettings: any
  priceRounding: any
  currentOrder: any | null
  onPaymentComplete: (receiptData?: any) => void
  orderReadyPromiseRef: React.MutableRefObject<Promise<string | null> | null>
  terminalId: string

  // Receipt modal
  showReceiptModal: boolean
  setShowReceiptModal: (v: boolean) => void
  receiptOrderId: string | null
  setReceiptOrderId: (v: string | null) => void
  preloadedReceiptData: any
  setPreloadedReceiptData: (v: any) => void
  receiptSettings: any
  setPaidOrderId: (v: string | null) => void

  // Tip adjustment
  showTipAdjustment: boolean
  setShowTipAdjustment: (v: boolean) => void

  // Card-first tab flow
  showCardTabFlow: boolean
  setShowCardTabFlow: (v: boolean) => void
  cardTabOrderId: string | null
  onCardTabComplete: (result: any) => Promise<void>
  onCardTabCancel: () => void

  // Discount modal
  showDiscountModal: boolean
  setShowDiscountModal: (v: boolean) => void
  appliedDiscounts: any[]
  onDiscountApplied: (newTotals: { discountTotal: number; taxTotal: number; total: number }) => void

  // Comp/Void modal
  showCompVoidModal: boolean
  setShowCompVoidModal: (v: boolean) => void
  compVoidItem: any | null
  setCompVoidItem: (v: any | null) => void
  onCompVoidComplete: (result: any) => Promise<void>

  // Resend modal
  resendModal: { itemId: string; itemName: string } | null
  setResendModal: (v: { itemId: string; itemName: string } | null) => void
  resendNote: string
  setResendNote: (v: string) => void
  resendLoading: boolean
  onConfirmResend: () => Promise<void>

  // Item Transfer modal
  showItemTransferModal: boolean
  setShowItemTransferModal: (v: boolean) => void
  onTransferComplete: (transferredItemIds: string[]) => Promise<void>

  // Split Check Screen
  showSplitTicketManager: boolean
  setShowSplitTicketManager: (v: boolean) => void
  splitManageMode: boolean
  setSplitManageMode: (v: boolean) => void
  splitParentId: string | null
  splitCheckItems: { id: string; seatNumber?: number | null; name: string; price: number; quantity: number; categoryType?: string | null; sentToKitchen?: boolean; isPaid: boolean }[]
  setFloorPlanRefreshTrigger: React.Dispatch<React.SetStateAction<number>>
  splitParentToReturnTo: string | null
  setSplitParentToReturnTo: (v: string | null) => void
  payAllSplitsQueue: string[]
  setPayAllSplitsQueue: React.Dispatch<React.SetStateAction<string[]>>
  editingChildSplit: boolean
  setEditingChildSplit: (v: boolean) => void
  setSavedOrderId: (v: string | null) => void
  clearOrder: () => void
  setOrderSent: (v: boolean) => void
  onSplitApplied: () => void
  onPaySplit: (splitId: string) => void
  onPayAllSplits: (splitIds: string[], combinedTotal: number) => void
  onAddCard: (splitId: string) => void
  onAddItems: (splitId: string) => Promise<void>

  // Note edit modal (useActiveOrder)
  noteEditTarget: { itemId: string; currentNote?: string; itemName?: string } | null
  closeNoteEditor: () => void
  saveNote: (itemId: string, note: string) => Promise<void>

  // Pay All Splits Confirmation
  showPayAllSplitsConfirm: boolean
  setShowPayAllSplitsConfirm: (v: boolean) => void
  payAllSplitsParentId: string | null
  setPayAllSplitsParentId: (v: string | null) => void
  payAllSplitsTotal: number
  payAllSplitsCardTotal: number
  setPayAllSplitsStep: (v: 'confirm' | 'datacap_card') => void
  payAllSplitsProcessing: boolean
  orderSplitChips: { id: string; label: string; isPaid: boolean; total: number }[]
  onPayAllCash: () => void
  onPayAllCard: (cardResult: any) => void

  // Tab name prompt
  showTabNamePrompt: boolean
  setShowTabNamePrompt: (v: boolean) => void
  tabNameCallback: (() => void) | null
  setTabNameCallback: (v: (() => void) | null) => void
  tabCardInfo: { cardholderName?: string; cardLast4?: string; cardType?: string } | null

  // Time Clock
  showTimeClockModal: boolean
  setShowTimeClockModal: (v: boolean) => void
  currentShift: any | null
  setCurrentShift: (v: any | null) => void
  setShowShiftCloseoutModal: (v: boolean) => void

  // Shift Start
  showShiftStartModal: boolean
  setShowShiftStartModal: (v: boolean) => void

  // Shift Closeout
  showShiftCloseoutModal: boolean

  // Pricing info (for dual pricing in split modals)
  pricing: {
    isDualPricingEnabled: boolean
    cashDiscountRate: number
  }
}

export function OrderPageModals(props: OrderPageModalsProps) {
  const {
    employee,
    permissionsArray,
    showDisplaySettings,
    onCloseDisplaySettings,
    displaySettings,
    onUpdateSetting,
    onBatchUpdateSettings,
    showTabsPanel,
    setShowTabsPanel,
    isTabManagerExpanded,
    setIsTabManagerExpanded,
    tabsRefreshTrigger,
    savedOrderId,
    onSelectOpenOrder,
    onViewOpenOrder,
    onNewTab,
    onClosedOrderAction,
    onOpenTipAdjustment,
    onViewReceipt,
    showModifierModal,
    setShowModifierModal,
    selectedItem,
    setSelectedItem,
    itemModifierGroups,
    setItemModifierGroups,
    loadingModifiers,
    editingOrderItem,
    setEditingOrderItem,
    dualPricing,
    inlineModifierCallbackRef,
    onAddItemWithModifiers,
    onUpdateItemWithModifiers,
    showPizzaModal,
    setShowPizzaModal,
    selectedPizzaItem,
    setSelectedPizzaItem,
    editingPizzaItem,
    setEditingPizzaItem,
    inlinePizzaCallbackRef,
    onAddPizzaToOrder,
    showEntertainmentStart,
    setShowEntertainmentStart,
    entertainmentItem,
    setEntertainmentItem,
    onStartEntertainmentWithCurrentOrder,
    onStartEntertainmentWithNewTab,
    onStartEntertainmentWithExistingTab,
    showTimedRentalModal,
    setShowTimedRentalModal,
    selectedTimedItem,
    setSelectedTimedItem,
    inlineTimedRentalCallbackRef,
    onStartTimedSession,
    loadingSession,
    showPaymentModal,
    setShowPaymentModal,
    orderToPayId,
    setOrderToPayId,
    initialPayMethod,
    setInitialPayMethod,
    paymentTabCards,
    onTabCardsChanged,
    paymentSettings,
    priceRounding,
    currentOrder,
    onPaymentComplete,
    orderReadyPromiseRef,
    terminalId,
    showReceiptModal,
    setShowReceiptModal,
    receiptOrderId,
    setReceiptOrderId,
    preloadedReceiptData,
    setPreloadedReceiptData,
    receiptSettings,
    setPaidOrderId,
    showTipAdjustment,
    setShowTipAdjustment,
    showCardTabFlow,
    setShowCardTabFlow,
    cardTabOrderId,
    onCardTabComplete,
    onCardTabCancel,
    showDiscountModal,
    setShowDiscountModal,
    appliedDiscounts,
    onDiscountApplied,
    showCompVoidModal,
    setShowCompVoidModal,
    compVoidItem,
    setCompVoidItem,
    onCompVoidComplete,
    resendModal,
    setResendModal,
    resendNote,
    setResendNote,
    resendLoading,
    onConfirmResend,
    showItemTransferModal,
    setShowItemTransferModal,
    onTransferComplete,
    showSplitTicketManager,
    setShowSplitTicketManager,
    splitManageMode,
    setSplitManageMode,
    splitParentId,
    splitCheckItems,
    setFloorPlanRefreshTrigger,
    splitParentToReturnTo,
    setSplitParentToReturnTo,
    payAllSplitsQueue,
    setPayAllSplitsQueue,
    editingChildSplit,
    setEditingChildSplit,
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
    showPayAllSplitsConfirm,
    setShowPayAllSplitsConfirm,
    payAllSplitsParentId,
    setPayAllSplitsParentId,
    payAllSplitsTotal,
    payAllSplitsCardTotal,
    setPayAllSplitsStep,
    payAllSplitsProcessing,
    orderSplitChips,
    onPayAllCash,
    onPayAllCard,
    showTabNamePrompt,
    setShowTabNamePrompt,
    tabNameCallback,
    setTabNameCallback,
    tabCardInfo,
    showTimeClockModal,
    setShowTimeClockModal,
    currentShift,
    setCurrentShift,
    setShowShiftCloseoutModal,
    showShiftStartModal,
    setShowShiftStartModal,
    showShiftCloseoutModal,
  } = props

  return (
    <>
      {/* Display Settings Modal */}
      <POSDisplaySettingsModal
        isOpen={showDisplaySettings}
        onClose={onCloseDisplaySettings}
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
            onOpenTipAdjustment={onOpenTipAdjustment}
            onViewReceipt={onViewReceipt}
          />
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
            onConfirm={editingOrderItem && !inlineModifierCallbackRef.current ? onUpdateItemWithModifiers : onAddItemWithModifiers}
            onCancel={() => {
              setShowModifierModal(false)
              setSelectedItem(null)
              setItemModifierGroups([])
              setEditingOrderItem(null)
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
            editingItem={editingPizzaItem}
            onConfirm={onAddPizzaToOrder}
            onCancel={() => {
              setShowPizzaModal(false)
              setSelectedPizzaItem(null)
              setEditingPizzaItem(null)
              inlinePizzaCallbackRef.current = null
            }}
          />
        </Suspense>
      )}

      {/* Entertainment Session Start Modal */}
      {showEntertainmentStart && entertainmentItem && (
        <Suspense fallback={null}>
          <Modal isOpen={showEntertainmentStart && !!entertainmentItem} onClose={() => { setShowEntertainmentStart(false); setEntertainmentItem(null) }} size="md">
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
      {showCardTabFlow && cardTabOrderId && employee && (
        <Suspense fallback={null}>
          <Modal isOpen={showCardTabFlow && !!cardTabOrderId && !!employee} onClose={() => setShowCardTabFlow(false)} size="md">
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
      {showDiscountModal && currentOrder && savedOrderId && employee && (
        <Suspense fallback={null}>
          <DiscountModal
            isOpen={showDiscountModal}
            onClose={() => setShowDiscountModal(false)}
            orderId={savedOrderId}
            orderSubtotal={currentOrder.subtotal || 0}
            locationId={employee.location?.id || ''}
            employeeId={employee.id}
            appliedDiscounts={appliedDiscounts}
            onDiscountApplied={onDiscountApplied}
          />
        </Suspense>
      )}

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
              Note for kitchen (optional)
            </label>
            <input
              type="text"
              value={resendNote}
              onChange={(e) => setResendNote(e.target.value)}
              placeholder="e.g., Make it well done"
              className="w-full p-3 border rounded-lg text-lg"
              autoFocus
            />
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
              disabled={resendLoading}
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
            unpaidCount={orderSplitChips.filter(c => !c.isPaid).length}
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

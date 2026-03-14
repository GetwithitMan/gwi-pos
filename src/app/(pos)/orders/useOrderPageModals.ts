import { useState } from 'react'

/**
 * useOrderPageModals — consolidates all modal visibility state that lives
 * directly in OrdersPage (i.e. NOT already in a domain hook).
 *
 * Domain hooks (usePaymentFlow, useModifierModal, usePizzaBuilder, useCardTabFlow,
 * useItemOperations, useSplitTickets, useTabsPanel, useShiftManagement,
 * useComboBuilder, useTimedRentals) continue to own their own modal state.
 * This hook covers the remaining "orphan" modal state that was declared inline.
 */
export function useOrderPageModals() {
  // Display settings modal
  const [showDisplaySettings, setShowDisplaySettings] = useState(false)

  // Receipt modal state
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null)
  const [preloadedReceiptData, setPreloadedReceiptData] = useState<any>(null)

  // Tab name prompt state
  const [showTabNamePrompt, setShowTabNamePrompt] = useState(false)
  const [tabNameCallback, setTabNameCallback] = useState<(() => void) | null>(null)

  // Item Transfer modal state
  const [showItemTransferModal, setShowItemTransferModal] = useState(false)

  // Tab/Order Transfer modal state (transfers entire order to another employee)
  const [showTabTransferModal, setShowTabTransferModal] = useState(false)

  // Item notes modal state (for quick note editing)
  const [editingNotesItemId, setEditingNotesItemId] = useState<string | null>(null)
  const [editingNotesText, setEditingNotesText] = useState('')

  return {
    // Display settings
    showDisplaySettings, setShowDisplaySettings,

    // Receipt
    showReceiptModal, setShowReceiptModal,
    receiptOrderId, setReceiptOrderId,
    preloadedReceiptData, setPreloadedReceiptData,

    // Tab name prompt
    showTabNamePrompt, setShowTabNamePrompt,
    tabNameCallback, setTabNameCallback,

    // Item Transfer
    showItemTransferModal, setShowItemTransferModal,

    // Tab/Order Transfer
    showTabTransferModal, setShowTabTransferModal,

    // Item notes editing
    editingNotesItemId, setEditingNotesItemId,
    editingNotesText, setEditingNotesText,
  }
}

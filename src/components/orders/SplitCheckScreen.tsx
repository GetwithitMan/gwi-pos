'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useSplitCheck, type SplitMode } from '@/hooks/useSplitCheck'
import { SplitCheckCard } from './SplitCheckCard'
import { SEAT_COLORS } from '@/lib/seat-utils'
import { toast } from '@/stores/toast-store'
import { useOrderStore } from '@/stores/order-store'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

export interface SplitCheckScreenProps {
  orderId: string
  items: Array<{
    id: string
    seatNumber?: number | null
    name: string
    price: number
    quantity: number
    categoryType?: string | null
    sentToKitchen?: boolean
    isPaid?: boolean
  }>
  onClose: () => void
  onSplitApplied: (splitData?: { parentOrderId: string; splitOrders: Array<{ id: string; splitIndex: number; displayNumber: string | null; status: string; total: number; itemCount: number }> }) => void
  // Manage mode props
  mode?: 'edit' | 'manage'
  parentOrderId?: string
  onPaySplit?: (splitOrderId: string) => void
  onPayAllSplits?: (splitOrderIds: string[], combinedTotal: number) => void
  onAddCard?: (splitOrderId: string) => void
  onAddItems?: (splitOrderId: string) => void
}

const MODE_TABS: { mode: SplitMode; label: string }[] = [
  { mode: 'by_seat', label: 'By Seat' },
  { mode: 'custom', label: 'Custom' },
  { mode: 'even', label: 'Even' },
  { mode: 'bp', label: 'B/P' },
]

// -----------------------------------------------------------
// Managed split data shape (from API)
// -----------------------------------------------------------
interface ManagedSplit {
  id: string
  splitIndex: number | null
  displayNumber: string | null
  status: string
  subtotal: number
  total: number
  isPaid: boolean
  card: { last4: string; brand: string } | null
  items: Array<{
    id: string
    name: string
    price: number
    quantity: number
    isSentToKitchen?: boolean
    isPaid?: boolean
    fractionLabel?: string
    modifiers?: Array<{ name: string; price: number; preModifier?: string | null }>
  }>
}

// -----------------------------------------------------------
// Main SplitCheckScreen — unified single screen
// -----------------------------------------------------------
export function SplitCheckScreen({
  orderId,
  items,
  onClose,
  onSplitApplied,
  mode: initialMode = 'edit',
  parentOrderId,
  onPaySplit,
  onPayAllSplits,
  onAddCard,
  onAddItems,
}: SplitCheckScreenProps) {
  const [currentMode, setCurrentMode] = useState(initialMode)

  useEffect(() => {
    setCurrentMode(initialMode)
  }, [initialMode])

  // Manage Mode — unified view with item move + actions
  if (currentMode === 'manage' && parentOrderId) {
    return (
      <SplitUnifiedView
        parentOrderId={parentOrderId}
        onClose={onClose}
        onPaySplit={onPaySplit}
        onPayAllSplits={onPayAllSplits}
        onAddCard={onAddCard}
        onAddItems={onAddItems}
        onMergeBack={() => {
          onClose()
          onSplitApplied()
        }}
      />
    )
  }

  // Edit Mode — initial split creation
  return (
    <SplitEditMode
      orderId={orderId}
      items={items}
      onClose={onClose}
      onSplitApplied={onSplitApplied}
    />
  )
}

// -----------------------------------------------------------
// Unified View — one screen for managing existing splits
// Shows check cards with items, allows moving items between
// checks, pay, add card, add items, merge back.
// -----------------------------------------------------------
function SplitUnifiedView({
  parentOrderId,
  onClose,
  onPaySplit,
  onPayAllSplits,
  onAddCard,
  onAddItems,
  onMergeBack,
}: {
  parentOrderId: string
  onClose: () => void
  onPaySplit?: (splitOrderId: string) => void
  onPayAllSplits?: (splitOrderIds: string[], combinedTotal: number) => void
  onAddCard?: (splitOrderId: string) => void
  onAddItems?: (splitOrderId: string) => void
  onMergeBack: () => void
}) {
  const [splits, setSplits] = useState<ManagedSplit[]>([])
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedFromSplitId, setSelectedFromSplitId] = useState<string | null>(null)
  const [movingItem, setMovingItem] = useState(false)
  const [showSplitPicker, setShowSplitPicker] = useState(false)
  const [splittingItem, setSplittingItem] = useState(false)
  const isSplitActionInFlightRef = useRef(false)

  // Fetch split data
  const loadSplits = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${parentOrderId}/split-tickets`)
      if (!res.ok) throw new Error('Failed to load splits')
      const data = await res.json()
      setSplits((data.splitOrders || []).map((s: any) => ({
        id: s.id,
        splitIndex: s.splitIndex,
        displayNumber: s.displayNumber,
        status: s.status,
        subtotal: s.subtotal || s.total,
        total: s.total,
        isPaid: s.isPaid || s.status === 'paid',
        card: s.card || null,
        items: (s.items || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          isSentToKitchen: item.isSent,
          isPaid: item.status === 'paid',
          fractionLabel: item.fractionLabel,
          modifiers: item.modifiers,
        })),
      })))
    } catch (err) {
      toast.error('Failed to load split tickets')
    } finally {
      setLoading(false)
    }
  }, [parentOrderId])

  useEffect(() => {
    loadSplits()
  }, [loadSplits])

  // Socket listener: auto-refresh when another terminal modifies a displayed split
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const splitsRef = useRef(splits)
  splitsRef.current = splits

  useEffect(() => {
    const socket = getSharedSocket()

    const debouncedRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        loadSplits()
      }, 200)
    }

    const onOrdersChanged = (data: any) => {
      const { orderId } = data || {}
      // Refresh if the event is for the parent or any displayed split
      if (orderId === parentOrderId || splitsRef.current.some(s => s.id === orderId)) {
        debouncedRefresh()
      }
    }

    const onPaymentProcessed = (data: any) => {
      const { orderId } = data || {}
      if (orderId === parentOrderId || splitsRef.current.some(s => s.id === orderId)) {
        debouncedRefresh()
      }
    }

    socket.on('orders:list-changed', onOrdersChanged)
    socket.on('payment:processed', onPaymentProcessed)

    return () => {
      socket.off('orders:list-changed', onOrdersChanged)
      socket.off('payment:processed', onPaymentProcessed)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      releaseSharedSocket()
    }
  }, [parentOrderId, loadSplits])

  // Move item between splits — optimistic update
  const handleMoveItem = useCallback(async (toSplitId: string) => {
    if (!selectedItemId || !selectedFromSplitId || movingItem) return
    if (selectedFromSplitId === toSplitId) return
    if (isSplitActionInFlightRef.current) return
    isSplitActionInFlightRef.current = true

    // Optimistic: move item in local state immediately
    const snapshot = splits.map(s => ({ ...s, items: [...s.items] }))
    const fromSplit = splits.find(s => s.id === selectedFromSplitId)
    const movedItem = fromSplit?.items.find(i => i.id === selectedItemId)
    if (movedItem) {
      setSplits(prev => prev.map(s => {
        if (s.id === selectedFromSplitId) {
          const remaining = s.items.filter(i => i.id !== selectedItemId)
          const newTotal = remaining.reduce((sum, i) => sum + i.price * i.quantity, 0)
          return { ...s, items: remaining, total: newTotal, subtotal: newTotal }
        }
        if (s.id === toSplitId) {
          const updated = [...s.items, movedItem]
          const newTotal = updated.reduce((sum, i) => sum + i.price * i.quantity, 0)
          return { ...s, items: updated, total: newTotal, subtotal: newTotal }
        }
        return s
      }))
    }
    setSelectedItemId(null)
    setSelectedFromSplitId(null)
    setMovingItem(true)

    // Fire API in background
    try {
      const res = await fetch(`/api/orders/${parentOrderId}/split-tickets`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: selectedItemId,
          fromSplitId: selectedFromSplitId,
          toSplitId,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Move failed')
      }
      // Refresh with server truth
      await loadSplits()
    } catch (err) {
      // Rollback on error
      setSplits(snapshot)
      toast.error(err instanceof Error ? err.message : 'Failed to move item')
    } finally {
      setMovingItem(false)
      isSplitActionInFlightRef.current = false
    }
  }, [selectedItemId, selectedFromSplitId, movingItem, splits, parentOrderId, loadSplits])

  // Split a single item into N fractions across checks
  const handleSplitItem = useCallback(async (ways: number) => {
    if (!selectedItemId || !selectedFromSplitId || splittingItem) return
    if (isSplitActionInFlightRef.current) return
    isSplitActionInFlightRef.current = true
    setSplittingItem(true)
    setShowSplitPicker(false)

    // Clear selection immediately for instant feedback
    const capturedItemId = selectedItemId
    const capturedFromSplitId = selectedFromSplitId
    setSelectedItemId(null)
    setSelectedFromSplitId(null)
    toast.success(`Item split ${ways} ways`)

    try {
      const res = await fetch(`/api/orders/${parentOrderId}/split-tickets`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'splitItem',
          itemId: capturedItemId,
          fromSplitId: capturedFromSplitId,
          ways,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Split failed')
      }
      await loadSplits()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to split item')
      await loadSplits()
    } finally {
      setSplittingItem(false)
      isSplitActionInFlightRef.current = false
    }
  }, [selectedItemId, selectedFromSplitId, splittingItem, parentOrderId, loadSplits])

  // Merge all splits back to parent — optimistic close
  const handleMergeBack = useCallback(async () => {
    if (merging) return
    const hasPaidSplits = splits.some(s => s.isPaid)
    if (hasPaidSplits) {
      toast.error('Cannot merge back — some splits are already paid')
      return
    }
    setMerging(true)
    // Optimistic: close the view immediately
    toast.success('Splits merged back')
    onMergeBack()

    // Fire API in background
    fetch(`/api/orders/${parentOrderId}/split-tickets`, { method: 'DELETE' })
      .then(res => {
        if (!res.ok) return res.json().catch(() => ({})).then(d => { throw new Error(d.error || 'Merge failed') })
      })
      .catch(err => {
        toast.error(err instanceof Error ? err.message : 'Merge failed — please try again')
      })
  }, [merging, splits, parentOrderId, onMergeBack])

  const handleCreateCheck = useCallback(async () => {
    if (isSplitActionInFlightRef.current) return
    isSplitActionInFlightRef.current = true

    // Optimistic: add temp check to local state immediately
    const tempId = `temp-${Date.now()}`
    const tempCheck: ManagedSplit = {
      id: tempId,
      splitIndex: splits.length + 1,
      displayNumber: `Check ${splits.length + 1}`,
      status: 'open',
      subtotal: 0,
      total: 0,
      isPaid: false,
      card: null,
      items: [],
    }
    const snapshot = splits.map(s => ({ ...s, items: [...s.items] }))

    // If item selected, optimistically move it to the new check
    const capturedItemId = selectedItemId
    const capturedFromSplitId = selectedFromSplitId
    if (capturedItemId && capturedFromSplitId) {
      const fromSplit = splits.find(s => s.id === capturedFromSplitId)
      const movedItem = fromSplit?.items.find(i => i.id === capturedItemId)
      if (movedItem) {
        tempCheck.items = [movedItem]
        tempCheck.total = movedItem.price * movedItem.quantity
        tempCheck.subtotal = tempCheck.total
        setSplits(prev => [
          ...prev.map(s => {
            if (s.id === capturedFromSplitId) {
              const remaining = s.items.filter(i => i.id !== capturedItemId)
              const newTotal = remaining.reduce((sum, i) => sum + i.price * i.quantity, 0)
              return { ...s, items: remaining, total: newTotal, subtotal: newTotal }
            }
            return s
          }),
          tempCheck,
        ])
      } else {
        setSplits(prev => [...prev, tempCheck])
      }
      setSelectedItemId(null)
      setSelectedFromSplitId(null)
    } else {
      setSplits(prev => [...prev, tempCheck])
    }

    try {
      const res = await fetch(`/api/orders/${parentOrderId}/split-tickets/create-check`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create check')
      }
      const newCheck = await res.json()
      // If item was selected, move it on the server too
      if (capturedItemId && capturedFromSplitId) {
        await fetch(`/api/orders/${parentOrderId}/split-tickets`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: capturedItemId,
            fromSplitId: capturedFromSplitId,
            toSplitId: newCheck.id,
          }),
        })
      }
      // Refresh with server truth
      await loadSplits()
    } catch (err) {
      // Rollback on error
      setSplits(snapshot)
      toast.error(err instanceof Error ? err.message : 'Failed to create check')
    } finally {
      isSplitActionInFlightRef.current = false
    }
  }, [parentOrderId, selectedItemId, selectedFromSplitId, splits, loadSplits])

  const handleDeleteCheck = useCallback(async (splitId: string) => {
    if (isSplitActionInFlightRef.current) return
    isSplitActionInFlightRef.current = true

    // Optimistic: remove the check from local state immediately
    const snapshot = splits.map(s => ({ ...s, items: [...s.items] }))
    const deletedCheck = splits.find(s => s.id === splitId)
    const remainingAfterDelete = splits.filter(s => s.id !== splitId)

    // If this would leave only 1 split, it'll auto-merge on server
    if (remainingAfterDelete.length <= 1) {
      setSplits([])
      onMergeBack()
    } else {
      // Move deleted check's items to the first remaining check
      if (deletedCheck && deletedCheck.items.length > 0) {
        const targetId = remainingAfterDelete[0].id
        setSplits(remainingAfterDelete.map(s => {
          if (s.id === targetId) {
            const merged = [...s.items, ...deletedCheck.items]
            const newTotal = merged.reduce((sum, i) => sum + i.price * i.quantity, 0)
            return { ...s, items: merged, total: newTotal, subtotal: newTotal }
          }
          return s
        }))
      } else {
        setSplits(remainingAfterDelete)
      }
    }

    try {
      const res = await fetch(`/api/orders/${parentOrderId}/split-tickets/${splitId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete check')
      }
      const data = await res.json()
      if (data.merged) {
        onMergeBack()
      } else {
        await loadSplits()
      }
    } catch (err) {
      // Rollback on error
      setSplits(snapshot)
      toast.error(err instanceof Error ? err.message : 'Failed to delete check')
    } finally {
      isSplitActionInFlightRef.current = false
    }
  }, [parentOrderId, splits, loadSplits, onMergeBack])

  const handleItemTap = useCallback((itemId: string, splitId: string) => {
    if (selectedItemId === itemId) {
      // Deselect
      setSelectedItemId(null)
      setSelectedFromSplitId(null)
    } else {
      setSelectedItemId(itemId)
      setSelectedFromSplitId(splitId)
    }
  }, [selectedItemId])

  const handleCardTap = useCallback((checkId: string) => {
    if (selectedItemId && selectedFromSplitId && selectedFromSplitId !== checkId) {
      handleMoveItem(checkId)
    }
  }, [selectedItemId, selectedFromSplitId, handleMoveItem])

  const allPaid = splits.length > 0 && splits.every(s => s.isPaid)
  const paidCount = splits.filter(s => s.isPaid).length
  const totalAmount = splits.reduce((sum, s) => sum + s.total, 0)
  const unpaidTotal = splits.filter(s => !s.isPaid).reduce((sum, s) => sum + s.total, 0)

  // Pay All: send all unpaid split IDs + combined total to parent for batch payment
  const handlePayAll = useCallback(() => {
    const unpaidSplits = splits.filter(s => !s.isPaid)
    if (unpaidSplits.length === 0) return
    if (onPayAllSplits) {
      const total = unpaidSplits.reduce((sum, s) => sum + s.total, 0)
      onPayAllSplits(unpaidSplits.map(s => s.id), total)
    } else if (onPaySplit) {
      onPaySplit(unpaidSplits[0].id)
    }
  }, [splits, onPaySplit, onPayAllSplits])

  // Find the selected item details for the action bar
  const selectedItemInfo = useMemo(() => {
    if (!selectedItemId) return null
    for (const split of splits) {
      const item = split.items.find(i => i.id === selectedItemId)
      if (item) return { ...item, splitId: split.id, splitLabel: split.displayNumber }
    }
    return null
  }, [selectedItemId, splits])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>
              Split Checks
            </span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              {splits.length} checks
              {paidCount > 0 && ` (${paidCount} paid)`}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#a5b4fc' }}>
              Total: ${totalAmount.toFixed(2)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {selectedItemId && (
              <span style={{ fontSize: '12px', color: '#a5b4fc', fontStyle: 'italic' }}>
                Tap a check or + New Check to move item
              </span>
            )}
            {splits.length > 0 && (
              <button
                onClick={() => {
                  for (const split of splits) {
                    fetch('/api/print/receipt', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ orderId: split.id, type: 'check' }),
                    }).catch(() => {})
                  }
                  toast.success(`Printing ${splits.length} checks`)
                }}
                style={{
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm0-16h6a2 2 0 012 2v2H7V5a2 2 0 012-2z" />
                </svg>
                Print All
              </button>
            )}
            {splits.some(s => !s.isPaid) && onPaySplit && (
              <button
                onClick={handlePayAll}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: '#4ade80',
                }}
              >
                Pay All (${unpaidTotal.toFixed(2)})
              </button>
            )}
            {!allPaid && (
              <button
                onClick={handleMergeBack}
                disabled={merging || splits.some(s => s.isPaid)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  background: splits.some(s => s.isPaid) ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.15)',
                  color: splits.some(s => s.isPaid) ? '#64748b' : '#f87171',
                  cursor: splits.some(s => s.isPaid) ? 'default' : 'pointer',
                  opacity: merging ? 0.5 : 1,
                }}
              >
                {merging ? 'Merging...' : 'Merge Back'}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                fontSize: '20px',
                fontWeight: 400,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>
      </div>

      {/* Split Cards Grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontSize: '15px' }}>
            Loading splits...
          </div>
        ) : splits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontSize: '15px' }}>
            No splits found
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {splits.map((split, idx) => {
              const isSource = selectedFromSplitId === split.id
              const isDropTarget = !!selectedItemId && !isSource && !split.isPaid
              return (
                <SplitCheckCard
                  key={split.id}
                  check={{
                    id: split.id,
                    label: split.displayNumber || `Check ${(split.splitIndex ?? idx + 1)}`,
                    color: SEAT_COLORS[idx % SEAT_COLORS.length],
                    items: split.items.map(item => ({
                      id: item.id,
                      originalItemId: item.id,
                      name: item.name,
                      price: item.price,
                      quantity: item.quantity,
                      fraction: 1,
                      fractionLabel: item.fractionLabel,
                      isSentToKitchen: item.isSentToKitchen ?? false,
                      isPaid: item.isPaid ?? false,
                    })),
                    subtotal: split.total,
                  }}
                  isDropTarget={isDropTarget}
                  selectedItemId={isSource ? selectedItemId : null}
                  onItemTap={(itemId) => {
                    if (split.isPaid) return
                    handleItemTap(itemId, split.id)
                  }}
                  onCardTap={(checkId) => handleCardTap(checkId)}
                  canDelete={true}
                  onDeleteCheck={() => handleDeleteCheck(split.id)}
                  manageMode={true}
                  isPaid={split.isPaid}
                  cardInfo={split.card}
                  onPay={() => {
                    if (isSplitActionInFlightRef.current) return
                    isSplitActionInFlightRef.current = true
                    try { onPaySplit?.(split.id) } finally { isSplitActionInFlightRef.current = false }
                  }}
                  onAddCard={() => onAddCard?.(split.id)}
                  onAddItems={() => {
                    if (isSplitActionInFlightRef.current) return
                    isSplitActionInFlightRef.current = true
                    try { onAddItems?.(split.id) } finally { isSplitActionInFlightRef.current = false }
                  }}
                  onPrint={() => {
                    fetch('/api/print/receipt', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ orderId: split.id, type: 'check' }),
                    }).catch(() => {})
                    toast.success(`Printing ${split.displayNumber || `Check ${(split.splitIndex ?? idx + 1)}`}`)
                  }}
                />
              )
            })}
            {/* + New Check card */}
            <div
              onClick={handleCreateCheck}
              style={{
                minWidth: '200px',
                minHeight: '120px',
                border: '2px dashed rgba(255,255,255,0.2)',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                background: selectedItemId ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <span style={{ fontSize: '24px', color: '#64748b' }}>+ New Check</span>
            </div>
          </div>
        )}
      </div>

      {/* Floating action bar when item selected */}
      {selectedItemInfo && (
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(15, 15, 25, 0.98)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
              {selectedItemInfo.name}
            </span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              ${selectedItemInfo.price.toFixed(2)}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              from {selectedItemInfo.splitLabel}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#a5b4fc', alignSelf: 'center' }}>
              {movingItem ? 'Moving...' : splittingItem ? 'Splitting...' : 'Tap a check or + New Check to move'}
            </span>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowSplitPicker(prev => !prev)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#c084fc',
                  cursor: 'pointer',
                }}
              >
                Split Item
              </button>
              {showSplitPicker && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '44px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(30, 30, 46, 0.98)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    padding: '6px',
                    display: 'flex',
                    gap: '4px',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  {[2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => handleSplitItem(n)}
                      style={{
                        width: '44px',
                        height: '40px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 700,
                        border: 'none',
                        background: 'rgba(168, 85, 247, 0.15)',
                        color: '#c084fc',
                        cursor: 'pointer',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedItemId(null)
                setSelectedFromSplitId(null)
                setShowSplitPicker(false)
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
              }}
            >
              Deselect
            </button>
          </div>
        </div>
      )}

      {/* Bottom summary bar (when all paid) */}
      {allPaid && splits.length > 0 && (
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(34, 197, 94, 0.3)',
            background: 'rgba(34, 197, 94, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#4ade80' }}>
            All checks paid — ${totalAmount.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------
// Edit Mode — initial split creation (By Seat / Custom / Even / B/P)
// -----------------------------------------------------------
function SplitEditMode({
  orderId,
  items,
  onClose,
  onSplitApplied,
}: {
  orderId: string
  items: SplitCheckScreenProps['items']
  onClose: () => void
  onSplitApplied: SplitCheckScreenProps['onSplitApplied']
}) {
  const {
    checks,
    splitMode,
    selectedItemId,
    evenWays,
    setEvenWays,
    selectItem,
    moveItemToCheck,
    moveItemToNewCheck,
    splitItem,
    applyMode,
    reset,
    getAssignments,
    getSplitItemsPayload,
    originalTotal,
    splitTotal,
    hasIntegrityIssue,
    integrityIssues,
  } = useSplitCheck({ orderId, items })

  const [saving, setSaving] = useState(false)
  const [splitPickerItemId, setSplitPickerItemId] = useState<string | null>(null)

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null
    for (const check of checks) {
      const item = check.items.find(i => i.id === selectedItemId)
      if (item) return item
    }
    return null
  }, [selectedItemId, checks])

  const canSave = splitMode === 'even'
    ? evenWays >= 2
    : checks.length >= 2 && !hasIntegrityIssue

  const handleSave = useCallback(async () => {
    if (saving) return
    if (splitMode !== 'even' && (hasIntegrityIssue || checks.length < 2)) return
    setSaving(true)
    // Backup current order state for rollback on failure
    const backup = JSON.parse(JSON.stringify(useOrderStore.getState().currentOrder))
    try {
      if (splitMode === 'even') {
        const res = await fetch(`/api/orders/${orderId}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'even', numWays: evenWays }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Split failed')
        }
      } else {
        const assignments = getAssignments()
        const splitItems = getSplitItemsPayload()
        const res = await fetch(`/api/orders/${orderId}/split-tickets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignments,
            splitItems: splitItems.length > 0 ? splitItems : undefined,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Split failed')
        }
        const responseData = await res.json().catch(() => null)
        onSplitApplied(responseData ?? undefined)
        return
      }
      onSplitApplied()
    } catch (err) {
      // Restore order state on failure so UI stays consistent
      if (backup) {
        useOrderStore.getState().loadOrder(backup)
      }
      toast.error(err instanceof Error ? err.message : 'Split failed')
    } finally {
      setSaving(false)
    }
  }, [saving, splitMode, hasIntegrityIssue, checks.length, orderId, evenWays, getAssignments, getSplitItemsPayload, onSplitApplied])

  const handleCardTap = useCallback((checkId: string) => {
    if (selectedItemId) {
      const sourceCheck = checks.find(c => c.items.some(i => i.id === selectedItemId))
      if (sourceCheck && sourceCheck.id !== checkId) {
        moveItemToCheck(checkId)
      }
    }
  }, [selectedItemId, checks, moveItemToCheck])

  const handleNewCheckTap = useCallback(() => {
    if (selectedItemId) {
      moveItemToNewCheck()
    }
  }, [selectedItemId, moveItemToNewCheck])

  const handleSplitItemSelect = useCallback((ways: number) => {
    if (splitPickerItemId) {
      splitItem(splitPickerItemId, ways)
      setSplitPickerItemId(null)
      selectItem(null)
    }
  }, [splitPickerItemId, splitItem, selectItem])

  const totalMismatch = Math.abs(splitTotal - originalTotal) > 0.01

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          flexShrink: 0,
        }}
      >
        {/* Row 1: Mode tabs + Reset + Close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {MODE_TABS.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => applyMode(mode)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  background: splitMode === mode ? '#6366f1' : 'rgba(255, 255, 255, 0.08)',
                  color: splitMode === mode ? '#fff' : '#94a3b8',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={reset}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
            <button
              onClick={onClose}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                fontSize: '20px',
                fontWeight: 400,
                border: 'none',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Row 2: Totals + Save */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              Original: <span style={{ color: '#e2e8f0', fontWeight: 700 }}>${originalTotal.toFixed(2)}</span>
            </span>
            {splitMode !== 'even' && (
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                Split Total:{' '}
                <span style={{ color: totalMismatch ? '#ef4444' : '#e2e8f0', fontWeight: 700 }}>
                  ${splitTotal.toFixed(2)}
                </span>
              </span>
            )}
            {hasIntegrityIssue && (
              <span style={{ fontSize: '11px', color: '#ef4444', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {integrityIssues[0]}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              padding: '8px 24px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 700,
              border: 'none',
              cursor: canSave && !saving ? 'pointer' : 'default',
              background: canSave && !saving ? '#22c55e' : 'rgba(255, 255, 255, 0.1)',
              color: canSave && !saving ? '#fff' : '#64748b',
              transition: 'background 0.15s ease',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {splitMode === 'even' ? (
          /* Even Mode View */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', paddingTop: '20px' }}>
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0' }}>Split Evenly</span>

            {/* Number picker */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setEvenWays(n)}
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '12px',
                    fontSize: '18px',
                    fontWeight: 700,
                    border: evenWays === n ? '2px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.15)',
                    background: evenWays === n ? 'rgba(99, 102, 241, 0.2)' : 'rgba(30, 30, 46, 0.95)',
                    color: evenWays === n ? '#a5b4fc' : '#94a3b8',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* Preview cards */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '8px' }}>
              {Array.from({ length: evenWays }, (_, i) => {
                const perCheck = i === evenWays - 1
                  ? Math.round((originalTotal - Math.floor((originalTotal / evenWays) * 100) / 100 * (evenWays - 1)) * 100) / 100
                  : Math.floor((originalTotal / evenWays) * 100) / 100
                return (
                  <div
                    key={i}
                    style={{
                      background: 'rgba(30, 30, 46, 0.95)',
                      borderRadius: '16px',
                      border: `1px solid ${SEAT_COLORS[i % SEAT_COLORS.length]}40`,
                      padding: '16px 24px',
                      minWidth: '140px',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                      Check {i + 1}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#e2e8f0' }}>
                      ${perCheck.toFixed(2)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Cards Grid (By Seat / Custom / B/P) */
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {checks.map(check => (
              <SplitCheckCard
                key={check.id}
                check={check}
                isDropTarget={selectedItemId !== null && !check.items.some(i => i.id === selectedItemId)}
                selectedItemId={selectedItemId}
                onItemTap={selectItem}
                onCardTap={handleCardTap}
                canDelete={checks.length > 1}
                onDeleteCheck={() => {}}
              />
            ))}

            {/* + New Check card */}
            <div
              onClick={handleNewCheckTap}
              style={{
                minWidth: '200px',
                minHeight: '120px',
                borderRadius: '16px',
                border: selectedItemId
                  ? '2px dashed #6366f1'
                  : '2px dashed rgba(255, 255, 255, 0.15)',
                background: selectedItemId
                  ? 'rgba(99, 102, 241, 0.08)'
                  : 'rgba(30, 30, 46, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: selectedItemId ? 'pointer' : 'default',
                transition: 'border 0.2s ease, background 0.2s ease',
                flexShrink: 0,
              }}
            >
              <svg
                width="28"
                height="28"
                fill="none"
                stroke={selectedItemId ? '#6366f1' : '#64748b'}
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span style={{ fontSize: '13px', fontWeight: 600, color: selectedItemId ? '#a5b4fc' : '#64748b' }}>
                New Check
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Bar */}
      {selectedItem && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 20px',
            background: 'rgba(15, 15, 25, 0.98)',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'transform 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
              {selectedItem.name}
            </span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              ${selectedItem.price.toFixed(2)}
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setSplitPickerItemId(prev => prev === selectedItemId ? null : selectedItemId)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid rgba(168, 85, 247, 0.4)',
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#c084fc',
                cursor: 'pointer',
              }}
            >
              Split Item ▾
            </button>

            {splitPickerItemId === selectedItemId && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '44px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(30, 30, 46, 0.98)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '10px',
                  padding: '6px',
                  display: 'flex',
                  gap: '4px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                }}
              >
                {[2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => handleSplitItemSelect(n)}
                    style={{
                      width: '44px',
                      height: '40px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 700,
                      border: 'none',
                      background: 'rgba(168, 85, 247, 0.15)',
                      color: '#c084fc',
                      cursor: 'pointer',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              selectItem(null)
              setSplitPickerItemId(null)
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            Deselect
          </button>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useCallback, useMemo } from 'react'
import { useSplitCheck, type SplitMode } from '@/hooks/useSplitCheck'
import { SplitCheckCard } from './SplitCheckCard'
import { SEAT_COLORS } from '@/lib/seat-utils'
import { toast } from '@/stores/toast-store'

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
}

const MODE_TABS: { mode: SplitMode; label: string }[] = [
  { mode: 'by_seat', label: 'By Seat' },
  { mode: 'custom', label: 'Custom' },
  { mode: 'even', label: 'Even' },
  { mode: 'bp', label: 'B/P' },
]

export function SplitCheckScreen({ orderId, items, onClose, onSplitApplied }: SplitCheckScreenProps) {
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

  // Find the selected item for the floating bar
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
      toast.error(err instanceof Error ? err.message : 'Split failed')
    } finally {
      setSaving(false)
    }
  }, [saving, splitMode, hasIntegrityIssue, checks.length, orderId, evenWays, getAssignments, getSplitItemsPayload, onSplitApplied])

  const handleCardTap = useCallback((checkId: string) => {
    if (selectedItemId) {
      // Find which check the selected item is in
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
    // If no item selected, do nothing (can't create empty check without an item to move)
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
                onDeleteCheck={() => {
                  // Move all items from this check to the first other check, then remove
                  // The hook doesn't have a delete check method, so we move items individually
                  // For simplicity: if check is empty, we just ignore (SplitCheckCard only shows delete for empty checks)
                }}
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
            transform: 'translateY(0)',
            transition: 'transform 0.2s ease',
          }}
        >
          {/* Left: Item name + price */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
              {selectedItem.name}
            </span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              ${selectedItem.price.toFixed(2)}
            </span>
          </div>

          {/* Center: Split Item */}
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

            {/* Split picker dropdown */}
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

          {/* Right: Deselect */}
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

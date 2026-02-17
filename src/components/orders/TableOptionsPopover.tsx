'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'

interface CheckOverviewItem {
  name: string
  quantity: number
  price: number
  status?: string
}

interface TableOptionsPopoverProps {
  isOpen: boolean
  onClose: () => void
  tableName: string
  coursingEnabled: boolean
  onCoursingToggle: (enabled: boolean) => void
  guestCount: number
  onGuestCountChange: (count: number) => void
  /** Order items for check overview (non-split orders) */
  orderItems?: CheckOverviewItem[]
  orderTotal?: number
  /** Split order IDs — when provided, fetches items from all splits for full-table overview */
  splitOrderIds?: string[]
}

/**
 * Small dark popover that appears when user taps the table name in the header.
 * Provides quick access to coursing toggle, guest count, and check overview.
 */
export function TableOptionsPopover({
  isOpen,
  onClose,
  tableName,
  coursingEnabled,
  onCoursingToggle,
  guestCount,
  onGuestCountChange,
  orderItems,
  orderTotal,
  splitOrderIds,
}: TableOptionsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // State for fetched split items
  const [splitItems, setSplitItems] = useState<CheckOverviewItem[]>([])
  const [splitTotal, setSplitTotal] = useState(0)
  const [loadingSplits, setLoadingSplits] = useState(false)

  // Fetch all split order items when popover opens with split IDs
  useEffect(() => {
    if (!isOpen) return
    if (!splitOrderIds || splitOrderIds.length === 0) {
      setSplitItems([])
      setSplitTotal(0)
      return
    }
    setLoadingSplits(true)
    Promise.all(
      splitOrderIds.map(id =>
        fetch(`/api/orders/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    ).then(results => {
      const items: CheckOverviewItem[] = []
      let total = 0
      for (const result of results) {
        // API returns order directly (no data wrapper)
        const order = result?.data ?? result
        if (!order?.items) continue
        total += Number(order.total ?? 0)
        for (const item of order.items) {
          items.push({
            name: item.name,
            quantity: item.quantity ?? 1,
            price: Number(item.price ?? 0),
            status: item.status,
          })
        }
      }
      setSplitItems(items)
      setSplitTotal(total)
      setLoadingSplits(false)
    })
  }, [isOpen, splitOrderIds?.join(',')])

  // Use split items when available, otherwise use direct orderItems
  const effectiveItems = (splitOrderIds && splitOrderIds.length > 0) ? splitItems : (orderItems || [])
  const effectiveTotal = (splitOrderIds && splitOrderIds.length > 0) ? splitTotal : (orderTotal ?? 0)
  const hasSplits = !!(splitOrderIds && splitOrderIds.length > 0)
  const isLoading = hasSplits && loadingSplits

  // Aggregate items by name for check overview
  const overviewGroups = useMemo(() => {
    if (effectiveItems.length === 0) return []
    const groups = new Map<string, { name: string; qty: number; total: number }>()
    for (const item of effectiveItems) {
      if (item.status === 'voided' || item.status === 'comped') continue
      const existing = groups.get(item.name)
      if (existing) {
        existing.qty += item.quantity
        existing.total += item.price * item.quantity
      } else {
        groups.set(item.name, { name: item.name, qty: item.quantity, total: item.price * item.quantity })
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.qty - a.qty)
  }, [effectiveItems])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const showOverview = overviewGroups.length > 0 || isLoading

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: '6px',
        minWidth: '240px',
        background: 'rgba(15, 23, 42, 0.98)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '16px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        backdropFilter: 'blur(12px)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Title */}
      <div style={{
        fontSize: '12px',
        fontWeight: 700,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '14px',
      }}>
        {tableName} Options
      </div>

      {/* Check Overview */}
      {showOverview && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, color: '#64748b',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            marginBottom: '6px',
          }}>
            {hasSplits ? 'Table Overview (All Checks)' : 'Check Overview'}
          </div>
          {isLoading ? (
            <div style={{ fontSize: '11px', color: '#64748b', padding: '4px 0' }}>Loading all checks...</div>
          ) : (
            <>
              <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                {overviewGroups.map(g => (
                  <div key={g.name} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '2px 0', fontSize: '12px',
                  }}>
                    <span style={{ color: '#e2e8f0' }}>
                      <span style={{ color: '#94a3b8', fontWeight: 600, marginRight: '3px' }}>{g.qty}x</span>
                      {g.name}
                    </span>
                    <span style={{ color: '#94a3b8', fontWeight: 500, marginLeft: '8px', whiteSpace: 'nowrap' }}>
                      {formatCurrency(g.total)}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginTop: '6px', paddingTop: '4px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                fontSize: '12px', fontWeight: 700,
              }}>
                <span style={{ color: '#e2e8f0' }}>Total</span>
                <span style={{ color: '#f1f5f9' }}>{formatCurrency(effectiveTotal)}</span>
              </div>
            </>
          )}
          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '10px 0' }} />
        </div>
      )}

      {/* Coursing Toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px',
      }}>
        <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500 }}>
          Enable Coursing
        </span>
        <button
          onClick={() => onCoursingToggle(!coursingEnabled)}
          style={{
            width: '44px',
            height: '24px',
            borderRadius: '12px',
            border: 'none',
            background: coursingEnabled
              ? 'rgba(99, 102, 241, 0.8)'
              : 'rgba(255, 255, 255, 0.1)',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background 0.2s ease',
          }}
        >
          <div style={{
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: '3px',
            left: coursingEnabled ? '23px' : '3px',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          }} />
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '10px 0' }} />

      {/* Guest Count */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500 }}>
          Guests
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => onGuestCountChange(Math.max(1, guestCount - 1))}
            disabled={guestCount <= 1}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: guestCount <= 1 ? '#334155' : '#e2e8f0',
              cursor: guestCount <= 1 ? 'default' : 'pointer',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            -
          </button>
          <span style={{
            fontSize: '16px',
            fontWeight: 600,
            color: '#f1f5f9',
            minWidth: '24px',
            textAlign: 'center',
          }}>
            {guestCount}
          </span>
          <button
            onClick={() => onGuestCountChange(guestCount + 1)}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Done Button */}
      <button
        onClick={onClose}
        style={{
          width: '100%',
          marginTop: '14px',
          padding: '8px',
          borderRadius: '8px',
          border: 'none',
          background: 'rgba(99, 102, 241, 0.2)',
          color: '#a5b4fc',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.35)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)'}
      >
        Done
      </button>
    </div>
  )
}

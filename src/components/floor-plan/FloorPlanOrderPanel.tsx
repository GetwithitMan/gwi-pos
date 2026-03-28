'use client'

/**
 * FloorPlanOrderPanel — The left-side order panel with table header, seat strip, and order content.
 * Extracted from FloorPlanHome.tsx to reduce component complexity.
 *
 * Renders: "tap a table" prompt, order header with table name/number/share,
 * fire course button, seat selector, and children (OrderPanel passed from parent).
 */

import { memo } from 'react'
import { TableOptionsPopover } from '@/components/orders/TableOptionsPopover'
import { getSeatBgColor, getSeatTextColor, getSeatBorderColor } from '@/lib/seat-utils'
import type { FloorPlanTable } from './use-floor-plan'
import type { InlineOrderItem } from './types'

interface FloorPlanOrderPanelProps {
  // Table state
  activeTable: FloorPlanTable | null
  activeTableId: string | null
  activeOrderId: string | null
  activeOrderNumber: string | null
  activeOrderType: string | null
  tableRequiredButMissing: boolean
  // Seat state
  activeSeatNumber: number | null
  totalSeats: number
  // Split chips
  hasSplitChips: boolean
  splitChips: { id: string; label: string; isPaid: boolean; total: number }[]
  // Order data
  inlineOrderItems: InlineOrderItem[]
  orderTotal: number
  // Table options
  showTableOptions: boolean
  coursingEnabled: boolean
  guestCount: number
  // Active order coursing
  courseDelays: Record<number, { startedAt?: string; firedAt?: string }> | undefined
  // Callbacks
  onSetShowTableOptions: (show: boolean) => void
  onCoursingToggle: (enabled: boolean) => void
  onGuestCountChange: (count: number) => void
  onCloseOrderPanel: () => void
  onShowShareOwnership: () => void
  onSeatSelect: (seatNumber: number | null, tableId: string | null) => void
  onClearSelectedSeat: () => void
  onSelectSeat: (tableId: string, seatNumber: number) => void
  onAddSeat: () => void
  onFireCourse: (courseNumber: number) => void
  // Content
  children?: React.ReactNode
}

export const FloorPlanOrderPanel = memo(function FloorPlanOrderPanel({
  activeTable,
  activeTableId,
  activeOrderId,
  activeOrderNumber,
  activeOrderType,
  tableRequiredButMissing,
  activeSeatNumber,
  totalSeats,
  hasSplitChips,
  splitChips,
  inlineOrderItems,
  orderTotal,
  showTableOptions,
  coursingEnabled,
  guestCount,
  courseDelays,
  onSetShowTableOptions,
  onCoursingToggle,
  onGuestCountChange,
  onCloseOrderPanel,
  onShowShareOwnership,
  onSeatSelect,
  onClearSelectedSeat,
  onSelectSeat,
  onAddSeat,
  onFireCourse,
  children,
}: FloorPlanOrderPanelProps) {
  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(15, 23, 42, 0.6)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {tableRequiredButMissing && (!activeOrderType || activeOrderType === 'dine_in') ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          textAlign: 'center',
          color: '#94a3b8',
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <p style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0', marginTop: '16px', marginBottom: '8px' }}>
            Tap a table to start
          </p>
          <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>
            Select a table on the floor plan to begin a dine-in order
          </p>
        </div>
      ) : (
        <>
          {/* Order Panel Header */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <h3
                onClick={() => activeTable && onSetShowTableOptions(!showTableOptions)}
                style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#f1f5f9',
                  margin: 0,
                  cursor: activeTable ? 'pointer' : 'default',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {activeTable
                  ? activeTable.name
                  : activeOrderType === 'bar_tab' ? 'Bar Tab'
                  : activeOrderType === 'takeout' ? 'Takeout'
                  : activeOrderType === 'delivery' ? 'Delivery'
                  : 'New Order'}
                {activeTable && (
                  <svg width="12" height="12" fill="none" stroke="#64748b" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </h3>
              {/* Table Options Popover */}
              <TableOptionsPopover
                isOpen={showTableOptions}
                onClose={() => onSetShowTableOptions(false)}
                tableName={activeTable?.name || 'Table'}
                coursingEnabled={coursingEnabled}
                onCoursingToggle={onCoursingToggle}
                guestCount={guestCount}
                onGuestCountChange={onGuestCountChange}
                orderItems={inlineOrderItems}
                orderTotal={orderTotal}
                splitOrderIds={hasSplitChips ? splitChips.map(s => s.id) : undefined}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                {activeOrderNumber && (
                  <span
                    onClick={() => onSetShowTableOptions(!showTableOptions)}
                    style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}
                  >
                    Order #{activeOrderNumber}
                  </span>
                )}
                {activeTable && totalSeats > 0 && (
                  <span style={{ fontSize: '11px', color: '#64748b', padding: '2px 6px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px' }}>
                    {totalSeats} seats
                  </span>
                )}
                {activeOrderId && (
                  <button
                    onClick={onShowShareOwnership}
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
                )}
              </div>
            </div>

            {/* Hide button */}
            <button
              onClick={onCloseOrderPanel}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(100, 116, 139, 0.3)',
                background: 'rgba(100, 116, 139, 0.1)',
                color: '#94a3b8',
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Hide
            </button>

            {/* Fire Next Course button */}
            {coursingEnabled && (() => {
              const delays = courseDelays || {}
              const pendingCourses: number[] = []
              for (const item of inlineOrderItems) {
                if (!item.sentToKitchen && item.courseNumber && item.courseNumber > 1) {
                  if (!pendingCourses.includes(item.courseNumber)) {
                    pendingCourses.push(item.courseNumber)
                  }
                }
              }
              pendingCourses.sort((a, b) => a - b)
              const nextCourse = pendingCourses.find(cn => !delays[cn]?.firedAt)
              if (!nextCourse) return null

              const delay = delays[nextCourse]
              const isTimerRunning = delay?.startedAt && !delay?.firedAt

              return (
                <button
                  onClick={() => onFireCourse(nextCourse)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    background: isTimerRunning
                      ? 'rgba(251, 191, 36, 0.15)'
                      : 'rgba(239, 68, 68, 0.15)',
                    color: isTimerRunning ? '#fbbf24' : '#f87171',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap' as const,
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                >
                  Fire C{nextCourse}
                </button>
              )
            })()}
          </div>

          {/* Seat Strip */}
          {activeTable && totalSeats > 0 && !hasSplitChips ? (
            <div
              style={{
                padding: '10px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)',
                flexShrink: 0,
                maxHeight: '150px',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Assign to seat:</span>
                {activeSeatNumber && (
                  <span style={{ fontSize: '10px', color: getSeatTextColor(activeSeatNumber) }}>
                    New items → Seat {activeSeatNumber}
                  </span>
                )}
              </div>

              {/* "Shared" button */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0' }}>
                <button
                  onClick={() => {
                    onSeatSelect(null, null)
                    onClearSelectedSeat()
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${!activeSeatNumber ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                    background: !activeSeatNumber ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: !activeSeatNumber ? '#c084fc' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: !activeSeatNumber ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Shared
                </button>
              </div>

              {/* Flat seat list 1..N */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                {Array.from({ length: totalSeats }, (_, i) => i + 1).map(seatNum => (
                  <button
                    key={seatNum}
                    onClick={() => {
                      onSeatSelect(seatNum, activeTable.id)
                      if (activeTableId) {
                        onSelectSeat(activeTableId, seatNum)
                      }
                    }}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      border: `1px solid ${activeSeatNumber === seatNum ? getSeatBorderColor(seatNum) : getSeatBorderColor(seatNum)}`,
                      background: activeSeatNumber === seatNum ? getSeatBgColor(seatNum) : 'rgba(255, 255, 255, 0.05)',
                      color: activeSeatNumber === seatNum ? getSeatTextColor(seatNum) : getSeatTextColor(seatNum),
                      fontSize: '13px',
                      fontWeight: activeSeatNumber === seatNum ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {seatNum}
                  </button>
                ))}

                {/* Add Seat Button */}
                <button
                  onClick={onAddSeat}
                  title="Add a seat for extra guest"
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    border: '2px dashed rgba(34, 197, 94, 0.4)',
                    background: 'rgba(34, 197, 94, 0.1)',
                    color: '#22c55e',
                    fontSize: '18px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'
                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.6)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'
                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)'
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}

          {/* Order content (children from parent) */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {children}
          </div>
        </>
      )}
    </div>
  )
})

'use client'

import { useState, useEffect, useRef } from 'react'
import { EntertainmentSessionControls } from './EntertainmentSessionControls'
import type { UiModifier } from '@/types/orders'

export interface OrderPanelItemData {
  id: string
  name: string
  quantity: number
  price: number
  modifiers?: UiModifier[]  // ✅ Use canonical type
  specialNotes?: string
  kitchenStatus?: 'pending' | 'sent' | 'cooking' | 'ready' | 'served'
  isHeld?: boolean
  isCompleted?: boolean
  // Entertainment
  isTimedRental?: boolean
  menuItemId?: string
  blockTimeMinutes?: number
  blockTimeStartedAt?: string
  blockTimeExpiresAt?: string
  seatNumber?: number
  courseNumber?: number
  courseStatus?: string
  sentToKitchen?: boolean
  resendCount?: number
  completedAt?: string
  createdAt?: string
  // Per-item delay
  delayMinutes?: number | null
  delayStartedAt?: string | null
  delayFiredAt?: string | null
}

interface OrderPanelItemProps {
  item: OrderPanelItemData
  locationId?: string
  showControls?: boolean
  showEntertainmentTimer?: boolean
  onClick?: (item: OrderPanelItemData) => void
  onRemove?: (itemId: string) => void
  onQuantityChange?: (itemId: string, delta: number) => void
  onSessionEnded?: () => void
  onTimerStarted?: () => void
  onTimeExtended?: () => void
  onHoldToggle?: (itemId: string) => void
  onNoteEdit?: (itemId: string, currentNote?: string) => void
  onCourseChange?: (itemId: string, course: number | null) => void
  onEditModifiers?: (itemId: string) => void
  onCompVoid?: (itemId: string) => void
  onResend?: (itemId: string) => void
  onSplit?: (itemId: string) => void
  // Props for the More expandable section
  isExpanded?: boolean
  onToggleExpand?: (itemId: string) => void
  maxSeats?: number
  maxCourses?: number
  onSeatChange?: (itemId: string, seat: number | null) => void
  // Newest item highlight
  isNewest?: boolean
  // Quick Pick selection
  isSelected?: boolean
  onSelect?: (itemId: string) => void
  // Per-item delay
  onFireItem?: (itemId: string) => void
  onCancelItemDelay?: (itemId: string) => void
}

export function OrderPanelItem({
  item,
  locationId,
  showControls = false,
  showEntertainmentTimer = false,
  onClick,
  onRemove,
  onQuantityChange,
  onSessionEnded,
  onTimerStarted,
  onTimeExtended,
  onHoldToggle,
  onNoteEdit,
  onCourseChange,
  onEditModifiers,
  onCompVoid,
  onResend,
  onSplit,
  isExpanded,
  onToggleExpand,
  maxSeats,
  maxCourses,
  onSeatChange,
  isNewest,
  isSelected,
  onSelect,
  onFireItem,
  onCancelItemDelay,
}: OrderPanelItemProps) {
  const itemTotal = item.price * item.quantity
  const modifiersTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.price, 0) * item.quantity
  const totalPrice = itemTotal + modifiersTotal

  const isSent = item.kitchenStatus && item.kitchenStatus !== 'pending'
  const isReady = item.kitchenStatus === 'ready' || item.isCompleted

  // Per-item delay states
  const hasDelayPreset = !!(item.delayMinutes && item.delayMinutes > 0 && !item.delayStartedAt && !item.delayFiredAt)
  const hasActiveDelay = !!(item.delayMinutes && item.delayMinutes > 0 && item.delayStartedAt && !item.delayFiredAt)
  const hasDelayFired = !!(item.delayMinutes && item.delayMinutes > 0 && item.delayFiredAt)
  const [delayRemaining, setDelayRemaining] = useState<number | null>(null)
  const delayFiredRef = useRef(false)

  useEffect(() => {
    if (!hasActiveDelay || !item.delayStartedAt || !item.delayMinutes) {
      setDelayRemaining(null)
      delayFiredRef.current = false
      return
    }
    delayFiredRef.current = false
    const tick = () => {
      const started = new Date(item.delayStartedAt!).getTime()
      const now = Date.now()
      const elapsed = (now - started) / 1000
      const total = item.delayMinutes! * 60
      const remaining = Math.max(0, total - elapsed)
      setDelayRemaining(Math.ceil(remaining))
      if (remaining <= 0 && !delayFiredRef.current) {
        delayFiredRef.current = true
        onFireItem?.(item.id)
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [hasActiveDelay, item.delayStartedAt, item.delayMinutes, item.id, onFireItem])

  // Status config for badges
  const STATUS_CONFIG: Record<string, { color: string; bgColor: string; label: string }> = {
    sent: { color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.15)', label: 'Sent' },
    cooking: { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.15)', label: 'Cooking' },
    ready: { color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)', label: 'Ready' },
    served: { color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.15)', label: 'Served' },
  }

  const statusConfig = item.kitchenStatus ? STATUS_CONFIG[item.kitchenStatus] : null

  return (
    <div
      data-item-id={item.id}
      style={{
        padding: '12px',
        background: isNewest
          ? 'rgba(34, 197, 94, 0.12)'
          : isSelected
          ? 'rgba(168, 85, 247, 0.06)'
          : hasActiveDelay
          ? 'rgba(251, 191, 36, 0.06)'
          : hasDelayPreset
          ? 'rgba(59, 130, 246, 0.06)'
          : isReady
          ? 'rgba(34, 197, 94, 0.08)'
          : isSent
          ? 'rgba(59, 130, 246, 0.05)'
          : 'rgba(255, 255, 255, 0.03)',
        borderTop: isSelected
          ? '2px solid rgba(168, 85, 247, 0.5)'
          : `1px solid ${
              isNewest
                ? 'rgba(34, 197, 94, 0.5)'
                : hasActiveDelay
                ? 'rgba(251, 191, 36, 0.35)'
                : hasDelayPreset
                ? 'rgba(59, 130, 246, 0.35)'
                : isReady
                ? 'rgba(34, 197, 94, 0.25)'
                : isSent
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(255, 255, 255, 0.08)'
            }`,
        borderRight: isSelected
          ? '2px solid rgba(168, 85, 247, 0.5)'
          : `1px solid ${
              isNewest
                ? 'rgba(34, 197, 94, 0.5)'
                : hasActiveDelay
                ? 'rgba(251, 191, 36, 0.35)'
                : hasDelayPreset
                ? 'rgba(59, 130, 246, 0.35)'
                : isReady
                ? 'rgba(34, 197, 94, 0.25)'
                : isSent
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(255, 255, 255, 0.08)'
            }`,
        borderBottom: isSelected
          ? '2px solid rgba(168, 85, 247, 0.5)'
          : `1px solid ${
              isNewest
                ? 'rgba(34, 197, 94, 0.5)'
                : hasActiveDelay
                ? 'rgba(251, 191, 36, 0.35)'
                : hasDelayPreset
                ? 'rgba(59, 130, 246, 0.35)'
                : isReady
                ? 'rgba(34, 197, 94, 0.25)'
                : isSent
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(255, 255, 255, 0.08)'
            }`,
        borderLeft: hasActiveDelay
          ? '3px solid rgba(251, 191, 36, 0.7)'
          : hasDelayPreset
          ? '3px solid rgba(59, 130, 246, 0.6)'
          : isSelected
          ? '2px solid rgba(168, 85, 247, 0.5)'
          : `1px solid ${
              isNewest
                ? 'rgba(34, 197, 94, 0.5)'
                : isReady
                ? 'rgba(34, 197, 94, 0.25)'
                : isSent
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(255, 255, 255, 0.08)'
            }`,
        borderRadius: '10px',
        cursor: (onClick && !isSent) || (onSelect && !isSent) ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        boxShadow: isNewest
          ? '0 0 12px rgba(34, 197, 94, 0.2)'
          : isSelected
          ? '0 0 8px rgba(168, 85, 247, 0.15)'
          : hasActiveDelay
          ? '0 0 8px rgba(251, 191, 36, 0.12)'
          : hasDelayPreset
          ? '0 0 8px rgba(59, 130, 246, 0.1)'
          : undefined,
        // Compensate for 2px border so layout doesn't shift
        margin: isSelected ? '-1px' : undefined,
      }}
      onClick={() => {
        if (!isSent) {
          onSelect?.(item.id)
          onClick?.(item)
        }
      }}
      onMouseEnter={(e) => {
        if ((onClick || onSelect) && !isSent && !isSelected) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isSent && !isSelected) {
          e.currentTarget.style.background = isNewest ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.03)'
          e.currentTarget.style.borderColor = isNewest ? 'rgba(34, 197, 94, 0.5)' : 'rgba(255, 255, 255, 0.08)'
        }
      }}
    >
      {/* Main item row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Quantity badge */}
        <div
          style={{
            flexShrink: 0,
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            background: isSent ? 'rgba(59, 130, 246, 0.2)' : 'rgba(168, 85, 247, 0.2)',
            color: isSent ? '#60a5fa' : '#c084fc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {item.quantity}
        </div>

        {/* Item details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0' }}>
              {item.name}
            </span>

            {/* Status badge */}
            {statusConfig && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: statusConfig.bgColor,
                  color: statusConfig.color,
                  fontWeight: 600,
                }}
              >
                {statusConfig.label}
              </span>
            )}

            {/* MADE badge */}
            {item.isCompleted && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(34, 197, 94, 0.2)',
                  color: '#4ade80',
                  fontWeight: 700,
                }}
              >
                ✓ MADE
              </span>
            )}

            {/* Held badge */}
            {item.isHeld && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#f87171',
                  fontWeight: 600,
                }}
              >
                HELD
              </span>
            )}

            {/* Per-item delay badge — active countdown */}
            {hasActiveDelay && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(251, 191, 36, 0.2)',
                  color: '#fbbf24',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {item.delayMinutes}m
              </span>
            )}

            {/* Per-item delay fired badge */}
            {hasDelayFired && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(34, 197, 94, 0.2)',
                  color: '#4ade80',
                  fontWeight: 600,
                }}
              >
                ✓ Fired
              </span>
            )}

            {/* Seat Badge */}
            {item.seatNumber && (
              <span
                style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(168, 85, 247, 0.2)',
                  color: '#c084fc',
                  fontWeight: 600,
                }}
              >
                S{item.seatNumber}
              </span>
            )}

            {/* Course Badge */}
            {item.courseNumber && (
              <span
                style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: item.courseStatus === 'fired' ? 'rgba(251, 191, 36, 0.2)'
                    : item.courseStatus === 'ready' ? 'rgba(34, 197, 94, 0.2)'
                    : 'rgba(59, 130, 246, 0.2)',
                  color: item.courseStatus === 'fired' ? '#fbbf24'
                    : item.courseStatus === 'ready' ? '#4ade80'
                    : '#60a5fa',
                  fontWeight: 600,
                }}
              >
                C{item.courseNumber}
              </span>
            )}

            {/* Resend Count Badge */}
            {item.resendCount && item.resendCount > 0 && (
              <span
                style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(245, 158, 11, 0.2)',
                  color: '#f59e0b',
                  fontWeight: 600,
                }}
              >
                Resent {item.resendCount}x
              </span>
            )}

            {/* Inline Note icon — fits in name row, wraps if name is long */}
            {onNoteEdit && !isSent && (
              <button
                onClick={(e) => { e.stopPropagation(); onNoteEdit(item.id, item.specialNotes) }}
                style={{
                  padding: '4px',
                  background: item.specialNotes ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: item.specialNotes ? '#f59e0b' : '#64748b',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
                  lineHeight: 1, verticalAlign: 'middle',
                  minWidth: '24px', minHeight: '24px', justifyContent: 'center',
                }}
                title={item.specialNotes ? 'Edit note' : 'Add note'}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </button>
            )}
          </div>

          {/* Modifiers — indented by depth (0=top, 1=child, 2=grandchild) */}
          {item.modifiers && item.modifiers.length > 0 && (
            <div style={{ marginTop: '4px' }}>
              {item.modifiers.map((mod, idx) => {
                const depth = mod.depth || 0
                // Indent increases with depth: 8px base + 10px per level
                const indent = 8 + depth * 10
                // Prefix: depth 0 = •, depth 1 = ‒ (dash), depth 2+ = ∘ (small circle)
                const prefix = depth === 0 ? '•' : depth === 1 ? '–' : '∘'
                // Slightly dimmer color for deeper nesting
                const textColor = depth === 0 ? '#94a3b8' : depth === 1 ? '#7d8da0' : '#64748b'
                const fontSize = depth === 0 ? '12px' : '11px'

                return (
                  <div
                    key={idx}
                    style={{
                      fontSize,
                      color: textColor,
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingLeft: `${indent}px`,
                      lineHeight: 1.5,
                    }}
                  >
                    <span>
                      {prefix} {mod.preModifier ? <span style={{ color: mod.preModifier === 'no' ? '#f87171' : mod.preModifier === 'extra' ? '#fbbf24' : '#60a5fa', fontWeight: 600, textTransform: 'uppercase', fontSize: '10px' }}>{mod.preModifier} </span> : null}{mod.name}
                    </span>
                    {mod.price > 0 && (
                      <span style={{ color: '#64748b', fontSize: '11px' }}>+${mod.price.toFixed(2)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Special notes */}
          {item.specialNotes && (
            <div
              style={{
                marginTop: '6px',
                fontSize: '11px',
                color: '#f59e0b',
                fontStyle: 'italic',
                paddingLeft: '8px',
              }}
            >
              Note: {item.specialNotes}
            </div>
          )}

          {/* Per-item delay PRESET indicator (before send — shows delay is queued) */}
          {hasDelayPreset && (
            <div
              style={{
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                borderRadius: '8px',
              }}
            >
              {/* Clock icon */}
              <svg width="16" height="16" fill="none" stroke="#60a5fa" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#60a5fa',
                flex: 1,
              }}>
                {item.delayMinutes}min delay — starts on Send
              </span>
              {onCancelItemDelay && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCancelItemDelay(item.id) }}
                  style={{
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: '#93c5fd',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Per-item delay countdown (after send — actively counting) */}
          {hasActiveDelay && delayRemaining !== null && (
            <div
              style={{
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                background: delayRemaining <= 30
                  ? 'rgba(239, 68, 68, 0.12)'
                  : 'rgba(251, 191, 36, 0.1)',
                borderRadius: '6px',
                animation: delayRemaining <= 10 ? 'pulse 1s ease-in-out infinite' : undefined,
              }}
            >
              <svg width="12" height="12" fill="none" stroke={delayRemaining <= 30 ? '#f87171' : '#fbbf24'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{
                fontSize: '12px',
                fontWeight: 700,
                fontFamily: 'monospace',
                color: delayRemaining <= 30 ? '#f87171' : '#fbbf24',
                flex: 1,
              }}>
                {Math.floor(delayRemaining / 60)}:{(delayRemaining % 60).toString().padStart(2, '0')}
              </span>
              {onFireItem && (
                <button
                  onClick={(e) => { e.stopPropagation(); onFireItem(item.id) }}
                  style={{
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 700,
                    borderRadius: '4px',
                    border: 'none',
                    background: 'rgba(239, 68, 68, 0.25)',
                    color: '#f87171',
                    cursor: 'pointer',
                  }}
                >
                  Fire
                </button>
              )}
              {onCancelItemDelay && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCancelItemDelay(item.id) }}
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#94a3b8',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* Entertainment timer */}
          {showEntertainmentTimer &&
            item.isTimedRental &&
            item.menuItemId &&
            locationId &&
            (item.blockTimeMinutes || item.blockTimeStartedAt || item.blockTimeExpiresAt) && (
              <div style={{ marginTop: '8px' }}>
                <EntertainmentSessionControls
                  orderItemId={item.id}
                  menuItemId={item.menuItemId}
                  locationId={locationId}
                  itemName={item.name}
                  blockTimeMinutes={item.blockTimeMinutes || null}
                  blockTimeStartedAt={item.blockTimeStartedAt || null}
                  blockTimeExpiresAt={item.blockTimeExpiresAt || null}
                  isTimedRental={item.isTimedRental}
                  defaultBlockMinutes={item.blockTimeMinutes || 60}
                  onSessionEnded={onSessionEnded}
                  onTimerStarted={onTimerStarted}
                  onTimeExtended={onTimeExtended}
                />
              </div>
            )}
        </div>

        {/* Price + Delete (two-column: delete sits under price) */}
        <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
            ${totalPrice.toFixed(2)}
          </div>
          {item.quantity > 1 && (
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '-2px' }}>
              ${(totalPrice / item.quantity).toFixed(2)} ea
            </div>
          )}
          {/* Delete button — under price for pending items */}
          {showControls && !isSent && onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
              style={{
                padding: '4px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '5px', color: '#f87171', cursor: 'pointer',
                marginTop: '2px',
              }}
              title="Remove item"
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>

      </div>

      {/* Action Controls Row — for SENT items only */}
      {showControls && (
        <div style={{ marginTop: '6px' }}>
          {/* SENT ITEMS: Edit Mods + Resend + Comp/Void + Split */}
          {isSent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {onEditModifiers && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEditModifiers(item.id) }}
                  style={{
                    padding: '5px 10px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '6px', color: '#60a5fa',
                    fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                  }}
                >Edit Mods</button>
              )}
              {onResend && (
                <button
                  onClick={(e) => { e.stopPropagation(); onResend(item.id) }}
                  style={{
                    padding: '5px 10px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '6px', color: '#fbbf24',
                    fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Resend
                </button>
              )}
              {onCompVoid && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCompVoid(item.id) }}
                  style={{
                    padding: '5px 10px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: '6px', color: '#f59e0b',
                    fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                  }}
                >Comp/Void</button>
              )}
              {onSplit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSplit(item.id) }}
                  style={{
                    padding: '5px 10px',
                    background: 'rgba(168, 85, 247, 0.1)',
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                    borderRadius: '6px', color: '#a855f7',
                    fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                  }}
                >Split</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

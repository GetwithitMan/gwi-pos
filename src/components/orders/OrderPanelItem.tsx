'use client'

import { useState, useEffect, useRef, memo } from 'react'
import { EntertainmentSessionControls } from './EntertainmentSessionControls'
import type { UiModifier, IngredientModification } from '@/types/orders'
import { getSeatBgColor, getSeatTextColor, getSeatBorderColor } from '@/lib/seat-utils'

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
  // Comp/void status
  status?: 'active' | 'comped' | 'voided'
  voidReason?: string
  wasMade?: boolean
  // Ingredient modifications (No, Lite, Extra, On Side, Swap)
  ingredientModifications?: IngredientModification[]
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
  onCompVoid?: (item: OrderPanelItemData) => void
  onResend?: (item: OrderPanelItemData) => void
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
  // Dual pricing: multiplier to convert cash (DB) price to card (display) price
  // e.g. 1.04 for 4% surcharge. When undefined or 1, shows cash price as-is.
  cardPriceMultiplier?: number
}

export const OrderPanelItem = memo(function OrderPanelItem({
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
  cardPriceMultiplier,
}: OrderPanelItemProps) {
  const isVoided = item.status === 'voided'
  const isComped = item.status === 'comped'
  const isCompedOrVoided = isVoided || isComped

  // Apply card price multiplier for dual pricing display
  const pm = cardPriceMultiplier || 1
  const displayItemPrice = Math.round(item.price * pm * 100) / 100
  const displayModPrices = (item.modifiers || []).map(mod => Math.round(mod.price * pm * 100) / 100)

  const itemTotal = displayItemPrice * item.quantity
  const modifiersTotal = displayModPrices.reduce((sum, p) => sum + p, 0) * item.quantity
  const totalPrice = isCompedOrVoided ? 0 : itemTotal + modifiersTotal
  const originalPrice = itemTotal + modifiersTotal

  const isSent = item.kitchenStatus && item.kitchenStatus !== 'pending'
  const isReady = item.kitchenStatus === 'ready' || item.isCompleted

  // Seat picker state
  const [showSeatPicker, setShowSeatPicker] = useState(false)

  // Per-item delay states
  // CRITICAL: hasActiveDelay must also check !sentToKitchen to prevent infinite fire loop
  // When loadOrder reloads from API, delayFiredAt (client-only) gets wiped, but sentToKitchen
  // persists via kitchenStatus from the server. Without the sentToKitchen check, the timer
  // would re-fire items that are already sent to kitchen.
  const hasDelayPreset = !!(item.delayMinutes && item.delayMinutes > 0 && !item.delayStartedAt && !item.delayFiredAt)
  const hasActiveDelay = !!(item.delayMinutes && item.delayMinutes > 0 && item.delayStartedAt && !item.delayFiredAt && !item.sentToKitchen)
  const hasDelayFired = !!(item.delayMinutes && item.delayMinutes > 0 && (item.delayFiredAt || item.sentToKitchen))
  const [delayRemaining, setDelayRemaining] = useState<number | null>(null)
  const delayFiredRef = useRef(false)

  useEffect(() => {
    if (!hasActiveDelay || !item.delayStartedAt || !item.delayMinutes) {
      setDelayRemaining(null)
      delayFiredRef.current = false
      return
    }
    // NOTE: Do NOT reset delayFiredRef here — it must only reset when hasActiveDelay
    // becomes false (handled by the early return above). Resetting here caused an
    // infinite fire loop: fire → store update → effect re-runs → ref reset → fire again.
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
        opacity: isCompedOrVoided ? 0.6 : 1,
        background: isCompedOrVoided
          ? (isVoided ? 'rgba(239, 68, 68, 0.08)' : 'rgba(59, 130, 246, 0.08)')
          : isNewest
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
        cursor: (onClick && !isSent) || onSelect ? 'pointer' : 'default',
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
        // Toggle selection for all items (sent items show Resend/Comp/Void when selected)
        onSelect?.(item.id)
        if (!isSent) {
          onClick?.(item)
        }
      }}
      onMouseEnter={(e) => {
        if ((onClick || onSelect) && !isSelected) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
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
            <span style={{
              fontSize: '14px',
              fontWeight: 500,
              color: isCompedOrVoided ? '#94a3b8' : '#e2e8f0',
              textDecoration: isCompedOrVoided ? 'line-through' : 'none',
            }}>
              {item.name}
            </span>

            {/* VOIDED / COMPED stamp */}
            {isVoided && (
              <span style={{
                fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                background: 'rgba(239, 68, 68, 0.25)',
                color: '#f87171', fontWeight: 800, letterSpacing: '1px',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                textTransform: 'uppercase',
              }}>
                VOID
              </span>
            )}
            {isComped && (
              <span style={{
                fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                background: 'rgba(59, 130, 246, 0.25)',
                color: '#60a5fa', fontWeight: 800, letterSpacing: '1px',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                textTransform: 'uppercase',
              }}>
                COMP
              </span>
            )}

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

            {/* Held badge with Fire button */}
            {item.isHeld && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#f87171',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                HELD
                {onFireItem && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFireItem(item.id) }}
                    style={{
                      padding: '1px 6px',
                      fontSize: '10px',
                      fontWeight: 700,
                      borderRadius: '3px',
                      border: 'none',
                      background: 'rgba(239, 68, 68, 0.35)',
                      color: '#fca5a5',
                      cursor: 'pointer',
                    }}
                  >
                    Fire
                  </button>
                )}
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

            {/* Seat Badge — clickable when onSeatChange + maxSeats provided */}
            {(item.seatNumber != null && item.seatNumber > 0 || (onSeatChange && maxSeats)) && (
              <span style={{ position: 'relative', display: 'inline-block' }}>
                {onSeatChange && maxSeats ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowSeatPicker(!showSeatPicker) }}
                    style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: getSeatBgColor(item.seatNumber),
                      color: getSeatTextColor(item.seatNumber),
                      fontWeight: 600,
                      border: `1px solid ${getSeatBorderColor(item.seatNumber)}`,
                      cursor: 'pointer',
                    }}
                  >
                    {item.seatNumber ? `S${item.seatNumber}` : '+S'}
                  </button>
                ) : item.seatNumber ? (
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: getSeatBgColor(item.seatNumber),
                      color: getSeatTextColor(item.seatNumber),
                      fontWeight: 600,
                    }}
                  >
                    S{item.seatNumber}
                  </span>
                ) : null}
                {showSeatPicker && onSeatChange && maxSeats && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '4px',
                      zIndex: 50,
                      background: 'rgba(30, 30, 40, 0.95)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '8px',
                      padding: '6px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px',
                      minWidth: '120px',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    {Array.from({ length: maxSeats }, (_, i) => i + 1).map(seat => (
                      <button
                        key={seat}
                        onClick={() => { onSeatChange(item.id, seat); setShowSeatPicker(false) }}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          border: item.seatNumber === seat ? `2px solid ${getSeatTextColor(seat)}` : `1px solid ${getSeatBorderColor(seat)}`,
                          background: item.seatNumber === seat ? getSeatBgColor(seat) : 'rgba(255,255,255,0.05)',
                          color: item.seatNumber === seat ? getSeatTextColor(seat) : getSeatTextColor(seat),
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {seat}
                      </button>
                    ))}
                    {item.seatNumber != null && item.seatNumber > 0 && (
                      <button
                        onClick={() => { onSeatChange(item.id, null); setShowSeatPicker(false) }}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#f87171',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </span>
            )}

            {/* Course Badge */}
            {item.courseNumber != null && item.courseNumber > 0 && (
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
            {item.resendCount != null && item.resendCount > 0 && (
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

          {/* Ingredient modifications — base item customizations (No, Lite, Extra, On Side, Swap) */}
          {item.ingredientModifications && item.ingredientModifications.length > 0 && (
            <div className="mt-1">
              {item.ingredientModifications.map((mod, idx) => {
                const typeClass = mod.modificationType === 'no' ? 'text-red-400'
                  : mod.modificationType === 'extra' ? 'text-amber-400'
                  : mod.modificationType === 'lite' ? 'text-blue-400'
                  : mod.modificationType === 'on_side' ? 'text-indigo-400'
                  : 'text-purple-400' // swap
                const typeLabel = mod.modificationType === 'on_side' ? 'SIDE' : mod.modificationType.toUpperCase()
                return (
                  <div
                    key={idx}
                    className="text-xs text-slate-400 flex justify-between pl-2 leading-relaxed"
                  >
                    <span>
                      <span className={`${typeClass} font-semibold text-[10px] mr-1`}>{typeLabel}</span>
                      {mod.modificationType === 'no' ? <span className="line-through">{mod.name}</span> : mod.name}
                      {mod.swappedTo && <span className="text-purple-400"> → {mod.swappedTo.name}</span>}
                    </span>
                    {mod.priceAdjustment > 0 && (
                      <span className="text-slate-500 text-[11px]">+${mod.priceAdjustment.toFixed(2)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Modifiers — indented by depth with connector arrows */}
          {item.modifiers && item.modifiers.length > 0 && (
            <div className="mt-1">
              {item.modifiers.map((mod, idx) => {
                const depth = mod.depth || 0
                const indent = 8 + depth * 20

                return (
                  <div
                    key={idx}
                    className={`flex justify-between leading-relaxed ${
                      depth === 0 ? 'text-xs text-slate-400' : 'text-[11px] text-slate-500'
                    }`}
                    style={{ paddingLeft: `${indent}px` }}
                  >
                    <span>
                      {depth === 0 ? '• ' : '↳ '}
                      {mod.preModifier ? (
                        <span className={`font-semibold uppercase text-[10px] mr-1 ${
                          mod.preModifier === 'no' ? 'text-red-400'
                            : mod.preModifier === 'extra' ? 'text-amber-400'
                            : 'text-blue-400'
                        }`}>{mod.preModifier}{' '}</span>
                      ) : null}
                      {mod.name}
                    </span>
                    {mod.price > 0 && (
                      <span className="text-slate-500 text-[11px]">+${displayModPrices[idx].toFixed(2)}</span>
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

          {/* Void/Comp details */}
          {isCompedOrVoided && (
            <div style={{
              marginTop: '6px', padding: '6px 10px',
              background: isVoided ? 'rgba(239, 68, 68, 0.08)' : 'rgba(59, 130, 246, 0.08)',
              border: `1px solid ${isVoided ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`,
              borderRadius: '6px', fontSize: '11px',
            }}>
              {item.voidReason && (
                <div style={{ color: '#94a3b8', marginBottom: '2px' }}>
                  Reason: {item.voidReason}
                </div>
              )}
              <div style={{
                color: item.wasMade ? '#f87171' : '#4ade80',
                fontWeight: 600,
              }}>
                {item.wasMade ? '🍳 Was Made — Waste' : '✋ Not Made — No Waste'}
              </div>
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

        {/* Delete + Price (inline row) */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {showControls && !isSent && onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
              style={{
                padding: '3px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '5px', color: '#f87171', cursor: 'pointer',
              }}
              title="Remove item"
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <div style={{ textAlign: 'right' }}>
            {isCompedOrVoided ? (
              <>
                <div style={{ fontSize: '14px', fontWeight: 600, color: isVoided ? '#f87171' : '#60a5fa' }}>
                  $0.00
                </div>
                <div style={{ fontSize: '10px', color: '#64748b', textDecoration: 'line-through', marginTop: '-2px' }}>
                  ${originalPrice.toFixed(2)}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                  ${totalPrice.toFixed(2)}
                </div>
                {item.quantity > 1 && (
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '-2px' }}>
                    ${(totalPrice / item.quantity).toFixed(2)} ea
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      {/* Action Controls Row — for SENT items, only when selected */}
      {showControls && isSelected && (
        <div style={{ marginTop: '6px' }}>
          {isSent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {/* Edit Mods hidden after send — must void and re-ring to change */}
              {onResend && (
                <button
                  onClick={(e) => { e.stopPropagation(); onResend(item) }}
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
                  onClick={(e) => { e.stopPropagation(); onCompVoid(item) }}
                  style={{
                    padding: '5px 10px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: '6px', color: '#f59e0b',
                    fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                  }}
                >Comp/Void</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

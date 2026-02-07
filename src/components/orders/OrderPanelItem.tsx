'use client'

import { EntertainmentSessionControls } from './EntertainmentSessionControls'

export interface OrderPanelItemData {
  id: string
  name: string
  quantity: number
  price: number
  modifiers?: { name: string; price: number }[]
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
}: OrderPanelItemProps) {
  const itemTotal = item.price * item.quantity
  const modifiersTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.price, 0) * item.quantity
  const totalPrice = itemTotal + modifiersTotal

  const isSent = item.kitchenStatus && item.kitchenStatus !== 'pending'
  const isReady = item.kitchenStatus === 'ready' || item.isCompleted

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
          : isReady
          ? 'rgba(34, 197, 94, 0.08)'
          : isSent
          ? 'rgba(59, 130, 246, 0.05)'
          : 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${
          isNewest
            ? 'rgba(34, 197, 94, 0.5)'
            : isReady
            ? 'rgba(34, 197, 94, 0.25)'
            : isSent
            ? 'rgba(59, 130, 246, 0.15)'
            : 'rgba(255, 255, 255, 0.08)'
        }`,
        borderRadius: '10px',
        cursor: onClick && !isSent ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        boxShadow: isNewest ? '0 0 12px rgba(34, 197, 94, 0.2)' : undefined,
      }}
      onClick={() => !isSent && onClick?.(item)}
      onMouseEnter={(e) => {
        if (onClick && !isSent) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isSent) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
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
          </div>

          {/* Modifiers */}
          {item.modifiers && item.modifiers.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {item.modifiers.map((mod, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '12px',
                    color: '#94a3b8',
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingLeft: '8px',
                    lineHeight: 1.4,
                  }}
                >
                  <span>• {mod.name}</span>
                  {mod.price > 0 && (
                    <span style={{ color: '#64748b' }}>+${mod.price.toFixed(2)}</span>
                  )}
                </div>
              ))}
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

        {/* Price */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
            ${totalPrice.toFixed(2)}
          </div>
          {item.quantity > 1 && (
            <div style={{ fontSize: '10px', color: '#64748b' }}>
              ${(totalPrice / item.quantity).toFixed(2)} ea
            </div>
          )}
        </div>

      </div>

      {/* Action Controls Row — identical on all screens */}
      {showControls && (
        <div style={{ marginTop: '10px' }}>
          {/* PENDING ITEMS: Qty + Note + Hold */}
          {!isSent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {/* Quantity Controls */}
              {onQuantityChange && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuantityChange(item.id, -1) }}
                    disabled={item.quantity <= 1}
                    style={{
                      width: '26px', height: '26px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: item.quantity <= 1 ? '#475569' : '#e2e8f0',
                      cursor: item.quantity <= 1 ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                    }}
                  >−</button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', minWidth: '20px', textAlign: 'center' }}>
                    {item.quantity}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuantityChange(item.id, 1) }}
                    style={{
                      width: '26px', height: '26px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: '#e2e8f0', cursor: 'pointer', fontSize: '14px',
                    }}
                  >+</button>
                </div>
              )}

              {/* Note Button */}
              {onNoteEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onNoteEdit(item.id, item.specialNotes) }}
                  style={{
                    padding: '5px 8px',
                    background: item.specialNotes ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${item.specialNotes ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                    borderRadius: '6px',
                    color: item.specialNotes ? '#f59e0b' : '#94a3b8',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
                  }}
                  title={item.specialNotes ? 'Edit note' : 'Add note'}
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                  Note
                </button>
              )}

              {/* Hold/Fire Toggle */}
              {onHoldToggle && (
                item.isHeld ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onHoldToggle(item.id) }}
                    style={{
                      padding: '2px 8px', fontSize: '10px', borderRadius: '4px',
                      background: 'rgba(34, 197, 94, 0.8)', color: 'white',
                      border: 'none', fontWeight: 600, cursor: 'pointer',
                    }}
                    title="Fire item - send to kitchen"
                  >Fire</button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onHoldToggle(item.id) }}
                    style={{
                      padding: '2px 8px', fontSize: '10px', borderRadius: '4px',
                      background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b',
                      border: 'none', fontWeight: 600, cursor: 'pointer',
                    }}
                    title="Hold item - don't send to kitchen"
                  >Hold</button>
                )
              )}
            </div>
          )}

          {/* PENDING ITEMS: Course + Edit + Delete */}
          {!isSent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
              {/* Course Assignment */}
              {onCourseChange && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>Course:</span>
                  {[1, 2, 3].map(c => (
                    <button
                      key={c}
                      onClick={(e) => {
                        e.stopPropagation()
                        onCourseChange(item.id, item.courseNumber === c ? null : c)
                      }}
                      style={{
                        padding: '2px 6px', fontSize: '10px', borderRadius: '4px',
                        background: item.courseNumber === c ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: item.courseNumber === c ? '#60a5fa' : '#64748b',
                        border: item.courseNumber === c ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                        cursor: 'pointer', fontWeight: item.courseNumber === c ? 600 : 400,
                      }}
                    >C{c}</button>
                  ))}
                </div>
              )}

              {/* Edit Modifiers Button */}
              {onEditModifiers && item.modifiers && item.modifiers.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEditModifiers(item.id) }}
                  style={{
                    padding: '5px 8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px', color: '#94a3b8', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
                  }}
                  title="Edit modifiers"
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              )}

              {/* More Options Toggle */}
              {onToggleExpand && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleExpand(item.id) }}
                  style={{
                    padding: '5px 8px',
                    background: isExpanded ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${isExpanded ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                    borderRadius: '6px',
                    color: isExpanded ? '#a5b4fc' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  {isExpanded ? '\u25BC' : '\u25B6'} More
                </button>
              )}

              {/* Delete Button */}
              {onRemove && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
                  style={{
                    marginLeft: 'auto', padding: '5px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '6px', color: '#f87171', cursor: 'pointer',
                  }}
                  title="Remove item"
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Expanded Seat/Course Controls (More section) */}
          {isExpanded && !isSent && (
            <div
              style={{
                marginTop: '10px',
                padding: '10px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {/* Seat Assignment */}
              {onSeatChange && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', width: '45px' }}>Seat:</span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onSeatChange(item.id, null) }}
                      style={{
                        width: '24px', height: '24px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: !item.seatNumber ? 'rgba(148, 163, 184, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px', color: '#94a3b8', cursor: 'pointer', fontSize: '11px',
                      }}
                    >{'\u2212'}</button>
                    {Array.from({ length: maxSeats || 4 }, (_, i) => i + 1).map(seat => (
                      <button
                        key={seat}
                        onClick={(e) => { e.stopPropagation(); onSeatChange(item.id, seat) }}
                        style={{
                          width: '24px', height: '24px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: item.seatNumber === seat ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${item.seatNumber === seat ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                          borderRadius: '4px',
                          color: item.seatNumber === seat ? '#c084fc' : '#94a3b8',
                          cursor: 'pointer', fontSize: '11px',
                          fontWeight: item.seatNumber === seat ? 600 : 400,
                        }}
                      >{seat}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Course Assignment (expanded - more options than inline) */}
              {onCourseChange && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', width: '45px' }}>Course:</span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCourseChange(item.id, null) }}
                      style={{
                        width: '24px', height: '24px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: !item.courseNumber ? 'rgba(148, 163, 184, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px', color: '#94a3b8', cursor: 'pointer', fontSize: '11px',
                      }}
                    >{'\u2212'}</button>
                    {Array.from({ length: maxCourses || 5 }, (_, i) => i + 1).map(course => (
                      <button
                        key={course}
                        onClick={(e) => { e.stopPropagation(); onCourseChange(item.id, course) }}
                        style={{
                          width: '24px', height: '24px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: item.courseNumber === course ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${item.courseNumber === course ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                          borderRadius: '4px',
                          color: item.courseNumber === course ? '#60a5fa' : '#94a3b8',
                          cursor: 'pointer', fontSize: '11px',
                          fontWeight: item.courseNumber === course ? 600 : 400,
                        }}
                      >{course}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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

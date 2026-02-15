'use client'

import { useRef, useCallback, useMemo, useState, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable, TableStatus } from './use-floor-plan'
import { getSeatColor } from '@/lib/seat-utils'

interface TableNodeProps {
  table: FloorPlanTable
  isSelected: boolean
  isDragging: boolean
  isDropTarget: boolean
  isColliding?: boolean  // Whether the table collides with fixtures during drag
  showSeats?: boolean  // Whether to display seat indicators
  selectedSeat?: { tableId: string; seatNumber: number } | null
  flashMessage?: string | null  // Flash message to display (e.g., "OPEN ORDER")
  isEditable?: boolean  // Admin mode - allow seat dragging
  splitCount?: number
  // Order status badges
  orderStatusBadges?: {
    hasDelay?: boolean     // ⏱ items delayed
    hasHeld?: boolean      // ⏸ items held
    hasCourses?: boolean   // 🔢 coursing enabled
    delayMinutes?: number  // e.g., 5 or 10
  }
  seatsWithItems?: Set<number>
  onTap: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onLongPress: () => void
  onSeatTap?: (seatNumber: number) => void
  onSeatDrag?: (seatId: string, newRelativeX: number, newRelativeY: number) => void
  onSeatDelete?: (seatId: string) => void
}

// Status to glow color mapping
const statusGlowColors: Record<TableStatus, string> = {
  available: 'rgba(255, 255, 255, 0.1)',
  occupied: 'rgba(99, 102, 241, 0.6)',
  reserved: 'rgba(251, 191, 36, 0.6)',
  dirty: 'rgba(245, 158, 11, 0.6)',
  in_use: 'rgba(139, 92, 246, 0.6)',
}

/**
 * DraggableSeat — uses pointer events for proper radial boundary constraint.
 * Seats can only be dragged within `maxDistance` px of the table center.
 */
interface DraggableSeatProps {
  seat: { id: string; seatNumber: number; label: string; x: number; y: number; angle: number; seatType: string; isTemporary: boolean }
  tableWidth: number
  tableHeight: number
  tableRotation: number
  isDraggable: boolean
  isSelectedSeat: boolean
  isBooth: boolean
  isEditable: boolean
  seatColor: string
  displayLabel: string
  displayNumber: number
  maxDistance: number
  onSeatDrag?: (seatId: string, newRelativeX: number, newRelativeY: number) => void
  onSeatTap?: (seatNumber: number) => void
  onSeatDelete?: (seatId: string) => void
}

function DraggableSeat({
  seat, tableWidth, tableHeight, tableRotation, isDraggable,
  isSelectedSeat, isBooth, isEditable, seatColor, displayLabel, displayNumber,
  maxDistance, onSeatDrag, onSeatTap, onSeatDelete,
}: DraggableSeatProps) {
  const dragRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // Long-hold gate: temp seats (POS view) require a 500ms hold before drag starts
  const longHoldTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [dragUnlocked, setDragUnlocked] = useState(false)
  const needsLongHold = isDraggable && !isEditable && seat.isTemporary

  const seatRelativeX = seat.x - tableWidth / 2
  const seatRelativeY = seat.y - tableHeight / 2

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isDraggable) return
    e.stopPropagation()
    e.preventDefault()
    const el = dragRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: seat.x - 12,
      origTop: seat.y - 12,
    }
    setIsDragging(false)
    setDragUnlocked(false)

    // Temp seats in POS: require long hold before drag is enabled
    if (needsLongHold) {
      longHoldTimerRef.current = setTimeout(() => {
        setDragUnlocked(true)
      }, 500)
    } else {
      // Editor seats: drag immediately
      setDragUnlocked(true)
    }
  }, [isDraggable, seat.x, seat.y, needsLongHold])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return

    // If long hold hasn't fired yet, check if finger moved too much (cancel hold)
    if (!dragUnlocked && needsLongHold) {
      const dx = e.clientX - dragStartRef.current.startX
      const dy = e.clientY - dragStartRef.current.startY
      if (Math.abs(dx) + Math.abs(dy) > 10) {
        // Finger moved before hold completed — cancel drag, let it be a tap
        if (longHoldTimerRef.current) clearTimeout(longHoldTimerRef.current)
        longHoldTimerRef.current = null
        dragStartRef.current = null
      }
      return
    }

    if (!dragUnlocked) return

    const dx = e.clientX - dragStartRef.current.startX
    const dy = e.clientY - dragStartRef.current.startY
    if (!isDragging && Math.abs(dx) + Math.abs(dy) > 3) setIsDragging(true)

    // Clamp to radial boundary from table center
    let newRelX = seatRelativeX + dx
    let newRelY = seatRelativeY + dy
    const dist = Math.sqrt(newRelX * newRelX + newRelY * newRelY)
    if (dist > maxDistance) {
      const scale = maxDistance / dist
      newRelX = newRelX * scale
      newRelY = newRelY * scale
    }
    setDragOffset({ dx: newRelX - seatRelativeX, dy: newRelY - seatRelativeY })
  }, [isDragging, dragUnlocked, needsLongHold, seatRelativeX, seatRelativeY, maxDistance])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (longHoldTimerRef.current) {
      clearTimeout(longHoldTimerRef.current)
      longHoldTimerRef.current = null
    }

    if (!dragStartRef.current) return
    const el = dragRef.current
    if (el) el.releasePointerCapture(e.pointerId)

    if (isDragging && onSeatDrag && dragOffset) {
      const newRelX = Math.round(seatRelativeX + dragOffset.dx)
      const newRelY = Math.round(seatRelativeY + dragOffset.dy)
      onSeatDrag(seat.id, newRelX, newRelY)
    }

    dragStartRef.current = null
    setDragOffset(null)
    setIsDragging(false)
    setDragUnlocked(false)
  }, [isDragging, onSeatDrag, dragOffset, seatRelativeX, seatRelativeY, seat.id])

  const left = dragOffset ? (seat.x - 12 + dragOffset.dx) : (seat.x - 12)
  const top = dragOffset ? (seat.y - 12 + dragOffset.dy) : (seat.y - 12)

  return (
    <motion.div
      ref={dragRef}
      className={`seat-indicator ${isSelectedSeat ? 'selected' : ''} ${isBooth ? 'booth-seat' : ''} ${isEditable ? 'editable' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        left,
        top,
        width: 24,
        height: 24,
        borderRadius: '50%',
        backgroundColor: isSelectedSeat ? seatColor
          : isEditable ? 'rgba(99, 102, 241, 0.3)'
          : `${seatColor}26`,
        border: isSelectedSeat ? `2px solid ${seatColor}`
          : isEditable ? '2px solid rgba(99, 102, 241, 0.5)'
          : `2px solid ${seatColor}80`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 600,
        color: isSelectedSeat ? 'white'
          : isEditable ? '#c7d2fe'
          : seatColor,
        cursor: isDraggable ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
        zIndex: isDragging ? 30 : isSelectedSeat ? 20 : 10,
        boxShadow: isSelectedSeat
          ? `0 0 10px ${seatColor}80`
          : isEditable ? '0 2px 8px rgba(99, 102, 241, 0.3)'
          : `0 2px 6px ${seatColor}40`,
        transform: isDragging ? 'scale(1.2)' : undefined,
        touchAction: 'none',
      }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      exit={{ scale: 0 }}
      whileHover={isDraggable ? { scale: 1.15 } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (!isDragging) onSeatTap?.(displayNumber)
      }}
      title={
        isEditable
          ? isSelectedSeat
            ? `Seat ${displayLabel} - Arrow keys: 5px, Shift+Arrows: 20px, Del: remove`
            : `Seat ${displayLabel} - Click to select, drag to move`
          : `Seat ${displayLabel}`
      }
    >
      <span style={{ transform: `rotate(${-tableRotation}deg)`, pointerEvents: 'none' }}>
        {displayLabel}
      </span>
      {isEditable && isSelectedSeat && onSeatDelete && (
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          style={{
            position: 'absolute', top: -8, right: -8, width: 16, height: 16,
            borderRadius: '50%', background: '#ef4444', border: '2px solid #1e293b',
            color: 'white', fontSize: 10, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', padding: 0,
            transform: `rotate(${-tableRotation}deg)`,
          }}
          onClick={(e) => { e.stopPropagation(); onSeatDelete(seat.id) }}
          title="Delete seat"
        >
          ×
        </motion.button>
      )}
    </motion.div>
  )
}

export const TableNode = memo(function TableNode({
  table,
  isSelected,
  isDragging,
  isDropTarget,
  isColliding = false,
  showSeats = false,
  selectedSeat,
  flashMessage,
  isEditable = false,
  splitCount,
  orderStatusBadges,
  seatsWithItems,
  onTap,
  onDragStart,
  onDragEnd,
  onLongPress,
  onSeatTap,
  onSeatDrag,
  onSeatDelete,
}: TableNodeProps) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null)
  const dragStartedRef = useRef(false)
  const longPressFiredRef = useRef(false)
  const isLocked = table.isLocked
  const isBooth = table.shape === 'booth'

  // Calculate dynamic font sizes based on table dimensions
  const minDimension = Math.min(table.width, table.height)
  const isNarrow = table.width < 70 || table.height < 70
  const isSmall = minDimension < 80

  // Font sizes scale with table size
  const nameFontSize = isSmall ? Math.max(11, minDimension * 0.18) : Math.min(18, minDimension * 0.2)
  const infoFontSize = isSmall ? Math.max(9, minDimension * 0.12) : Math.min(12, minDimension * 0.14)

  // For very narrow tables, we might want to rotate the text 90°
  const shouldRotateText = table.width < 60 && table.height > table.width * 1.5

  // Use database seats instead of calculating positions
  // Each seat has relativeX/relativeY (relative to table center) stored in DB
  const databaseSeats = useMemo(() => {
    // Don't show seats if showSeats is false
    if (!showSeats) return []

    const seats = table.seats || []

    // Sort seats by seatNumber - this is the intended visual order around the table
    // The seatNumber was assigned sequentially when seats were created around the perimeter
    // (angle property indicates which edge, not sequential position)
    const sortedSeats = [...seats].sort((a, b) => a.seatNumber - b.seatNumber)


    // Convert relative positions (from table center) to positions relative to table's top-left
    return sortedSeats.map(seat => ({
      id: seat.id,
      seatNumber: seat.seatNumber,
      label: seat.label,
      // Position: table center offset + relative seat position
      x: table.width / 2 + seat.relativeX,
      y: table.height / 2 + seat.relativeY,
      angle: seat.angle,
      seatType: seat.seatType,
      isTemporary: seat.isTemporary ?? false,
    }))
  }, [showSeats, table.seats, table.width, table.height])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Locked tables cannot be dragged
    if (isLocked) {
      return
    }

    // Record initial pointer position for movement threshold check
    pointerStartPos.current = { x: e.clientX, y: e.clientY }
    dragStartedRef.current = false
    longPressFiredRef.current = false

    // Capture pointer so move/up events continue even if finger drifts off table
    ;(e.target as Element).setPointerCapture(e.pointerId)

    // POS view (non-editable): longer threshold for long-press
    // Editor view (editable): shorter threshold for drag workflows
    const longPressMs = isEditable ? 500 : 1200
    longPressTimer.current = setTimeout(() => {
      longPressFiredRef.current = true
      pointerStartPos.current = null // Prevent subsequent drag initiation
      onLongPress()
    }, longPressMs)

    // Drag tracking starts on pointer MOVE (after 8px threshold), not here
    // Editor mode: also start drag immediately for responsive feel
    if (isEditable) {
      onDragStart()
    }
  }, [onDragStart, onLongPress, isLocked, isEditable])

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    pointerStartPos.current = null
    const wasDragging = dragStartedRef.current
    // Don't clear dragStartedRef/longPressFiredRef immediately - onClick fires AFTER pointerUp
    // Clear them after a short delay so the onClick guard can check them
    setTimeout(() => {
      dragStartedRef.current = false
      longPressFiredRef.current = false
    }, 50)
    // Only call onDragEnd if THIS table was being dragged
    // This prevents clearing draggedTableId when releasing over a different table (drop target)
    if (isDragging || wasDragging) {
      onDragEnd()
    }
  }, [onDragEnd, isDragging, onTap])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (pointerStartPos.current) {
      const dx = e.clientX - pointerStartPos.current.x
      const dy = e.clientY - pointerStartPos.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      // Only cancel long-press and start drag if finger moves more than 8px from start
      // (touchscreens have natural finger drift during a press)
      if (distance > 8) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current)
          longPressTimer.current = null
        }
        // Start drag in POS view (non-editable)
        // Editor mode already started drag on pointer down
        if (!isEditable && !dragStartedRef.current) {
          dragStartedRef.current = true
          onDragStart()
        }
      }
    }
  }, [isEditable, onDragStart])

  const glowColor = statusGlowColors[table.status]
  const isReserved = table.status === 'reserved'

  // Calculate table dimensions based on shape
  const getShapeStyle = () => {
    switch (table.shape) {
      case 'circle':
      case 'round':
        return { borderRadius: '50%' }
      case 'oval':
        return { borderRadius: '50%' }
      case 'booth':
        return { borderRadius: '12px 12px 24px 24px' }
      case 'bar':
        return { borderRadius: '24px' }
      default:
        return { borderRadius: '12px' }
    }
  }

  return (
    <motion.div
      className={`table-node status-${table.status} ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''} ${isColliding ? 'colliding' : ''} ${isLocked ? 'locked' : ''}`}
      style={{
        left: table.posX,
        top: table.posY,
        width: table.width,
        height: table.height,
        zIndex: isDragging ? 100 : isSelected ? 50 : 1,
      }}
      initial={{ opacity: 0, scale: 0.9, rotate: 0 }}
      animate={{
        opacity: isColliding ? 0.7 : 1,
        scale: isDragging ? 1.05 : isSelected ? 1.02 : 1,
        rotate: table.rotation || 0,
      }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={(e) => {
        // Skip click if a drag or long-press just occurred (browser synthesizes click after pointerUp)
        if (dragStartedRef.current || longPressFiredRef.current) return
        e.stopPropagation()
        onTap()
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerUp}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div
        className="table-node-inner"
        style={{
          ...getShapeStyle(),
          width: '100%',
          height: '100%',
        }}
        animate={{
          boxShadow: isColliding
            ? [
                `inset 0 1px 1px rgba(255, 255, 255, 0.05)`,
                `0 4px 12px rgba(0, 0, 0, 0.3)`,
                `0 0 30px rgba(239, 68, 68, 0.8)`,
                `0 0 50px rgba(239, 68, 68, 0.5)`,
              ].join(', ')
            : [
                `inset 0 1px 1px rgba(255, 255, 255, 0.05)`,
                `0 4px 12px rgba(0, 0, 0, 0.3)`,
                `0 0 ${isSelected ? '30px' : '20px'} ${glowColor}`,
                `0 0 ${isSelected ? '50px' : '40px'} ${glowColor.replace(/[\d.]+\)$/, '0.3)')}`,
              ].join(', '),
          borderColor: isColliding
            ? '#ef4444'
            : isDropTarget
              ? '#22c55e'
              : isSelected
                ? '#6366f1'
                : 'rgba(255, 255, 255, 0.1)',
          borderWidth: isColliding || isDropTarget || isSelected ? '3px' : '1px',
          borderStyle: 'solid',
        }}
        transition={{ duration: 0.3 }}
      >
        {/* Animated glow pulse for reserved tables */}
        {isReserved && (
          <motion.div
            className="absolute inset-0 rounded-inherit"
            style={{ borderRadius: 'inherit' }}
            animate={{
              boxShadow: [
                `0 0 20px rgba(251, 191, 36, 0.3)`,
                `0 0 40px rgba(251, 191, 36, 0.5)`,
                `0 0 20px rgba(251, 191, 36, 0.3)`,
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Collision indicator - shows when dragging over fixture */}
        <AnimatePresence>
          {isColliding && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="bg-red-500 rounded-full p-2 shadow-lg"
                animate={{
                  scale: [1, 1.1, 1],
                }}
                transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
              >
                <svg width="24" height="24" fill="white" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                </svg>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table Content - Counter-rotate text so it stays readable */}
        <div
          className="table-node-content"
          style={{
            transform: `rotate(${-(table.rotation || 0)}deg)${shouldRotateText ? ' rotate(90deg)' : ''}`,
          }}
        >
          {/* Table name - show abbreviation if set, otherwise full name */}
          <div
            className="table-node-name"
            style={{
              fontSize: `${nameFontSize}px`,
              lineHeight: 1.2,
            }}
            title={table.name} // Full name on hover
          >
            {table.abbreviation || table.name}
          </div>

          {/* Order info or seat count */}
          {table.currentOrder ? (
            <>
              <div className="table-node-info" style={{ fontSize: `${infoFontSize}px` }}>
                #{table.currentOrder.orderNumber} · {table.currentOrder.guestCount} guests
              </div>
              <div className="table-node-total" style={{ fontSize: `${infoFontSize + 2}px` }}>
                ${table.currentOrder.total.toFixed(2)}
              </div>
              {/* Order status badges (delay, held, coursed) */}
              {orderStatusBadges && (orderStatusBadges.hasDelay || orderStatusBadges.hasHeld || orderStatusBadges.hasCourses) && (
                <div style={{
                  display: 'flex',
                  gap: '3px',
                  marginTop: '2px',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}>
                  {orderStatusBadges.hasDelay && (
                    <span style={{
                      fontSize: '8px',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      background: 'rgba(251, 191, 36, 0.3)',
                      color: '#fbbf24',
                      fontWeight: 700,
                      lineHeight: 1.3,
                    }}>
                      ⏱{orderStatusBadges.delayMinutes ? `${orderStatusBadges.delayMinutes}m` : ''}
                    </span>
                  )}
                  {orderStatusBadges.hasHeld && (
                    <span style={{
                      fontSize: '8px',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      background: 'rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      fontWeight: 700,
                      lineHeight: 1.3,
                    }}>
                      ⏸HLD
                    </span>
                  )}
                  {orderStatusBadges.hasCourses && (
                    <span style={{
                      fontSize: '8px',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      background: 'rgba(59, 130, 246, 0.3)',
                      color: '#60a5fa',
                      fontWeight: 700,
                      lineHeight: 1.3,
                    }}>
                      CRS
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="table-node-info" style={{ fontSize: `${infoFontSize}px` }}>
              {`${table.seats?.length || table.capacity} seat${(table.seats?.length || table.capacity) !== 1 ? 's' : ''}`}
            </div>
          )}
        </div>

        {/* Lock icon for locked tables */}
        {isLocked && (
          <div className="locked-badge" title="This table is locked and cannot be moved">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}

      </motion.div>

      {/* Split ticket badge */}
      {splitCount != null && splitCount > 0 && (
        <div style={{
          position: 'absolute',
          top: -6,
          right: -6,
          background: '#8b5cf6',
          color: 'white',
          borderRadius: '10px',
          padding: '1px 6px',
          fontSize: '9px',
          fontWeight: 700,
          border: '2px solid #1e293b',
          zIndex: 15,
          lineHeight: '1.4',
          whiteSpace: 'nowrap',
        }}>
          {splitCount} {splitCount === 1 ? 'split' : 'splits'}
        </div>
      )}

      {/* Seat indicators from database (permanently assigned to this table) */}
      {showSeats && databaseSeats.length > 0 && (
        <>
          {databaseSeats.map((seat, index) => {
            const displayNumber = seat.seatNumber
            const isSelectedSeat = selectedSeat?.tableId === table.id && selectedSeat?.seatNumber === seat.seatNumber
            const hasItems = seatsWithItems?.has(seat.seatNumber) ?? false
            const seatColor = getSeatColor(seat.seatNumber, hasItems)
            const isDraggable = isEditable || seat.isTemporary
            const displayLabel = seat.label

            return (
              <DraggableSeat
                key={`seat-${seat.id}`}
                seat={seat}
                tableWidth={table.width}
                tableHeight={table.height}
                tableRotation={table.rotation || 0}
                isDraggable={isDraggable}
                isSelectedSeat={isSelectedSeat}
                isBooth={isBooth}
                isEditable={isEditable || false}
                seatColor={seatColor}
                displayLabel={displayLabel}
                displayNumber={displayNumber}
                maxDistance={Math.max(table.width, table.height) / 2 + 30}
                onSeatDrag={onSeatDrag}
                onSeatTap={onSeatTap}
                onSeatDelete={onSeatDelete}
              />
            )
          })}
        </>
      )}

      {/* Flash message overlay (e.g., "OPEN ORDER") */}
      <AnimatePresence>
        {flashMessage && (
          <motion.div
            className="flash-message-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(239, 68, 68, 0.9)',
              borderRadius: 'inherit',
              zIndex: 100,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [1, 0.7, 1, 0.7, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, times: [0, 0.25, 0.5, 0.75, 1] }}
          >
            <span style={{ color: 'white', fontWeight: 700, fontSize: 12, textTransform: 'uppercase' }}>
              {flashMessage}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})


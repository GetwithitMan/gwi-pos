'use client'

import { useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable, TableStatus } from './use-floor-plan'
import { calculateSeatPositions, type SeatPosition } from './table-positioning'

interface TableNodeProps {
  table: FloorPlanTable
  isSelected: boolean
  isDragging: boolean
  isDropTarget: boolean
  combinedGroupColor?: string  // Color shared by all tables in a combined group
  showSeats?: boolean  // Whether to display seat indicators
  selectedSeat?: { tableId: string; seatNumber: number } | null
  flashMessage?: string | null  // Flash message to display (e.g., "OPEN ORDER")
  onTap: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onLongPress: () => void
  onSeatTap?: (seatNumber: number) => void
}

// Colors for combined table groups (consistent matching)
const COMBINED_GROUP_COLORS = [
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#eab308', // yellow
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f43f5e', // rose
]

// Generate consistent color from table ID hash
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

export function getCombinedGroupColor(primaryTableId: string): string {
  const colorIndex = hashCode(primaryTableId) % COMBINED_GROUP_COLORS.length
  return COMBINED_GROUP_COLORS[colorIndex]
}

// Status to glow color mapping
const statusGlowColors: Record<TableStatus, string> = {
  available: 'rgba(255, 255, 255, 0.1)',
  occupied: 'rgba(99, 102, 241, 0.6)',
  reserved: 'rgba(251, 191, 36, 0.6)',
  dirty: 'rgba(245, 158, 11, 0.6)',
  in_use: 'rgba(139, 92, 246, 0.6)',
}

export function TableNode({
  table,
  isSelected,
  isDragging,
  isDropTarget,
  combinedGroupColor,
  showSeats = false,
  selectedSeat,
  flashMessage,
  onTap,
  onDragStart,
  onDragEnd,
  onLongPress,
  onSeatTap,
}: TableNodeProps) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isCombined = Boolean(table.combinedTableIds && table.combinedTableIds.length > 0)
  const isPartOfCombinedGroup = Boolean(table.combinedWithId) // This table is combined INTO another
  const isLocked = table.isLocked
  const isBooth = table.shape === 'booth'

  // Calculate seat positions when showSeats is enabled
  // For tables that are part of a combined group, don't show individual seats
  // (the primary table will show all seats)
  const seatPositions = useMemo<SeatPosition[]>(() => {
    if (!showSeats || isPartOfCombinedGroup) return []

    return calculateSeatPositions(
      {
        posX: 0, // Relative to table
        posY: 0,
        width: table.width,
        height: table.height,
        shape: table.shape,
      },
      table.capacity,
      isBooth
    )
  }, [showSeats, isPartOfCombinedGroup, table.width, table.height, table.shape, table.capacity, isBooth])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    console.log('[DRAG] pointerDown on table:', table.id, { isLocked, target: e.target })

    // Locked tables cannot be dragged
    if (isLocked) {
      console.log('[DRAG] Table is locked, skipping drag')
      return
    }

    longPressTimer.current = setTimeout(() => {
      onLongPress()
    }, 500)
    onDragStart()
    console.log('[DRAG] Started drag for table:', table.id)
  }, [onDragStart, onLongPress, isLocked, table.id])

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    onDragEnd()
  }, [onDragEnd])

  const handlePointerMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Use combined group color for glow if table is part of a combined group
  const hasCombinedColor = combinedGroupColor && (isCombined || isPartOfCombinedGroup)
  const glowColor = hasCombinedColor
    ? `${combinedGroupColor}99` // Add alpha for glow effect
    : statusGlowColors[table.status]
  const isReserved = table.status === 'reserved'

  // Calculate table dimensions based on shape
  const getShapeStyle = () => {
    switch (table.shape) {
      case 'circle':
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
      className={`table-node status-${table.status} ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''} ${isCombined ? 'combined' : ''} ${isLocked ? 'locked' : ''}`}
      style={{
        left: table.posX,
        top: table.posY,
        width: table.width,
        height: table.height,
        transform: `rotate(${table.rotation}deg)`,
        zIndex: isDragging ? 100 : isSelected ? 50 : 1,
      }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: isDragging ? 1.05 : isSelected ? 1.02 : 1,
      }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={onTap}
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
          boxShadow: [
            `inset 0 1px 1px rgba(255, 255, 255, 0.05)`,
            `0 4px 12px rgba(0, 0, 0, 0.3)`,
            `0 0 ${isSelected ? '30px' : '20px'} ${glowColor}`,
            `0 0 ${isSelected ? '50px' : '40px'} ${hasCombinedColor ? `${combinedGroupColor}4D` : glowColor.replace(/[\d.]+\)$/, '0.3)')}`,
          ].join(', '),
          borderColor: isDropTarget
            ? '#22c55e'
            : hasCombinedColor
              ? combinedGroupColor
              : isSelected
                ? '#6366f1'
                : 'rgba(255, 255, 255, 0.1)',
          borderWidth: isDropTarget || isSelected || hasCombinedColor ? '2px' : '1px',
          borderStyle: isDropTarget || isCombined || isPartOfCombinedGroup ? 'dashed' : 'solid',
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

        <div className="table-node-content">
          {/* Table name */}
          <div className="table-node-name">{table.name}</div>

          {/* Order info or capacity */}
          {table.currentOrder ? (
            <>
              <div className="table-node-info">
                #{table.currentOrder.orderNumber} · {table.currentOrder.guestCount} guests
              </div>
              <div className="table-node-total">
                ${table.currentOrder.total.toFixed(2)}
              </div>
            </>
          ) : (
            <div className="table-node-info">{table.capacity} seats</div>
          )}

          {/* Seat indicators */}
          {table.seats && table.seats.length > 0 && table.seats.length <= 8 && (
            <div className="seat-indicators">
              {table.seats.map((seat) => (
                <div
                  key={seat.id}
                  className={`seat-dot ${table.status === 'occupied' ? 'occupied' : ''}`}
                  title={`Seat ${seat.label}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Combined badge - shows on primary table that has others combined to it */}
        <AnimatePresence>
          {isCombined && (
            <motion.div
              className="combined-badge"
              style={combinedGroupColor ? { backgroundColor: combinedGroupColor } : undefined}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            >
              +{table.combinedTableIds?.length}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Combined indicator - shows on tables that are combined INTO a primary */}
        <AnimatePresence>
          {isPartOfCombinedGroup && !isCombined && (
            <motion.div
              className="combined-child-badge"
              style={combinedGroupColor ? { backgroundColor: combinedGroupColor } : undefined}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            >
              ↔
            </motion.div>
          )}
        </AnimatePresence>

        {/* Lock icon for locked tables */}
        {isLocked && (
          <div className="locked-badge" title="This table is locked and cannot be moved">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </motion.div>

      {/* Drop target indicator */}
      <AnimatePresence>
        {isDropTarget && (
          <motion.div
            className="absolute inset-[-8px] border-2 border-dashed border-green-500 rounded-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      {/* Seat indicators (positioned around or inside the table) */}
      {showSeats && seatPositions.length > 0 && (
        <>
          {seatPositions.map((seat) => {
            const isSelectedSeat = selectedSeat?.tableId === table.id && selectedSeat?.seatNumber === seat.seatNumber
            const seatColor = combinedGroupColor || '#6366f1'

            return (
              <motion.div
                key={`seat-${seat.seatNumber}`}
                className={`seat-indicator ${isSelectedSeat ? 'selected' : ''} ${isBooth ? 'booth-seat' : ''}`}
                style={{
                  position: 'absolute',
                  left: seat.x - 12, // Center the 24px dot
                  top: seat.y - 12,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  backgroundColor: isSelectedSeat ? seatColor : 'rgba(255, 255, 255, 0.15)',
                  border: `2px solid ${isSelectedSeat ? seatColor : 'rgba(255, 255, 255, 0.3)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 600,
                  color: isSelectedSeat ? 'white' : 'rgba(255, 255, 255, 0.7)',
                  cursor: 'pointer',
                  zIndex: 10,
                  boxShadow: isSelectedSeat
                    ? `0 0 10px ${seatColor}80`
                    : '0 2px 4px rgba(0, 0, 0, 0.3)',
                  transform: isBooth ? 'none' : `rotate(${seat.angle}deg)`,
                }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => {
                  e.stopPropagation()
                  onSeatTap?.(seat.seatNumber)
                }}
                title={`Seat ${seat.seatNumber}`}
              >
                <span style={{ transform: isBooth ? 'none' : `rotate(-${seat.angle}deg)` }}>
                  {seat.seatNumber}
                </span>
              </motion.div>
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
}

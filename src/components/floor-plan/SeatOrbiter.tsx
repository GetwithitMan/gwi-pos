'use client'

import { useCallback, useMemo } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { PlusIcon } from '@heroicons/react/24/outline'
import {
  SeatInfo,
  SEAT_STATUS_COLORS,
  SEAT_STATUS_BG_COLORS,
  SEAT_STATUS_GLOW,
  calculateSeatPositions,
  formatSeatBalance,
} from '@/lib/seat-utils'

interface SeatOrbiterProps {
  seats: SeatInfo[]
  selectedSeatNumber: number | null
  onSeatSelect: (seatNumber: number) => void
  onAddSeat?: (afterPosition: number) => void
  onRemoveSeat?: (position: number) => void
  showAddButton?: boolean
  showBalances?: boolean
  size?: 'sm' | 'md' | 'lg'
  orbitRadius?: number
  disabled?: boolean
}

const SIZE_CONFIG = {
  sm: { seatSize: 28, fontSize: 10, balanceFontSize: 8, addButtonSize: 20 },
  md: { seatSize: 36, fontSize: 12, balanceFontSize: 10, addButtonSize: 24 },
  lg: { seatSize: 44, fontSize: 14, balanceFontSize: 11, addButtonSize: 28 },
}

export function SeatOrbiter({
  seats,
  selectedSeatNumber,
  onSeatSelect,
  onAddSeat,
  showAddButton = true,
  showBalances = true,
  size = 'md',
  orbitRadius = 60,
  disabled = false,
}: SeatOrbiterProps) {
  const config = SIZE_CONFIG[size]

  // Calculate positions for all seats plus the add button
  const totalSlots = showAddButton ? seats.length + 1 : seats.length
  const positions = useMemo(
    () => calculateSeatPositions(totalSlots, orbitRadius),
    [totalSlots, orbitRadius]
  )

  const handleSeatClick = useCallback((seatNumber: number) => {
    if (!disabled) {
      onSeatSelect(seatNumber)
    }
  }, [disabled, onSeatSelect])

  const handleAddClick = useCallback(() => {
    if (!disabled && onAddSeat) {
      // Add seat at the end
      onAddSeat(seats.length + 1)
    }
  }, [disabled, onAddSeat, seats.length])

  return (
    <LayoutGroup>
      <div
        className="relative"
        style={{
          width: orbitRadius * 2 + config.seatSize,
          height: orbitRadius * 2 + config.seatSize,
        }}
      >
        <AnimatePresence mode="popLayout">
          {seats.map((seat, index) => {
            const pos = positions[index]
            const isSelected = selectedSeatNumber === seat.seatNumber
            const statusColor = SEAT_STATUS_COLORS[seat.status]
            const bgColor = SEAT_STATUS_BG_COLORS[seat.status]
            const glowColor = SEAT_STATUS_GLOW[seat.status]

            return (
              <motion.button
                key={`seat-${seat.seatNumber}`}
                layoutId={`seat-${seat.seatNumber}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  x: pos.x + orbitRadius,
                  y: pos.y + orbitRadius,
                }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 25,
                  layout: { duration: 0.3 },
                }}
                onClick={() => handleSeatClick(seat.seatNumber)}
                disabled={disabled}
                className="absolute flex flex-col items-center justify-center rounded-full transition-shadow"
                style={{
                  width: config.seatSize,
                  height: config.seatSize,
                  marginLeft: -config.seatSize / 2,
                  marginTop: -config.seatSize / 2,
                  backgroundColor: bgColor,
                  border: `2px solid ${statusColor}`,
                  boxShadow: isSelected
                    ? `0 0 12px ${glowColor}, 0 0 20px ${glowColor}`
                    : `0 2px 4px rgba(0, 0, 0, 0.2)`,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  zIndex: isSelected ? 20 : 10,
                }}
                title={`Seat ${seat.seatNumber} - ${seat.status}${seat.total > 0 ? ` - $${seat.total.toFixed(2)}` : ''}`}
              >
                {/* Seat number */}
                <span
                  className="font-bold leading-none"
                  style={{
                    fontSize: config.fontSize,
                    color: statusColor,
                  }}
                >
                  {seat.seatNumber}
                </span>

                {/* Balance (if showBalances and has balance) */}
                {showBalances && seat.total > 0 && (
                  <span
                    className="leading-none mt-0.5 opacity-80"
                    style={{
                      fontSize: config.balanceFontSize,
                      color: statusColor,
                    }}
                  >
                    {formatSeatBalance(seat.total)}
                  </span>
                )}

                {/* Item count indicator */}
                {seat.itemCount > 0 && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 flex items-center justify-center rounded-full"
                    style={{
                      width: 14,
                      height: 14,
                      backgroundColor: statusColor,
                      fontSize: 9,
                      fontWeight: 600,
                      color: '#fff',
                    }}
                  >
                    {seat.itemCount}
                  </motion.div>
                )}

                {/* Selected ring */}
                {isSelected && (
                  <motion.div
                    layoutId="selected-ring"
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{
                      border: '3px solid #6366f1',
                      boxShadow: '0 0 8px rgba(99, 102, 241, 0.6)',
                    }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  />
                )}
              </motion.button>
            )
          })}

          {/* Add Seat Button */}
          {showAddButton && onAddSeat && (
            <motion.button
              key="add-seat"
              layoutId="add-seat"
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                x: positions[seats.length]?.x + orbitRadius || orbitRadius,
                y: positions[seats.length]?.y + orbitRadius || orbitRadius,
              }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 25,
                layout: { duration: 0.3 },
              }}
              onClick={handleAddClick}
              disabled={disabled}
              className="absolute flex items-center justify-center rounded-full border-2 border-dashed border-slate-500 bg-slate-800/50 hover:bg-slate-700/50 hover:border-emerald-500 transition-all"
              style={{
                width: config.addButtonSize,
                height: config.addButtonSize,
                marginLeft: -config.addButtonSize / 2,
                marginTop: -config.addButtonSize / 2,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
              title="Add a seat"
            >
              <PlusIcon
                className="text-slate-400 hover:text-emerald-400 transition-colors"
                style={{ width: config.addButtonSize * 0.6, height: config.addButtonSize * 0.6 }}
              />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  )
}

/**
 * Compact inline seat bar for use in order panels
 */
interface SeatBarProps {
  seats: SeatInfo[]
  selectedSeatNumber: number | null
  onSeatSelect: (seatNumber: number) => void
  onAddSeat?: () => void
  disabled?: boolean
}

export function SeatBar({
  seats,
  selectedSeatNumber,
  onSeatSelect,
  onAddSeat,
  disabled = false,
}: SeatBarProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <AnimatePresence mode="popLayout">
        {seats.map((seat) => {
          const isSelected = selectedSeatNumber === seat.seatNumber
          const statusColor = SEAT_STATUS_COLORS[seat.status]
          const bgColor = SEAT_STATUS_BG_COLORS[seat.status]

          return (
            <motion.button
              key={`bar-seat-${seat.seatNumber}`}
              layoutId={`bar-seat-${seat.seatNumber}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 25,
              }}
              onClick={() => !disabled && onSeatSelect(seat.seatNumber)}
              disabled={disabled}
              className="relative flex items-center justify-center rounded-lg transition-all"
              style={{
                minWidth: 32,
                height: 28,
                padding: '0 8px',
                backgroundColor: bgColor,
                border: `2px solid ${isSelected ? '#6366f1' : statusColor}`,
                boxShadow: isSelected
                  ? '0 0 8px rgba(99, 102, 241, 0.5)'
                  : 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <span
                className="font-bold text-xs"
                style={{ color: isSelected ? '#6366f1' : statusColor }}
              >
                S{seat.seatNumber}
              </span>

              {/* Item count badge */}
              {seat.itemCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-white text-[9px] font-bold"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: statusColor,
                  }}
                >
                  {seat.itemCount}
                </span>
              )}
            </motion.button>
          )
        })}

        {/* Add button */}
        {onAddSeat && (
          <motion.button
            key="bar-add-seat"
            layoutId="bar-add-seat"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => !disabled && onAddSeat()}
            disabled={disabled}
            className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-600 hover:border-emerald-500 hover:bg-emerald-500/10 transition-all"
            style={{
              width: 28,
              height: 28,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
            title="Add a seat"
          >
            <PlusIcon className="w-4 h-4 text-slate-500 hover:text-emerald-400" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Seat status legend
 */
export function SeatStatusLegend() {
  const statuses: { status: keyof typeof SEAT_STATUS_COLORS; label: string }[] = [
    { status: 'empty', label: 'Empty' },
    { status: 'active', label: 'Active' },
    { status: 'stale', label: 'Stale' },
    { status: 'printed', label: 'Printed' },
    { status: 'paid', label: 'Paid' },
  ]

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {statuses.map(({ status, label }) => (
        <div key={status} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: SEAT_STATUS_COLORS[status] }}
          />
          <span className="text-slate-400">{label}</span>
        </div>
      ))}
    </div>
  )
}

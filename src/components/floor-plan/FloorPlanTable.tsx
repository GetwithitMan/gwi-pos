'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable as TableType, FloorPlanSeat } from './use-floor-plan'
import { SeatInfo, determineSeatStatus, SEAT_STATUS_COLORS } from '@/lib/seat-utils'
import { type TableRect, type Point } from '@/lib/table-geometry'

interface FloorPlanTableProps {
  table: TableType
  mode: 'admin' | 'service'
  isSelected: boolean
  isDragging?: boolean
  isDropTarget?: boolean
  showSeats?: boolean
  selectedSeatNumber?: number | null
  tableRotation?: number
  onSeatTap?: (seatNumber: number) => void
  onSeatRemove?: (seatIndex: number) => void
  onSeatSelect?: (seatIndex: number | null) => void
  onSeatPositionChange?: (seatIndex: number, relativeX: number, relativeY: number) => void
  flashMessage?: string | null
}

/**
 * FloorPlanTable - Renders the table surface and orbital seats with auto-spacing
 *
 * This component handles:
 * - Table shape rendering (circle, square, rectangle, booth, bar)
 * - Visual states (selected, dragging, drop target)
 * - Automatic orbital seat spacing with layout animations
 * - Counter-rotation for upright seat labels
 * - Interactive seat rendering with status colors in service mode
 */
export function FloorPlanTable({
  table,
  mode,
  isSelected,
  isDragging = false,
  isDropTarget = false,
  showSeats = false,
  selectedSeatNumber,
  tableRotation = 0,
  onSeatTap,
  onSeatRemove,
  onSeatSelect,
  onSeatPositionChange,
  flashMessage,
}: FloorPlanTableProps) {
  const isRound = table.shape === 'circle'
  const isBooth = table.shape === 'booth'
  const isBar = table.shape === 'bar'

  // Calculate border radius based on shape
  const getBorderRadius = () => {
    if (isRound) return '50%'
    if (isBooth) return '16px 16px 4px 4px'
    if (isBar) return '8px'
    return '12px'
  }

  // Get status-based styling
  const getStatusStyles = () => {
    const status = table.status || 'available'
    switch (status) {
      case 'occupied':
        return {
          borderColor: 'rgba(34, 197, 94, 0.6)',
          background: 'rgba(34, 197, 94, 0.15)',
        }
      case 'reserved':
        return {
          borderColor: 'rgba(234, 179, 8, 0.6)',
          background: 'rgba(234, 179, 8, 0.15)',
        }
      case 'dirty':
        return {
          borderColor: 'rgba(239, 68, 68, 0.6)',
          background: 'rgba(239, 68, 68, 0.15)',
        }
      default:
        return {
          borderColor: 'rgba(100, 116, 139, 0.4)',
          background: 'rgba(15, 23, 42, 0.8)',
        }
    }
  }

  const statusStyles = getStatusStyles()

  // Build seat info from table seats for orbital display
  const seatInfoList: SeatInfo[] = (table.seats || []).map((seat: FloorPlanSeat) => {
    const orderItems = table.currentOrder?.items || []
    const seatItems = orderItems.filter((item: any) => item.seatNumber === seat.seatNumber)
    const subtotal = seatItems.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0)
    const taxAmount = subtotal * 0.0825
    const seatTotal = subtotal + taxAmount

    return {
      seatNumber: seat.seatNumber,
      status: mode === 'admin' ? 'empty' : determineSeatStatus(seatItems, seat.seatNumber),
      subtotal,
      taxAmount,
      total: seatTotal,
      itemCount: seatItems.length,
    }
  })

  return (
    <div className="relative w-full h-full group">
      {/* 1. The Table Surface */}
      <motion.div
        className="w-full h-full flex items-center justify-center transition-all"
        style={{
          borderRadius: getBorderRadius(),
          border: `2px solid ${
            isDropTarget
              ? 'rgba(99, 102, 241, 0.8)'
              : isSelected
                ? 'rgba(99, 102, 241, 0.6)'
                : statusStyles.borderColor
          }`,
          background: isDropTarget
            ? 'rgba(99, 102, 241, 0.2)'
            : isSelected
              ? 'rgba(99, 102, 241, 0.15)'
              : statusStyles.background,
          boxShadow: isDragging
            ? '0 20px 40px rgba(0, 0, 0, 0.4), 0 0 20px rgba(99, 102, 241, 0.3)'
            : isSelected
              ? '0 8px 24px rgba(0, 0, 0, 0.3), 0 0 12px rgba(99, 102, 241, 0.2)'
              : '0 4px 12px rgba(0, 0, 0, 0.2)',
          transform: isDragging ? 'scale(1.05)' : 'scale(1)',
        }}
        animate={{
          scale: isDragging ? 1.05 : 1,
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {/* Table Label */}
        <div className="flex flex-col items-center justify-center">
          <span className="text-[11px] font-black text-slate-300 select-none uppercase tracking-tighter">
            {table.abbreviation || table.name}
          </span>

          {/* Capacity indicator */}
          {mode === 'service' && table.currentOrder && (
            <span className="text-[9px] text-emerald-400 mt-0.5">
              {table.currentOrder.guestCount}/{table.capacity}
            </span>
          )}
        </div>

        {/* Flash Message Overlay */}
        {flashMessage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-amber-500/90 rounded-inherit"
            style={{ borderRadius: getBorderRadius() }}
          >
            <span className="text-[10px] font-bold text-white uppercase tracking-wider">{flashMessage}</span>
          </motion.div>
        )}
      </motion.div>

      {/* 2. Orbital Seat Rendering with Auto-Spacing */}
      {showSeats && (
        <OrbitalSeats
          seats={table.seats || []}
          seatInfo={seatInfoList}
          tableWidth={table.width}
          tableHeight={table.height}
          tablePosX={table.posX}
          tablePosY={table.posY}
          tableRotation={tableRotation}
          mode={mode}
          selectedSeatNumber={selectedSeatNumber}
          onSeatTap={onSeatTap}
          onSeatRemove={onSeatRemove}
          onSeatSelect={onSeatSelect}
          onSeatPositionChange={onSeatPositionChange}
        />
      )}

      {/* 3. Drag Handle Decoration (Admin only) */}
      {mode === 'admin' && (
        <div className="absolute -top-2 -right-2 w-4 h-4 bg-indigo-600 rounded-full border-2 border-white scale-0 group-hover:scale-100 transition-transform flex items-center justify-center shadow-lg">
          <div className="w-1.5 h-1.5 bg-white rounded-full" />
        </div>
      )}

    </div>
  )
}

/**
 * OrbitalSeats - Renders seats with automatic orbital spacing and layout animations
 *
 * Features:
 * - Auto-spacing: Seats automatically redistribute when one is removed
 * - Layout animations: Framer Motion's layout prop makes seats slide smoothly
 * - Counter-rotation: Seat numbers stay upright regardless of table rotation
 * - Drag support: In admin mode, seats can be manually positioned
 */
interface OrbitalSeatsProps {
  seats: FloorPlanSeat[]
  seatInfo: SeatInfo[]
  tableWidth: number
  tableHeight: number
  tablePosX: number
  tablePosY: number
  tableRotation: number
  mode: 'admin' | 'service'
  selectedSeatNumber?: number | null
  onSeatTap?: (seatNumber: number) => void
  onSeatRemove?: (seatIndex: number) => void
  onSeatSelect?: (seatIndex: number | null) => void
  onSeatPositionChange?: (seatIndex: number, relativeX: number, relativeY: number) => void
}

function OrbitalSeats({
  seats,
  seatInfo,
  tableWidth,
  tableHeight,
  tablePosX,
  tablePosY,
  tableRotation,
  mode,
  selectedSeatNumber,
  onSeatTap,
  onSeatRemove,
  onSeatSelect,
  onSeatPositionChange,
}: OrbitalSeatsProps) {
  const isAdmin = mode === 'admin'
  const [localSelectedIndex, setLocalSelectedIndex] = useState<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Current capacity for auto-spacing calculations
  const currentCapacity = seats.length

  // Dynamic seat sizing based on count (shrink if >8 seats to prevent overflow)
  const seatSize = currentCapacity > 12 ? 16 : currentCapacity > 8 ? 20 : 24
  const seatFontSize = currentCapacity > 12 ? 8 : currentCapacity > 8 ? 9 : 10

  // Orbital geometry
  const centerX = tableWidth / 2
  const centerY = tableHeight / 2
  const orbitRadius = Math.max(tableWidth, tableHeight) / 2 + 20

  // Calculate auto-spaced orbital position for a seat
  const getAutoSpacedPosition = useCallback(
    (index: number, total: number) => {
      // Evenly distribute seats around the orbit
      // Start from top (-90°) and go clockwise
      const angle = (index * 2 * Math.PI) / total - Math.PI / 2
      return {
        x: centerX + Math.cos(angle) * orbitRadius,
        y: centerY + Math.sin(angle) * orbitRadius,
      }
    },
    [centerX, centerY, orbitRadius]
  )

  // Orbit constraints for manual positioning
  const minOrbitRadius = Math.max(tableWidth, tableHeight) / 2 + 12
  const maxOrbitRadius = Math.max(tableWidth, tableHeight) / 2 + 50

  // Constrain position to orbit range (for manual drag)
  const constrainToOrbit = useCallback(
    (x: number, y: number) => {
      const dx = x - centerX
      const dy = y - centerY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const angle = Math.atan2(dy, dx)

      const clampedDistance = Math.max(minOrbitRadius, Math.min(maxOrbitRadius, distance))

      return {
        x: centerX + Math.cos(angle) * clampedDistance,
        y: centerY + Math.sin(angle) * clampedDistance,
      }
    },
    [centerX, centerY, minOrbitRadius, maxOrbitRadius]
  )

  // Convert screen coordinates to local (unrotated) coordinates
  const screenToLocal = useCallback(
    (screenX: number, screenY: number) => {
      const radians = -(tableRotation || 0) * (Math.PI / 180)
      const relX = screenX - centerX
      const relY = screenY - centerY
      const localX = relX * Math.cos(radians) - relY * Math.sin(radians)
      const localY = relX * Math.sin(radians) + relY * Math.cos(radians)
      return {
        x: localX + centerX,
        y: localY + centerY,
      }
    },
    [tableRotation, centerX, centerY]
  )

  // Handle keyboard navigation for fine-tuning
  useEffect(() => {
    if (!isAdmin || localSelectedIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 3
      const seat = seats[localSelectedIndex]
      if (!seat) return

      // Get current position in ABSOLUTE coordinates (for constraint calculations)
      const hasCustomPosition = seat.relativeX !== 0 || seat.relativeY !== 0
      const autoPos = getAutoSpacedPosition(localSelectedIndex, currentCapacity)
      // Convert relative to absolute, or use auto position
      const currentAbsX = hasCustomPosition ? (centerX + seat.relativeX) : autoPos.x
      const currentAbsY = hasCustomPosition ? (centerY + seat.relativeY) : autoPos.y

      let newAbsX = currentAbsX
      let newAbsY = currentAbsY

      switch (e.key) {
        case 'ArrowUp':
          newAbsY = currentAbsY - step
          e.preventDefault()
          break
        case 'ArrowDown':
          newAbsY = currentAbsY + step
          e.preventDefault()
          break
        case 'ArrowLeft':
          newAbsX = currentAbsX - step
          e.preventDefault()
          break
        case 'ArrowRight':
          newAbsX = currentAbsX + step
          e.preventDefault()
          break
        case 'Delete':
        case 'Backspace':
          if (onSeatRemove && seats.length > 1) {
            onSeatRemove(localSelectedIndex)
            setLocalSelectedIndex(null)
          }
          e.preventDefault()
          return
        case 'Escape':
          setLocalSelectedIndex(null)
          onSeatSelect?.(null)
          e.preventDefault()
          return
        default:
          return
      }

      // Constrain to orbit (works with absolute coords), then convert to relative
      const constrained = constrainToOrbit(newAbsX, newAbsY)
      const relativeX = constrained.x - centerX
      const relativeY = constrained.y - centerY
      onSeatPositionChange?.(localSelectedIndex, relativeX, relativeY)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isAdmin,
    localSelectedIndex,
    seats,
    currentCapacity,
    centerX,
    centerY,
    getAutoSpacedPosition,
    constrainToOrbit,
    onSeatPositionChange,
    onSeatRemove,
    onSeatSelect,
  ])

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {seats.map((seat, index) => {
          const seatNumber = seat.seatNumber

          // Seat positioning logic:
          // 1. Tables with custom position: use database position
          // 2. Tables without custom position: use orbital auto-spacing
          const hasCustomPosition = seat.relativeX !== 0 || seat.relativeY !== 0
          const useDbPosition = hasCustomPosition
          const autoPos = getAutoSpacedPosition(index, currentCapacity)
          const x = useDbPosition ? (centerX + seat.relativeX) : autoPos.x
          const y = useDbPosition ? (centerY + seat.relativeY) : autoPos.y

          const info = seatInfo[index]
          const isSelected = localSelectedIndex === index || selectedSeatNumber === seatNumber
          const statusColor = isAdmin ? '#64748b' : SEAT_STATUS_COLORS[info?.status || 'empty']
          const bgColor = isAdmin ? 'rgba(100, 116, 139, 0.2)' : `${statusColor}20`

          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation()
            if (isAdmin) {
              setLocalSelectedIndex(index)
              onSeatSelect?.(index)
            } else if (onSeatTap) {
              onSeatTap(seatNumber)
            }
          }

          const handlePointerDown = (e: React.PointerEvent) => {
            if (!isAdmin) return
            e.stopPropagation()
            setDraggedIndex(index)
            setLocalSelectedIndex(index)
            onSeatSelect?.(index)
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          }

          const handlePointerMove = (e: React.PointerEvent) => {
            if (!isAdmin || draggedIndex !== index) return
            e.stopPropagation()

            const container = containerRef.current
            if (!container) return

            const rect = container.getBoundingClientRect()
            const screenX = e.clientX - rect.left
            const screenY = e.clientY - rect.top
            const local = screenToLocal(screenX, screenY)
            const constrained = constrainToOrbit(local.x, local.y)
            // Convert absolute position to relative (for storage)
            const relativeX = constrained.x - centerX
            const relativeY = constrained.y - centerY
            onSeatPositionChange?.(index, relativeX, relativeY)
          }

          const handlePointerUp = (e: React.PointerEvent) => {
            if (draggedIndex === index) {
              setDraggedIndex(null)
              ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
            }
          }

          return (
            <motion.div
              key={`seat-${seat.id || seatNumber}`}
              layout // 🔄 Enables smooth sliding to new positions on re-spacing
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: draggedIndex === index ? 1.2 : 1,
                opacity: 1,
                left: x - 12,
                top: y - 12,
              }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                layout: { type: 'spring', stiffness: 400, damping: 30 },
                scale: { type: 'spring', stiffness: 400, damping: 25 },
                opacity: { duration: 0.2 },
              }}
              onClick={handleClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`absolute flex items-center justify-center rounded-full pointer-events-auto ${
                isAdmin
                  ? isSelected
                    ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900'
                    : 'hover:ring-2 hover:ring-indigo-400/50'
                  : ''
              }`}
              style={{
                width: seatSize,
                height: seatSize,
                backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.3)' : bgColor,
                border: `2px solid ${isSelected ? '#6366f1' : statusColor}`,
                boxShadow: isSelected
                  ? '0 0 12px rgba(99, 102, 241, 0.6)'
                  : draggedIndex === index
                    ? '0 4px 12px rgba(0, 0, 0, 0.4)'
                    : '0 2px 4px rgba(0, 0, 0, 0.3)',
                cursor: isAdmin ? (draggedIndex === index ? 'grabbing' : 'grab') : onSeatTap ? 'pointer' : 'default',
                zIndex: isSelected ? 30 : draggedIndex === index ? 50 : 10,
                touchAction: 'none',
                transition: 'width 0.2s, height 0.2s', // Smooth size transition when seats change
              }}
              title={isAdmin ? 'Drag to position • Arrow keys to fine-tune • Delete to remove' : undefined}
            >
              {/* 🔄 Counter-rotate the number to keep it upright */}
              <motion.span
                animate={{ rotate: -(tableRotation || 0) }}
                className="font-bold select-none pointer-events-none"
                style={{
                  fontSize: `${seatFontSize}px`,
                  color: isSelected ? '#a5b4fc' : statusColor
                }}
              >
                {seatNumber}
              </motion.span>
            </motion.div>
          )
        })}
      </AnimatePresence>

      {/* Instructions overlay when seat selected in admin mode */}
      {isAdmin && localSelectedIndex !== null && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
          <span className="text-[9px] text-indigo-400 bg-slate-900/90 px-2 py-1 rounded-full">
            Arrow keys to nudge • Shift+Arrow for bigger steps • Delete to remove
          </span>
        </div>
      )}
    </div>
  )
}

'use client'

import { memo, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { FloorPlanSeat } from './use-floor-plan'

interface SeatNodeProps {
  seat: FloorPlanSeat
  tableWidth: number
  tableHeight: number
  isSelected?: boolean
  isEditable?: boolean  // Admin mode: allow dragging
  onSelect?: (seatNumber: number) => void
  onDragStart?: (seatId: string) => void
  onDragEnd?: (seatId: string, newRelativeX: number, newRelativeY: number) => void
}

const SEAT_TYPE_COLORS: Record<string, string> = {
  standard: '#4b5563',
  premium: '#7c3aed',
  accessible: '#2563eb',
  booth_end: '#059669',
  bar: '#ea580c',
}

export const SeatNode = memo(function SeatNode({
  seat,
  tableWidth,
  tableHeight,
  isSelected = false,
  isEditable = false,
  onSelect,
  onDragStart,
  onDragEnd,
}: SeatNodeProps) {
  const seatSize = 24
  const isDraggingRef = useRef(false)
  const startPosRef = useRef({ x: 0, y: 0 })

  // Position: table center offset + relative seat position
  const x = tableWidth / 2 + seat.relativeX
  const y = tableHeight / 2 + seat.relativeY

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isEditable) {
      onSelect?.(seat.seatNumber)
      return
    }

    e.stopPropagation()
    e.preventDefault()
    isDraggingRef.current = true
    startPosRef.current = { x: e.clientX, y: e.clientY }
    onDragStart?.(seat.id)

    const element = e.currentTarget as HTMLElement
    element.setPointerCapture(e.pointerId)
  }, [isEditable, seat.seatNumber, seat.id, onSelect, onDragStart])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !isEditable) return

    const deltaX = e.clientX - startPosRef.current.x
    const deltaY = e.clientY - startPosRef.current.y

    // Update position in real-time via parent
    const newRelativeX = seat.relativeX + deltaX
    const newRelativeY = seat.relativeY + deltaY
    onDragEnd?.(seat.id, newRelativeX, newRelativeY)

    startPosRef.current = { x: e.clientX, y: e.clientY }
  }, [isEditable, seat.relativeX, seat.relativeY, seat.id, onDragEnd])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return

    isDraggingRef.current = false
    const element = e.currentTarget as HTMLElement
    element.releasePointerCapture(e.pointerId)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isDraggingRef.current) {
      onSelect?.(seat.seatNumber)
    }
  }, [seat.seatNumber, onSelect])

  const backgroundColor = SEAT_TYPE_COLORS[seat.seatType] || SEAT_TYPE_COLORS.standard

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      style={{
        position: 'absolute',
        left: x - seatSize / 2,
        top: y - seatSize / 2,
        width: seatSize,
        height: seatSize,
        borderRadius: '50%',
        backgroundColor,
        border: isSelected
          ? '3px solid #6366f1'
          : '2px solid rgba(255, 255, 255, 0.3)',
        boxShadow: isSelected
          ? '0 0 12px rgba(99, 102, 241, 0.5)'
          : '0 2px 4px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        fontWeight: 600,
        color: 'white',
        cursor: isEditable ? 'move' : 'pointer',
        zIndex: isSelected ? 20 : 10,
        transform: `rotate(${seat.angle}deg)`,
        transition: isDraggingRef.current ? 'none' : 'box-shadow 0.2s, border 0.2s',
        touchAction: 'none',
      }}
      title={`Seat ${seat.label} - ${seat.seatType}`}
    >
      {seat.label}
    </motion.div>
  )
})

// Utility function to render all seats for a table
interface RenderSeatsProps {
  seats: FloorPlanSeat[]
  tableWidth: number
  tableHeight: number
  selectedSeatNumber?: number | null
  isEditable?: boolean
  onSeatSelect?: (seatNumber: number) => void
  onSeatDragStart?: (seatId: string) => void
  onSeatDragEnd?: (seatId: string, newRelativeX: number, newRelativeY: number) => void
}

export function TableSeats({
  seats,
  tableWidth,
  tableHeight,
  selectedSeatNumber,
  isEditable = false,
  onSeatSelect,
  onSeatDragStart,
  onSeatDragEnd,
}: RenderSeatsProps) {
  return (
    <>
      {seats.map((seat) => (
        <SeatNode
          key={seat.id}
          seat={seat}
          tableWidth={tableWidth}
          tableHeight={tableHeight}
          isSelected={selectedSeatNumber === seat.seatNumber}
          isEditable={isEditable}
          onSelect={onSeatSelect}
          onDragStart={onSeatDragStart}
          onDragEnd={onSeatDragEnd}
        />
      ))}
    </>
  )
}

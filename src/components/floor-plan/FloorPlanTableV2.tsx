// src/components/floor-plan/FloorPlanTableV2.tsx
'use client'

import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  useFloorPlanStore,
  FloorPlanTable as TableType,
  FloorPlanSeat,
} from './useFloorPlanStore'

interface Props {
  table: TableType
  mode: 'service' | 'admin'
  isMultiSelected?: boolean // From parent for multi-select UI
  onCombineDrop?: (sourceId: string, targetId: string, dropX: number, dropY: number) => void
  onAddSeat?: (tableIds: string[]) => void
  onRemoveSeat?: (tableIds: string[]) => void
}

export const FloorPlanTableV2: React.FC<Props> = ({
  table,
  mode,
  isMultiSelected = false,
  onCombineDrop,
  onAddSeat,
  onRemoveSeat,
}) => {
  // Get all seats from store (not filtered - stable reference)
  const allSeats = useFloorPlanStore(state => state.seats)
  const selectedTableId = useFloorPlanStore(state => state.selectedTableId)
  const selectedSeatId = useFloorPlanStore(state => state.selectedSeatId)
  const selectSeat = useFloorPlanStore(state => state.selectSeat)
  const setActiveSeat = useFloorPlanStore(state => state.setActiveSeat)
  const showOrderPanel = useFloorPlanStore(state => state.showOrderPanel)

  // Filter seats for this table using useMemo (cached)
  const seats = useMemo(() =>
    allSeats.filter(s => s.tableId === table.id),
    [allSeats, table.id]
  )

  // Single-select or multi-select both count as "selected"
  const isSelected = selectedTableId === table.id || isMultiSelected
  const isVirtual = !!table.virtualGroupId
  const isVirtualPrimary = table.virtualGroupPrimary
  const hasOrder = !!table.currentOrder

  const groupSeats = useMemo<FloorPlanSeat[]>(() => {
    // For physical combined groups, UI can optionally pass all seats of group instead
    return seats
  }, [seats])

  // Multi-selected gets cyan border, single-selected gets indigo
  // Tables with orders get orange border
  const borderColor = isMultiSelected
    ? '#22d3ee' // cyan-400 for multi-select
    : isSelected
    ? '#a5b4fc' // indigo-300 for single select
    : hasOrder
    ? '#f97316' // orange-500 for tables with orders
    : table.status === 'occupied'
    ? '#f97316'
    : table.status === 'reserved'
    ? '#22c55e'
    : '#e5e7eb'

  const background =
    mode === 'service'
      ? hasOrder || table.status === 'occupied'
        ? 'rgba(249, 115, 22, 0.15)'
        : 'rgba(15, 23, 42, 0.8)'
      : 'rgba(15, 23, 42, 0.9)'

  const virtualRingColor = table.virtualGroupColor || '#38bdf8'

  // Selection glow effect
  const boxShadow = isMultiSelected
    ? '0 0 12px rgba(34, 211, 238, 0.5), 0 0 4px rgba(34, 211, 238, 0.8)'
    : isSelected
    ? '0 0 8px rgba(165, 180, 252, 0.5)'
    : undefined

  const handleSeatClick = (seatId: string, seatNumber: number) => {
    selectSeat(seatId)
    // If order panel is open, also set the active seat for new items
    if (showOrderPanel) {
      setActiveSeat(seatNumber, table.id)
    }
  }

  return (
    <motion.div
      className="absolute rounded-xl shadow-md cursor-pointer"
      style={{
        left: table.posX,
        top: table.posY,
        width: table.width,
        height: table.height,
        border: `2px solid ${borderColor}`,
        background,
        boxSizing: 'border-box',
        boxShadow,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      }}
      layout
    >
      {/* Virtual group ring */}
      {isVirtual && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            border: `2px dashed ${virtualRingColor}`,
          }}
        />
      )}

      {/* Table name + badges */}
      <div className="absolute inset-x-1 top-1 flex items-center justify-between text-[11px] text-slate-100/80">
        <span className="truncate">{table.name}</span>
        <div className="flex items-center gap-1">
          {isVirtualPrimary && (
            <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px]">
              Primary
            </span>
          )}
          {hasOrder && (
            <span className="px-1.5 py-0.5 rounded-full bg-orange-500/30 text-orange-300 text-[10px] font-medium">
              ${table.currentOrder!.total.toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {/* Seats */}
      {groupSeats.map(seat => {
        const centerX = table.width / 2 + seat.relativeX
        const centerY = table.height / 2 + seat.relativeY
        const radius = 16

        const isSeatSelected = selectedSeatId === seat.id

        return (
          <div
            key={seat.id}
            className="absolute flex items-center justify-center"
            style={{
              left: centerX - radius,
              top: centerY - radius,
              width: radius * 2,
              height: radius * 2,
              transform: `rotate(${seat.angle}deg)`,
              transformOrigin: 'center center',
            }}
            onClick={e => {
              e.stopPropagation()
              handleSeatClick(seat.id, seat.seatNumber)
            }}
          >
            <div
              className="flex items-center justify-center rounded-full border text-[11px] font-medium"
              style={{
                width: radius * 2,
                height: radius * 2,
                backgroundColor: isSeatSelected
                  ? '#a5b4fc'
                  : 'rgba(15,23,42,0.95)',
                borderColor: isSeatSelected ? '#c4b5fd' : '#4b5563',
                color: isSeatSelected ? '#111827' : '#e5e7eb',
                boxShadow: isSeatSelected
                  ? '0 0 8px rgba(129, 140, 248, 0.8)'
                  : '0 0 4px rgba(15, 23, 42, 0.8)',
              }}
            >
              <span
                style={{
                  transform: `rotate(${-seat.angle}deg)`,
                  display: 'inline-block',
                }}
              >
                {seat.label || seat.seatNumber}
              </span>
            </div>
          </div>
        )
      })}

      {/* Admin: seat controls */}
      {mode === 'admin' && (
        <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 text-[10px] text-slate-300">
          <button
            className="px-1 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600"
            onClick={e => {
              e.stopPropagation()
              onAddSeat?.([table.id])
            }}
          >
            + seat
          </button>
          <button
            className="px-1 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600"
            onClick={e => {
              e.stopPropagation()
              onRemoveSeat?.([table.id])
            }}
          >
            - seat
          </button>
        </div>
      )}
    </motion.div>
  )
}

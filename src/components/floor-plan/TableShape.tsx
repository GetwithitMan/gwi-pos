'use client'

import { useRef, useState, useCallback } from 'react'
import { FloorPlanTable, TableStatus } from './use-floor-plan'
import { SeatDot } from './SeatDot'

// Status color mapping
const STATUS_COLORS: Record<TableStatus, { fill: string; stroke: string; text: string }> = {
  available: { fill: '#DCFCE7', stroke: '#22C55E', text: '#166534' },
  occupied: { fill: '#DBEAFE', stroke: '#3B82F6', text: '#1E40AF' },
  reserved: { fill: '#FEF9C3', stroke: '#EAB308', text: '#854D0E' },
  dirty: { fill: '#FED7AA', stroke: '#F97316', text: '#9A3412' },
  in_use: { fill: '#E0E7FF', stroke: '#6366F1', text: '#3730A3' },
}

interface TableShapeProps {
  table: FloorPlanTable
  isSelected: boolean
  isDragging: boolean
  isDropTarget: boolean
  isCombined: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onLongPress: () => void
}

export function TableShape({
  table,
  isSelected,
  isDragging,
  isDropTarget,
  isCombined,
  onSelect,
  onDragStart,
  onDragEnd,
  onLongPress,
}: TableShapeProps) {
  const colors = STATUS_COLORS[table.status] || STATUS_COLORS.available
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)

  // Touch handling for drag
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Start long press timer for split action
    longPressTimer.current = setTimeout(() => {
      onLongPress()
    }, 500)

    // Mark as potentially dragging
    setIsDragActive(true)
    onDragStart()
  }, [onDragStart, onLongPress])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault()

    // Clear long press timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    if (isDragActive) {
      setIsDragActive(false)
      onDragEnd()
    }
  }, [isDragActive, onDragEnd])

  const handlePointerMove = useCallback(() => {
    // Cancel long press if moved
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
  }, [onSelect])

  // Calculate center for text
  const centerX = table.posX + table.width / 2
  const centerY = table.posY + table.height / 2

  // Render shape based on type
  const renderShape = () => {
    const baseProps = {
      fill: colors.fill,
      stroke: isSelected ? '#2563EB' : isDropTarget ? '#22C55E' : colors.stroke,
      strokeWidth: isSelected ? 3 : isDropTarget ? 4 : 2,
      style: {
        filter: isDragging
          ? 'drop-shadow(0 8px 12px rgba(0,0,0,0.25))'
          : isDropTarget
          ? 'drop-shadow(0 0 12px rgba(34,197,94,0.5))'
          : isSelected
          ? 'drop-shadow(0 4px 8px rgba(37,99,235,0.3))'
          : 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
        transition: 'all 0.15s ease-out',
        transform: isDragging ? 'scale(1.05)' : undefined,
        transformOrigin: `${centerX}px ${centerY}px`,
      },
    }

    switch (table.shape) {
      case 'circle':
        return (
          <ellipse
            cx={centerX}
            cy={centerY}
            rx={table.width / 2}
            ry={table.height / 2}
            {...baseProps}
          />
        )
      case 'square':
      case 'rectangle':
      default:
        return (
          <rect
            x={table.posX}
            y={table.posY}
            width={table.width}
            height={table.height}
            rx={8}
            ry={8}
            {...baseProps}
          />
        )
      case 'booth':
        // Booth shape - rounded on one side
        return (
          <path
            d={`
              M ${table.posX + 8} ${table.posY}
              H ${table.posX + table.width}
              V ${table.posY + table.height}
              H ${table.posX + 8}
              Q ${table.posX} ${table.posY + table.height} ${table.posX} ${table.posY + table.height - 8}
              V ${table.posY + 8}
              Q ${table.posX} ${table.posY} ${table.posX + 8} ${table.posY}
              Z
            `}
            {...baseProps}
          />
        )
      case 'bar':
        // Bar counter - long rectangle with rounded ends
        return (
          <rect
            x={table.posX}
            y={table.posY}
            width={table.width}
            height={table.height}
            rx={table.height / 2}
            ry={table.height / 2}
            {...baseProps}
          />
        )
    }
  }

  // Determine display name (combined tables show "T1+T2")
  const displayName = table.combinedTableIds && table.combinedTableIds.length > 0
    ? table.name // Already shows combined name like "T1+T2"
    : table.name

  return (
    <g
      className={`table-shape cursor-pointer ${isDragging ? 'opacity-90' : ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerUp}
      style={{ touchAction: 'none' }}
    >
      {/* Drop zone indicator */}
      {isDropTarget && (
        <rect
          x={table.posX - 8}
          y={table.posY - 8}
          width={table.width + 16}
          height={table.height + 16}
          rx={12}
          fill="none"
          stroke="#22C55E"
          strokeWidth={3}
          strokeDasharray="6 4"
          className="animate-pulse"
        />
      )}

      {/* Main table shape */}
      {renderShape()}

      {/* Combined indicator badge */}
      {isCombined && (
        <g>
          <circle
            cx={table.posX + table.width - 8}
            cy={table.posY + 8}
            r={12}
            fill="#8B5CF6"
            stroke="#ffffff"
            strokeWidth={2}
          />
          <text
            x={table.posX + table.width - 8}
            y={table.posY + 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={700}
            fill="#ffffff"
          >
            +
          </text>
        </g>
      )}

      {/* Table name */}
      <text
        x={centerX}
        y={centerY - (table.currentOrder ? 10 : 0)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={14}
        fontWeight={700}
        fill={colors.text}
        className="pointer-events-none select-none"
      >
        {displayName}
      </text>

      {/* Order info (if occupied) */}
      {table.currentOrder && (
        <>
          <text
            x={centerX}
            y={centerY + 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fill={colors.text}
            opacity={0.8}
            className="pointer-events-none select-none"
          >
            #{table.currentOrder.orderNumber}
          </text>
          <text
            x={centerX}
            y={centerY + 22}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fill={colors.text}
            opacity={0.7}
            className="pointer-events-none select-none"
          >
            ${table.currentOrder.total.toFixed(2)}
          </text>
        </>
      )}

      {/* Capacity indicator (when no order) */}
      {!table.currentOrder && (
        <text
          x={centerX}
          y={centerY + 14}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={10}
          fill={colors.text}
          opacity={0.6}
          className="pointer-events-none select-none"
        >
          {table.capacity} seats
        </text>
      )}

      {/* Render seats */}
      {table.seats?.map(seat => (
        <SeatDot
          key={seat.id}
          seat={seat}
          tableX={table.posX}
          tableY={table.posY}
          tableWidth={table.width}
          tableHeight={table.height}
          isOccupied={table.status === 'occupied'}
        />
      ))}
    </g>
  )
}

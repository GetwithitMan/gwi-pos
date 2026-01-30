'use client'

import { FloorPlanSeat } from './use-floor-plan'

interface SeatDotProps {
  seat: FloorPlanSeat
  tableX: number
  tableY: number
  tableWidth: number
  tableHeight: number
  isOccupied?: boolean
}

export function SeatDot({
  seat,
  tableX,
  tableY,
  tableWidth,
  tableHeight,
  isOccupied = false,
}: SeatDotProps) {
  // Calculate absolute position from table center + relative offset
  const centerX = tableX + tableWidth / 2
  const centerY = tableY + tableHeight / 2
  const x = centerX + seat.relativeX
  const y = centerY + seat.relativeY

  return (
    <g className="seat-dot">
      {/* Seat circle */}
      <circle
        cx={x}
        cy={y}
        r={10}
        fill={isOccupied ? '#3B82F6' : '#ffffff'}
        stroke={isOccupied ? '#1D4ED8' : '#9CA3AF'}
        strokeWidth={2}
        className="transition-colors duration-200"
      />
      {/* Seat label */}
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontWeight={500}
        fill={isOccupied ? '#ffffff' : '#374151'}
        className="pointer-events-none select-none"
      >
        {seat.label}
      </text>
    </g>
  )
}

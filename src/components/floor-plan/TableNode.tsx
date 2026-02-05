'use client'

import { useRef, useCallback, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloorPlanTable, FloorPlanSeat, TableStatus } from './use-floor-plan'

interface TableNodeProps {
  table: FloorPlanTable
  isSelected: boolean
  isDragging: boolean
  isDropTarget: boolean
  isColliding?: boolean  // Whether the table collides with fixtures during drag
  combinedGroupColor?: string  // Color shared by all tables in a combined group
  showSeats?: boolean  // Whether to display seat indicators
  selectedSeat?: { tableId: string; seatNumber: number } | null
  flashMessage?: string | null  // Flash message to display (e.g., "OPEN ORDER")
  isEditable?: boolean  // Admin mode - allow seat dragging
  combinedSeatOffset?: number  // For combined tables: offset to add to seat numbers for sequential display
  combinedTotalSeats?: number  // Total seats across all combined tables
  // Virtual combine mode props
  isVirtualCombineMode?: boolean  // Whether virtual combine mode is active
  isVirtualCombineSelected?: boolean  // Whether this table is selected for virtual combine
  isVirtualCombineUnavailable?: boolean  // Whether this table cannot be selected (already in another group)
  virtualGroupColor?: string  // Color for virtual group pulsing glow
  onTap: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onLongPress: () => void
  onSeatTap?: (seatNumber: number) => void
  onSeatDrag?: (seatId: string, newRelativeX: number, newRelativeY: number) => void
  onSeatDelete?: (seatId: string) => void
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

export const TableNode = memo(function TableNode({
  table,
  isSelected,
  isDragging,
  isDropTarget,
  isColliding = false,
  combinedGroupColor,
  showSeats = false,
  selectedSeat,
  flashMessage,
  isEditable = false,
  combinedSeatOffset = 0,
  combinedTotalSeats,
  isVirtualCombineMode = false,
  isVirtualCombineSelected = false,
  isVirtualCombineUnavailable = false,
  virtualGroupColor,
  onTap,
  onDragStart,
  onDragEnd,
  onLongPress,
  onSeatTap,
  onSeatDrag,
  onSeatDelete,
}: TableNodeProps) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isCombined = Boolean(table.combinedTableIds && table.combinedTableIds.length > 0)
  const isPartOfCombinedGroup = Boolean(table.combinedWithId) // This table is combined INTO another
  const isLocked = table.isLocked
  const isBooth = table.shape === 'booth'

  // Virtual group state
  const isInVirtualGroup = Boolean(table.virtualGroupId)
  const isVirtualGroupPrimary = table.virtualGroupPrimary
  const effectiveVirtualGroupColor = virtualGroupColor || table.virtualGroupColor || (isInVirtualGroup ? '#06b6d4' : null)

  // Enhanced debug logging - log ALL tables to see data
  console.log('Table Debug:', {
    tableName: table.name,
    virtualGroupId: table.virtualGroupId,
    virtualGroupColor: table.virtualGroupColor,
    isInVirtualGroup,
    effectiveColor: effectiveVirtualGroupColor,
  })

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
  // This ensures seat 1 is ALWAYS seat 1, regardless of table position/combine state
  const databaseSeats = useMemo(() => {
    // Don't show seats if showSeats is false
    if (!showSeats) return []

    // Always use the table's database seats - they belong to THIS table permanently
    // Even in combined groups, each table's seats render relative to their own table
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
    }))
  }, [showSeats, table.seats, table.width, table.height])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    console.log('[DRAG] pointerDown on table:', table.id, { isLocked, isVirtualCombineMode, target: e.target })

    // In virtual combine mode, we're just selecting tables - handle tap directly
    if (isVirtualCombineMode) {
      console.log('[DRAG] In virtual combine mode, will handle as tap on pointerUp')
      return
    }

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
  }, [onDragStart, onLongPress, isLocked, isVirtualCombineMode, table.id])

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    // In virtual combine mode, handle as a tap to toggle selection
    if (isVirtualCombineMode) {
      console.log('[TableNode] pointerUp in virtual combine mode - calling onTap for table:', table.id)
      onTap()
      return
    }
    // Only call onDragEnd if THIS table was being dragged
    // This prevents clearing draggedTableId when releasing over a different table (drop target)
    if (isDragging) {
      onDragEnd()
    }
  }, [onDragEnd, isDragging, isVirtualCombineMode, onTap, table.id])

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
      className={`table-node status-${table.status} ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''} ${isColliding ? 'colliding' : ''} ${isCombined ? 'combined' : ''} ${isLocked ? 'locked' : ''} ${isInVirtualGroup ? 'virtual-combined' : ''} ${isVirtualCombineSelected ? 'virtual-combine-selected' : ''} ${isVirtualCombineUnavailable ? 'virtual-combine-unavailable' : ''}`}
      style={{
        left: table.posX,
        top: table.posY,
        width: table.width,
        height: table.height,
        zIndex: isDragging ? 100 : isSelected ? 50 : 1,
        // Dim and disable unavailable tables during virtual combine mode
        ...(isVirtualCombineUnavailable ? {
          opacity: 0.4,
          filter: 'grayscale(0.7)',
          pointerEvents: 'none' as const,
        } : {}),
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
        // Only handle click when NOT in virtual combine mode
        // (virtual combine mode uses pointerUp to avoid double-toggle)
        if (!isVirtualCombineMode) {
          e.stopPropagation()
          onTap()
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerUp}
      whileTap={{ scale: 0.98 }}
    >
      {/* Subtle glow for virtual combined tables - OUTSIDE table-node-inner to avoid overflow:hidden clipping */}
      {isInVirtualGroup && (() => {
        const virtualGlowColor = effectiveVirtualGroupColor || '#06b6d4'
        return (
          <motion.div
            className="absolute virtual-group-pulse"
            style={{
              inset: -6,
              borderRadius: 'inherit',
              pointerEvents: 'none',
              zIndex: 0,
            }}
            animate={{
              boxShadow: [
                `0 0 12px ${virtualGlowColor}60, 0 0 24px ${virtualGlowColor}30`,
                `0 0 16px ${virtualGlowColor}70, 0 0 32px ${virtualGlowColor}40`,
                `0 0 12px ${virtualGlowColor}60, 0 0 24px ${virtualGlowColor}30`,
              ],
            }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      })()}

      {/* Soft border indicator for virtual groups - OUTSIDE table-node-inner to avoid overflow:hidden clipping */}
      {isInVirtualGroup && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 12,
            border: `2px solid ${effectiveVirtualGroupColor || '#06b6d4'}`,
            opacity: 0.8,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}

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
                `0 0 ${isSelected ? '50px' : '40px'} ${hasCombinedColor ? `${combinedGroupColor}4D` : glowColor.replace(/[\d.]+\)$/, '0.3)')}`,
              ].join(', '),
          borderColor: isColliding
            ? '#ef4444'
            : isDropTarget
              ? '#22c55e'
              : hasCombinedColor
                ? combinedGroupColor
                : isInVirtualGroup
                  ? (effectiveVirtualGroupColor || '#06b6d4')
                  : isSelected
                    ? '#6366f1'
                    : 'rgba(255, 255, 255, 0.1)',
          borderWidth: isColliding || isDropTarget || isSelected || hasCombinedColor || isInVirtualGroup ? '3px' : '1px',
          borderStyle: isColliding ? 'solid' : isDropTarget || isCombined || isPartOfCombinedGroup ? 'dashed' : 'solid',
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

        {/* Selection checkmark for virtual combine mode */}
        {isVirtualCombineMode && isVirtualCombineSelected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-2 -right-2 w-6 h-6 bg-cyan-500 rounded-full flex items-center justify-center shadow-lg z-20"
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>
        )}

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
            </>
          ) : (
            <div className="table-node-info" style={{ fontSize: `${infoFontSize}px` }}>
              {/* For combined tables, show total seats across group */}
              {combinedTotalSeats
                ? `${combinedTotalSeats} seat${combinedTotalSeats !== 1 ? 's' : ''}`
                : `${table.seats?.length || table.capacity} seat${(table.seats?.length || table.capacity) !== 1 ? 's' : ''}`
              }
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

        {/* Virtual group chain link badge */}
        <AnimatePresence>
          {isInVirtualGroup && (
            <motion.div
              className="virtual-group-badge"
              style={{
                backgroundColor: effectiveVirtualGroupColor || '#06b6d4',
                position: 'absolute',
                top: -6,
                left: -6,
                width: 26,
                height: 26,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '3px solid white',
                boxShadow: `0 0 10px ${effectiveVirtualGroupColor || '#06b6d4'}`,
                zIndex: 15,
              }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              title={isVirtualGroupPrimary ? 'Primary table of virtual group' : 'Part of virtual group'}
            >
              <svg width="12" height="12" fill="white" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>
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

      {/* Seat indicators from database (permanently assigned to this table) */}
      {showSeats && databaseSeats.length > 0 && (
        <>
          {databaseSeats.map((seat, index) => {
            // Check if this table is part of a combined group (either primary or child)
            // combinedTotalSeats is set for any table in a combined group
            const isInCombinedGroup = Boolean(combinedTotalSeats)

            // For combined tables, use seat.label from database - it was set to the correct
            // sequential number (1, 2, 3...) based on clockwise position during combine.
            // For single tables, use seatNumber.
            // Parse label as number for selection matching
            const displayNumber = isInCombinedGroup
              ? parseInt(seat.label, 10) || seat.seatNumber
              : seat.seatNumber

            // For combined groups, check tableId matches the primary (or this table if it IS primary)
            // Child tables: selectedSeat.tableId should match table.combinedWithId (the primary)
            // Primary tables: selectedSeat.tableId should match table.id
            const expectedTableId = table.combinedWithId || table.id
            const isSelectedSeat = isInCombinedGroup
              ? selectedSeat?.tableId === expectedTableId && selectedSeat?.seatNumber === displayNumber
              : selectedSeat?.tableId === table.id && selectedSeat?.seatNumber === seat.seatNumber
            const seatColor = combinedGroupColor || '#6366f1'
            // Calculate position relative to table center for drag calculations
            const seatRelativeX = seat.x - table.width / 2
            const seatRelativeY = seat.y - table.height / 2

            // Display the label - for combined tables this is the clockwise sequential number
            // For single tables this is the original label
            const displayLabel = seat.label

            return (
              <motion.div
                key={`seat-${seat.id}`}
                className={`seat-indicator ${isSelectedSeat ? 'selected' : ''} ${isBooth ? 'booth-seat' : ''} ${isEditable ? 'editable' : ''}`}
                drag={isEditable}
                dragMomentum={false}
                dragElastic={0}
                dragConstraints={{
                  // Constrain drag to ~150px from current position (prevents losing seats)
                  left: -150,
                  right: 150,
                  top: -150,
                  bottom: 150,
                }}
                onDragEnd={(e, info) => {
                  if (isEditable && onSeatDrag) {
                    // Calculate new relative position from table center
                    let newRelativeX = Math.round(seatRelativeX + info.offset.x)
                    let newRelativeY = Math.round(seatRelativeY + info.offset.y)

                    // Constrain to max 150px from center
                    const maxDistance = 150
                    const distance = Math.sqrt(newRelativeX * newRelativeX + newRelativeY * newRelativeY)
                    if (distance > maxDistance) {
                      const scale = maxDistance / distance
                      newRelativeX = Math.round(newRelativeX * scale)
                      newRelativeY = Math.round(newRelativeY * scale)
                    }

                    onSeatDrag(seat.id, newRelativeX, newRelativeY)
                  }
                }}
                style={{
                  position: 'absolute',
                  left: seat.x - 12, // Center the 24px dot
                  top: seat.y - 12,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  backgroundColor: isSelectedSeat ? seatColor : isEditable ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.15)',
                  border: `2px solid ${isSelectedSeat ? seatColor : isEditable ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.3)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 600,
                  color: isSelectedSeat ? 'white' : isEditable ? '#c7d2fe' : 'rgba(255, 255, 255, 0.7)',
                  cursor: isEditable ? 'grab' : 'pointer',
                  zIndex: isSelectedSeat ? 20 : 10,
                  boxShadow: isSelectedSeat
                    ? `0 0 10px ${seatColor}80`
                    : isEditable
                      ? '0 2px 8px rgba(99, 102, 241, 0.3)'
                      : '0 2px 4px rgba(0, 0, 0, 0.3)',
                  // Don't rotate the seat circle - keep it as a simple circle
                  // Text inside will counter-rotate for table rotation only
                }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.95 }}
                whileDrag={{ scale: 1.2, cursor: 'grabbing' }}
                onClick={(e) => {
                  e.stopPropagation()
                  // Use the display number (from seat.label for combined, seatNumber for single)
                  onSeatTap?.(displayNumber)
                }}
                title={
                  isEditable
                    ? isSelectedSeat
                      ? `Seat ${displayLabel} - Arrow keys: 5px, Shift+Arrows: 20px, Del: remove`
                      : `Seat ${displayLabel} - Click to select, drag to move`
                    : `Seat ${displayLabel}`
                }
              >
                {/* Counter-rotate label by table rotation only so ALL seat numbers face upright */}
                <span style={{ transform: `rotate(${-(table.rotation || 0)}deg)` }}>
                  {displayLabel}
                </span>
                {/* Delete button for selected seat in edit mode - counter-rotate to stay upright */}
                {isEditable && isSelectedSeat && onSeatDelete && (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#ef4444',
                      border: '2px solid #1e293b',
                      color: 'white',
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                      transform: `rotate(${-(table.rotation || 0)}deg)`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSeatDelete(seat.id)
                    }}
                    title="Delete seat"
                  >
                    ×
                  </motion.button>
                )}
                {/* Keyboard hint for selected seat - counter-rotate to stay readable */}
                {isEditable && isSelectedSeat && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      position: 'absolute',
                      bottom: -28,
                      left: '50%',
                      transform: `translateX(-50%) rotate(${-(table.rotation || 0)}deg)`,
                      whiteSpace: 'nowrap',
                      fontSize: 9,
                      fontWeight: 500,
                      color: '#a5b4fc',
                      background: 'rgba(15, 23, 42, 0.95)',
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      pointerEvents: 'none',
                    }}
                  >
                    ← → ↑ ↓ move • Shift: 20px
                  </motion.div>
                )}
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
})


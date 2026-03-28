'use client'

/**
 * FloorPlanTableCanvas — The floor plan canvas view with tables, fixtures, and entertainment items.
 * Extracted from FloorPlanHome.tsx to reduce component complexity.
 *
 * Renders: room tabs, auto-scaled table layout, section labels, entertainment elements,
 * fixtures, ghost preview, reset button, loading/empty states.
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RoomTabs } from './RoomTabs'
import { TableNode } from './TableNode'
import { FloorPlanEntertainment } from './FloorPlanEntertainment'
import type { FloorPlanTable, FloorPlanSection, FloorPlanElement } from './use-floor-plan'
import type { MenuItem } from '@/types'
import type { InlineOrderItem } from './types'

interface FloorPlanTableCanvasProps {
  // Data
  tables: FloorPlanTable[]
  sections: FloorPlanSection[]
  elements: FloorPlanElement[]
  sortedSections: { id: string; name: string; color?: string }[]
  selectedSectionId: string | null
  isLoading: boolean
  // Active table state
  activeTableId: string | null
  selectedTableId: string | null
  draggedTableId: string | null
  dropTargetTableId: string | null
  isColliding: boolean
  flashingTables: Map<string, { message: string; expiresAt: number }>
  selectedSeat: { tableId: string; seatNumber: number } | null
  seatsWithItems: Set<number>
  activeOrderStatusBadges: any
  inlineOrderItems: InlineOrderItem[]
  // Auto-scale
  autoScale: number
  autoScaleOffset: { x: number; y: number }
  containerRef: React.RefObject<HTMLDivElement | null>
  // Callbacks
  onSectionSelect: (id: string | null) => void
  onOpenSettings: () => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onCanvasClick: () => void
  onTableTap: (tableId: string) => void
  onDragStart: (tableId: string) => void
  onDragEnd: () => void
  onLongPress: (tableId: string) => void
  onSeatTap: (tableId: string, seatNumber: number) => void
  onSeatDrag: (seatId: string, newRelativeX: number, newRelativeY: number) => void
  onResetTable: (tableId: string) => void
  onEntertainmentItemTap: (item: MenuItem) => void
}

export const FloorPlanTableCanvas = memo(function FloorPlanTableCanvas({
  tables,
  sections,
  elements,
  sortedSections,
  selectedSectionId,
  isLoading,
  activeTableId,
  selectedTableId,
  draggedTableId,
  dropTargetTableId,
  isColliding,
  flashingTables,
  selectedSeat,
  seatsWithItems,
  activeOrderStatusBadges,
  inlineOrderItems,
  autoScale,
  autoScaleOffset,
  containerRef,
  onSectionSelect,
  onOpenSettings,
  onPointerMove,
  onPointerUp,
  onCanvasClick,
  onTableTap,
  onDragStart,
  onDragEnd,
  onLongPress,
  onSeatTap,
  onSeatDrag,
  onResetTable,
  onEntertainmentItemTap,
}: FloorPlanTableCanvasProps) {
  return (
    <>
      {/* Room/Section Tabs */}
      {sortedSections.length > 0 && (
        <RoomTabs
          rooms={sortedSections.map(s => ({ id: s.id, name: s.name, color: s.color }))}
          selectedRoomId={selectedSectionId}
          onRoomSelect={onSectionSelect}
          showAllTab={false}
          showSettingsButton={true}
          onOpenSettings={onOpenSettings}
        />
      )}

      {/* Floor Plan Canvas */}
      <div
        ref={containerRef}
        className="floor-plan-canvas"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onCanvasClick}
        style={{ flex: 1 }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="opacity-50 mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-lg font-medium">No tables configured</p>
            <p className="text-sm opacity-60 mt-1">Add tables in the admin settings</p>
          </div>
        ) : (
          <>
            {/* Scale indicator */}
            {autoScale < 1 && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#a5b4fc',
                  fontSize: '11px',
                  fontWeight: 500,
                  zIndex: 10,
                }}
              >
                {Math.round(autoScale * 100)}% zoom
              </div>
            )}

            {/* Auto-scaled content wrapper */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                transform: autoScale < 1
                  ? `translate(${autoScaleOffset.x}px, ${autoScaleOffset.y}px) scale(${autoScale})`
                  : undefined,
                transformOrigin: 'top left',
                pointerEvents: 'auto',
              }}
            >
              {/* Section Labels */}
              {sections
                .filter(section => {
                  if (selectedSectionId === null) return true
                  return section.id === selectedSectionId
                })
                .map(section => (
                  <div
                    key={section.id}
                    className="section-label"
                    style={{ left: section.posX + 10, top: section.posY + 10, color: section.color }}
                  >
                    {section.name}
                  </div>
                ))}

              {/* Tables */}
              <AnimatePresence>
                {tables
                  .filter(table => {
                    if (selectedSectionId === null) return true
                    return table.section?.id === selectedSectionId
                  })
                  .map(table => {
                    const flash = flashingTables.get(table.id)
                    const flashMessage = flash && flash.expiresAt > Date.now() ? flash.message : null
                    const isInActiveGroup = table.id === activeTableId

                    return (
                      <TableNode
                        key={table.id}
                        table={table}
                        isSelected={selectedTableId === table.id || isInActiveGroup}
                        isDragging={draggedTableId === table.id}
                        isDropTarget={dropTargetTableId === table.id}
                        isColliding={draggedTableId === table.id && isColliding}
                        showSeats={table.id === activeTableId}
                        selectedSeat={selectedSeat}
                        flashMessage={flashMessage}
                        orderStatusBadges={table.currentOrder ? (
                          table.id === activeTableId
                            ? activeOrderStatusBadges
                            : table.currentOrder.isBottleService
                              ? { isBottleService: true, bottleServiceTierName: table.currentOrder.bottleServiceTierName ?? null, bottleServiceTierColor: table.currentOrder.bottleServiceTierColor ?? null, bottleServiceMinSpend: table.currentOrder.bottleServiceMinSpend ?? null, bottleServiceCurrentSpend: table.currentOrder.bottleServiceCurrentSpend ?? null, bottleServiceReAuthNeeded: table.currentOrder.bottleServiceReAuthNeeded ?? false }
                              : undefined
                        ) : undefined}
                        seatsWithItems={table.id === activeTableId ? seatsWithItems : undefined}
                        splitCount={table.currentOrder?.splitOrders?.length}
                        onTap={onTableTap}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onLongPress={onLongPress}
                        onSeatTap={onSeatTap}
                        onSeatDrag={onSeatDrag}
                      />
                    )
                  })}
              </AnimatePresence>

              {/* Reset Table button */}
              {activeTableId && inlineOrderItems.length === 0 && (() => {
                const activeTable = tables.find(t => t.id === activeTableId)
                if (!activeTable) return null
                const hasTempSeats = activeTable.seats.some(s => s.isTemporary)
                if (!hasTempSeats) return null
                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onResetTable(activeTableId)
                    }}
                    style={{
                      position: 'absolute',
                      left: activeTable.posX + activeTable.width / 2,
                      top: activeTable.posY + activeTable.height + 50,
                      transform: 'translateX(-50%)',
                      padding: '6px 14px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      borderRadius: '8px',
                      color: '#fca5a5',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      zIndex: 20,
                    }}
                  >
                    Reset Table
                  </button>
                )
              })()}

              {/* Floor Plan Elements */}
              {elements
                .filter(element => {
                  if (selectedSectionId === null) return true
                  return element.sectionId === selectedSectionId || element.sectionId === null
                })
                .map(element => {
                  // Render entertainment items with FloorPlanEntertainment (SVG visuals)
                  if (element.elementType === 'entertainment') {
                    return (
                      <div
                        key={element.id}
                        style={{
                          position: 'absolute',
                          left: element.posX,
                          top: element.posY,
                          zIndex: 10,
                        }}
                      >
                        <FloorPlanEntertainment
                          element={element}
                          isSelected={false}
                          mode="service"
                          onSelect={() => {
                            if (element.linkedMenuItem) {
                              const menuItem: MenuItem = {
                                id: element.linkedMenuItem.id,
                                name: element.linkedMenuItem.name,
                                price: element.linkedMenuItem.price,
                                categoryId: '',
                                itemType: 'timed_rental',
                                entertainmentStatus: element.linkedMenuItem.entertainmentStatus as 'available' | 'in_use' | 'maintenance' | undefined,
                                blockTimeMinutes: element.linkedMenuItem.blockTimeMinutes || undefined,
                              }
                              onEntertainmentItemTap(menuItem)
                            }
                          }}
                        />
                      </div>
                    )
                  }

                  // Render fixtures (walls, bars, etc.)
                  return (
                    <div
                      key={element.id}
                      style={{
                        position: 'absolute',
                        left: element.posX,
                        top: element.posY,
                        width: element.width,
                        height: element.height,
                        transform: `rotate(${element.rotation}deg)`,
                        transformOrigin: 'center',
                        backgroundColor: element.fillColor || 'rgba(156, 163, 175, 0.7)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                        opacity: element.opacity,
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.9)',
                          textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '90%',
                        }}
                      >
                        {element.name}
                      </span>
                    </div>
                  )
                })}
            </div>
            {/* End of auto-scaled content wrapper */}
          </>
        )}
      </div>
    </>
  )
})

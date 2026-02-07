/**
 * useFloorPlanDrag Hook
 *
 * Handles table drag-and-drop for combining tables in the floor plan.
 *
 * Features:
 * - Pointer move/up handlers for drag operations
 * - Coordinate transformation for auto-scaled floor plans
 * - Ghost preview calculation for visual feedback
 * - Drop target detection with hit testing
 * - Collision detection with fixtures (walls, bar counters, etc.)
 */

import { useState, useCallback, useMemo, RefObject } from 'react'
import { calculateAttachSide, calculateAttachPosition } from '../table-positioning'
import { checkTableAllFixturesCollision, type FixtureBounds } from '@/domains/floor-plan/shared/collisionDetection'
import { logger } from '@/lib/logger'

interface TableLike {
  id: string
  posX: number
  posY: number
  width: number
  height: number
  combinedWithId?: string | null
  combinedTableIds?: string[] | null
}

interface FixtureLike {
  id: string
  visualType: string
  posX: number
  posY: number
  width: number
  height: number
  geometry?: any
  thickness?: number
}

interface UseFloorPlanDragOptions {
  containerRef: RefObject<HTMLDivElement | null>
  tablesRef: RefObject<TableLike[]>
  fixturesRef: RefObject<FixtureLike[]>
  autoScaleRef: RefObject<number>
  autoScaleOffsetRef: RefObject<{ x: number; y: number }>
  draggedTableId: string | null
  dropTargetTableId: string | null
  updateDragTarget: (tableId: string | null, position?: { x: number; y: number }) => void
  endDrag: () => void
  onCombine: (sourceId: string, targetId: string, dropPosition?: { x: number; y: number }) => Promise<boolean>
}

interface GhostPreview {
  posX: number
  posY: number
  width: number
  height: number
  side: 'top' | 'bottom' | 'left' | 'right'
}

interface UseFloorPlanDragResult {
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: () => Promise<void>
  ghostPreview: GhostPreview | null
  lastDropPosition: { x: number; y: number } | null
  isColliding: boolean
}

export function useFloorPlanDrag({
  containerRef,
  tablesRef,
  fixturesRef,
  autoScaleRef,
  autoScaleOffsetRef,
  draggedTableId,
  dropTargetTableId,
  updateDragTarget,
  endDrag,
  onCombine,
}: UseFloorPlanDragOptions): UseFloorPlanDragResult {
  // Track drop position for ghost preview and combine API
  const [lastDropPosition, setLastDropPosition] = useState<{ x: number; y: number } | null>(null)

  // Track collision state for visual feedback
  const [isColliding, setIsColliding] = useState(false)

  // Handle pointer move during drag
  // Transforms screen coordinates to floor plan coordinates when auto-scaled
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggedTableId || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    let x = e.clientX - rect.left
    let y = e.clientY - rect.top

    // Transform screen coords to floor plan coords when auto-scaled
    // The floor plan content is wrapped in a scaled/translated div, so pointer
    // coordinates need to be reverse-transformed to match table positions
    const scale = autoScaleRef.current
    const offset = autoScaleOffsetRef.current
    if (scale < 1) {
      x = (x - offset.x) / scale
      y = (y - offset.y) / scale
    }

    setLastDropPosition({ x, y })

    // Get dragged table for collision checking
    const draggedTable = tablesRef.current.find(t => t.id === draggedTableId)
    if (!draggedTable) return

    // Check collision with fixtures at the current drag position
    // Convert fixtures to FixtureBounds format for collision detection
    const fixtureBounds: FixtureBounds[] = fixturesRef.current.map(fixture => {
      // Determine fixture type based on visualType
      let fixtureType: 'wall' | 'rectangle' | 'circle' = 'rectangle'
      if (fixture.visualType === 'wall' || fixture.geometry?.start) {
        fixtureType = 'wall'
      } else if (fixture.visualType === 'pillar' || fixture.visualType === 'planter_builtin') {
        fixtureType = 'circle'
      }

      return {
        id: fixture.id,
        type: fixtureType,
        visualType: fixture.visualType,
        x: fixture.posX + fixture.width / 2, // Convert to center-based coords
        y: fixture.posY + fixture.height / 2,
        width: fixture.width,
        height: fixture.height,
        centerX: fixtureType === 'circle' ? fixture.posX + fixture.width / 2 : undefined,
        centerY: fixtureType === 'circle' ? fixture.posY + fixture.height / 2 : undefined,
        radius: fixtureType === 'circle' ? Math.max(fixture.width, fixture.height) / 2 : undefined,
        geometry: fixture.geometry,
        thickness: fixture.thickness,
      }
    })

    // Check if table would collide with any fixtures at current position
    const collisionResult = checkTableAllFixturesCollision(
      {
        x: x + draggedTable.width / 2, // Convert to center-based coords
        y: y + draggedTable.height / 2,
        width: draggedTable.width,
        height: draggedTable.height,
      },
      fixtureBounds
    )

    // Update collision state for visual feedback
    setIsColliding(collisionResult.collides)

    // Hit test against all tables except the dragged one
    for (const table of tablesRef.current) {
      if (table.id === draggedTableId) continue

      if (
        x >= table.posX &&
        x <= table.posX + table.width &&
        y >= table.posY &&
        y <= table.posY + table.height
      ) {
        updateDragTarget(table.id, { x, y })
        return
      }
    }
    updateDragTarget(null)
  }, [draggedTableId, containerRef, autoScaleRef, autoScaleOffsetRef, tablesRef, fixturesRef, updateDragTarget])

  // Handle pointer up - execute combine if dropped on a target
  const handlePointerUp = useCallback(async () => {
    // Prevent combine if colliding with fixtures
    if (isColliding) {
      logger.warn('[useFloorPlanDrag] Cannot place table - collides with fixture')
      endDrag()
      setLastDropPosition(null)
      setIsColliding(false)
      return
    }

    if (draggedTableId && dropTargetTableId) {
      await onCombine(draggedTableId, dropTargetTableId, lastDropPosition || undefined)
    }
    endDrag()
    setLastDropPosition(null)
    setIsColliding(false)
  }, [draggedTableId, dropTargetTableId, isColliding, onCombine, endDrag, lastDropPosition])

  // Calculate ghost preview position for visual feedback
  const ghostPreview = useMemo((): GhostPreview | null => {
    if (!draggedTableId || !dropTargetTableId || !lastDropPosition) return null

    const tables = tablesRef.current
    const sourceTable = tables.find(t => t.id === draggedTableId)
    const targetTable = tables.find(t => t.id === dropTargetTableId)
    if (!sourceTable || !targetTable) return null

    // If target is part of a combined group, use the combined bounding box
    // This matches what the API does for positioning
    let effectiveTargetRect = {
      id: targetTable.id,
      posX: targetTable.posX,
      posY: targetTable.posY,
      width: targetTable.width,
      height: targetTable.height,
    }

    // Find the primary table if target is combined
    const primaryTableId = targetTable.combinedWithId ||
      (targetTable.combinedTableIds?.length ? targetTable.id : null)

    if (primaryTableId) {
      const primaryTable = tables.find(t => t.id === primaryTableId)
      if (primaryTable) {
        // Calculate combined bounding box
        const combinedIds = primaryTable.combinedTableIds || []
        const allGroupTables = [primaryTable, ...combinedIds.map(id => tables.find(t => t.id === id)).filter(Boolean)] as TableLike[]

        if (allGroupTables.length > 1) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const t of allGroupTables) {
            minX = Math.min(minX, t.posX)
            minY = Math.min(minY, t.posY)
            maxX = Math.max(maxX, t.posX + t.width)
            maxY = Math.max(maxY, t.posY + t.height)
          }
          effectiveTargetRect = {
            id: primaryTableId,
            posX: minX,
            posY: minY,
            width: maxX - minX,
            height: maxY - minY,
          }
        }
      }
    }

    const sourceRect = {
      id: sourceTable.id,
      posX: sourceTable.posX,
      posY: sourceTable.posY,
      width: sourceTable.width,
      height: sourceTable.height,
    }

    const side = calculateAttachSide(lastDropPosition.x, lastDropPosition.y, effectiveTargetRect)
    const position = calculateAttachPosition(sourceRect, effectiveTargetRect, side)

    return {
      ...position,
      width: sourceTable.width,
      height: sourceTable.height,
      side,
    }
  }, [draggedTableId, dropTargetTableId, lastDropPosition, tablesRef])

  return {
    handlePointerMove,
    handlePointerUp,
    ghostPreview,
    lastDropPosition,
    isColliding,
  }
}

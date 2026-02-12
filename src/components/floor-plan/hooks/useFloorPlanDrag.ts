/**
 * useFloorPlanDrag Hook
 *
 * Handles table drag-and-drop in the floor plan.
 *
 * Features:
 * - Pointer move/up handlers for drag operations
 * - Coordinate transformation for auto-scaled floor plans
 * - Ghost preview calculation for visual feedback
 * - Drop target detection with hit testing
 * - Collision detection with fixtures (walls, bar counters, etc.)
 */

import { useState, useCallback, useMemo, useRef, RefObject } from 'react'
import { calculateAttachSide, calculateAttachPosition } from '../table-positioning'
import { checkTableAllFixturesCollision, type FixtureBounds } from '@/domains/floor-plan/shared/collisionDetection'
import { logger } from '@/lib/logger'

interface TableLike {
  id: string
  posX: number
  posY: number
  width: number
  height: number
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
}: UseFloorPlanDragOptions): UseFloorPlanDragResult {
  // Track drop position for ghost preview
  const [lastDropPosition, setLastDropPosition] = useState<{ x: number; y: number } | null>(null)

  // Track collision state for visual feedback
  const [isColliding, setIsColliding] = useState(false)
  // Ref to avoid stale closure in handlePointerUp (React may batch setState)
  const isCollidingRef = useRef(false)

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

    // Update collision state for visual feedback (state for rendering, ref for pointerUp)
    setIsColliding(collisionResult.collides)
    isCollidingRef.current = collisionResult.collides

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

  // Handle pointer up - end drag operation
  const handlePointerUp = useCallback(async () => {
    // Prevent placement if colliding with fixtures (use ref to avoid stale closure)
    if (isCollidingRef.current) {
      logger.warn('[useFloorPlanDrag] Cannot place table - collides with fixture')
    }
    endDrag()
    setLastDropPosition(null)
    setIsColliding(false)
    isCollidingRef.current = false
  }, [endDrag])

  // Calculate ghost preview position for visual feedback
  const ghostPreview = useMemo((): GhostPreview | null => {
    if (!draggedTableId || !dropTargetTableId || !lastDropPosition) return null

    const tables = tablesRef.current
    const sourceTable = tables.find(t => t.id === draggedTableId)
    const targetTable = tables.find(t => t.id === dropTargetTableId)
    if (!sourceTable || !targetTable) return null

    const effectiveTargetRect = {
      id: targetTable.id,
      posX: targetTable.posX,
      posY: targetTable.posY,
      width: targetTable.width,
      height: targetTable.height,
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

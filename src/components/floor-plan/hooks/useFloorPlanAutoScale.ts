/**
 * useFloorPlanAutoScale Hook
 *
 * Handles auto-scaling of the floor plan to fit all tables/elements
 * within the container while maintaining usability.
 *
 * Features:
 * - ResizeObserver for responsive container sizing
 * - Calculates bounding box of all visible tables and elements
 * - Computes scale factor to fit content (min 0.3, max 1.0)
 * - Calculates offset to center scaled content
 */

import { useState, useEffect, useMemo, RefObject } from 'react'

interface TableLike {
  posX: number
  posY: number
  width?: number
  height?: number
  section?: { id: string } | null
}

interface ElementLike {
  posX: number
  posY: number
  width?: number
  height?: number
  sectionId?: string | null
}

interface UseFloorPlanAutoScaleOptions {
  containerRef: RefObject<HTMLDivElement | null>
  tables: TableLike[]
  elements: ElementLike[]
  selectedSectionId: string | null
  padding?: number
  minScale?: number
  maxScale?: number
}

interface AutoScaleResult {
  containerSize: { width: number; height: number }
  tableBounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    width: number
    height: number
  } | null
  autoScale: number
  autoScaleOffset: { x: number; y: number }
}

export function useFloorPlanAutoScale({
  containerRef,
  tables,
  elements,
  selectedSectionId,
  padding = 60,
  minScale = 0.3,
  maxScale = 1,
}: UseFloorPlanAutoScaleOptions): AutoScaleResult {
  // Container size state
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // Measure container size with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ width, height })
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [containerRef])

  // Calculate bounding box of all visible tables and elements
  const tableBounds = useMemo(() => {
    // Filter tables by selected section
    const visibleTables = selectedSectionId === null
      ? tables
      : tables.filter(t => t.section?.id === selectedSectionId)

    // Filter elements by selected section
    const visibleElements = selectedSectionId === null
      ? elements
      : elements.filter(e => e.sectionId === selectedSectionId || e.sectionId === null)

    if (visibleTables.length === 0 && visibleElements.length === 0) return null

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    visibleTables.forEach(table => {
      minX = Math.min(minX, table.posX)
      minY = Math.min(minY, table.posY)
      maxX = Math.max(maxX, table.posX + (table.width || 100))
      maxY = Math.max(maxY, table.posY + (table.height || 100))
    })

    // Also consider entertainment elements
    visibleElements.forEach(element => {
      minX = Math.min(minX, element.posX)
      minY = Math.min(minY, element.posY)
      maxX = Math.max(maxX, element.posX + (element.width || 100))
      maxY = Math.max(maxY, element.posY + (element.height || 100))
    })

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }, [tables, elements, selectedSectionId])

  // Calculate scale factor to fit all tables in container
  const autoScale = useMemo(() => {
    if (!tableBounds || containerSize.width === 0 || containerSize.height === 0) {
      return 1
    }

    const availableWidth = containerSize.width - padding * 2
    const availableHeight = containerSize.height - padding * 2

    // Only scale down if content is larger than container
    if (tableBounds.width <= availableWidth && tableBounds.height <= availableHeight) {
      return 1
    }

    const scaleX = availableWidth / tableBounds.width
    const scaleY = availableHeight / tableBounds.height

    // Use smaller scale to fit both dimensions
    // Cap between minScale and maxScale
    return Math.max(minScale, Math.min(scaleX, scaleY, maxScale))
  }, [tableBounds, containerSize, padding, minScale, maxScale])

  // Calculate offset to center the scaled content
  const autoScaleOffset = useMemo(() => {
    if (!tableBounds || autoScale === 1) {
      return { x: 0, y: 0 }
    }

    const scaledWidth = tableBounds.width * autoScale
    const scaledHeight = tableBounds.height * autoScale

    // Center the content, accounting for the minX/minY offset
    const offsetX = (containerSize.width - scaledWidth) / 2 - tableBounds.minX * autoScale
    const offsetY = (containerSize.height - scaledHeight) / 2 - tableBounds.minY * autoScale

    return { x: offsetX, y: offsetY }
  }, [tableBounds, autoScale, containerSize])

  return {
    containerSize,
    tableBounds,
    autoScale,
    autoScaleOffset,
  }
}

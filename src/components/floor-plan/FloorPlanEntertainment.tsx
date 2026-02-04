'use client'

import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { EntertainmentVisual } from './entertainment-visuals'
import type { FloorPlanElement, ElementStatus } from './use-floor-plan'

interface FloorPlanEntertainmentProps {
  element: FloorPlanElement
  isSelected: boolean
  mode: 'admin' | 'service'
  onSelect: () => void
  onPositionChange?: (posX: number, posY: number) => void
  onSizeChange?: (width: number, height: number) => void
  onRotationChange?: (rotation: number) => void
  onDelete?: () => void
}

// Status colors for the glow effect
const STATUS_COLORS: Record<ElementStatus, string> = {
  available: '#22c55e', // green
  in_use: '#f59e0b', // amber
  reserved: '#6366f1', // indigo
  maintenance: '#ef4444', // red
}

export function FloorPlanEntertainment({
  element,
  isSelected,
  mode,
  onSelect,
  onPositionChange,
  onSizeChange,
  onRotationChange,
  onDelete,
}: FloorPlanEntertainmentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 })

  // Calculate time remaining for sessions
  const getTimeRemaining = useCallback(() => {
    if (!element.sessionExpiresAt) return null
    const expiresAt = new Date(element.sessionExpiresAt).getTime()
    const now = Date.now()
    const remaining = expiresAt - now
    if (remaining <= 0) return 'EXPIRED'
    const minutes = Math.floor(remaining / 60000)
    const seconds = Math.floor((remaining % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }, [element.sessionExpiresAt])

  // Handle resize start
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, corner: string) => {
      if (mode !== 'admin') return
      e.stopPropagation()
      e.preventDefault()
      setIsResizing(true)
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: element.width,
        height: element.height,
      })

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - e.clientX
        const deltaY = moveEvent.clientY - e.clientY

        let newWidth = resizeStart.width
        let newHeight = resizeStart.height

        if (corner.includes('e')) newWidth = Math.max(60, element.width + deltaX)
        if (corner.includes('w')) newWidth = Math.max(60, element.width - deltaX)
        if (corner.includes('s')) newHeight = Math.max(60, element.height + deltaY)
        if (corner.includes('n')) newHeight = Math.max(60, element.height - deltaY)

        onSizeChange?.(newWidth, newHeight)
      }

      const handleMouseUp = () => {
        setIsResizing(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [mode, element.width, element.height, onSizeChange, resizeStart.width, resizeStart.height]
  )

  // Handle rotation start
  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'admin' || !containerRef.current) return
      e.stopPropagation()
      e.preventDefault()
      setIsRotating(true)

      // Get center of element
      const rect = containerRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      // Track last valid angle to prevent jumps
      let lastValidAngle = element.rotation || 0

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - centerX
        const dy = moveEvent.clientY - centerY
        const distance = Math.sqrt(dx * dx + dy * dy)

        // Only rotate if mouse is at least 30px from center
        // This prevents hyper-sensitive rotation when close to center
        const minRadius = 30
        if (distance < minRadius) return

        // Calculate angle from center to mouse position
        const angle = Math.atan2(dy, dx)
        // Convert to degrees and adjust (handle is at top, so offset by +90)
        let degrees = (angle * 180) / Math.PI + 90
        // Normalize to 0-360
        if (degrees < 0) degrees += 360

        // Snap to 15-degree increments for easier alignment
        const snappedDegrees = Math.round(degrees / 15) * 15
        lastValidAngle = snappedDegrees % 360
        onRotationChange?.(lastValidAngle)
      }

      const handleMouseUp = () => {
        setIsRotating(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [mode, onRotationChange, element.rotation]
  )

  const status = element.status as ElementStatus
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.available
  const timeRemaining = getTimeRemaining()

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      style={{
        width: element.width,
        height: element.height,
        position: 'relative',
        cursor: mode === 'admin' ? 'grab' : 'pointer',
      }}
    >
      {/* Glow effect based on status */}
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: 12,
          opacity: isSelected ? 0.6 : 0.3,
          background: `radial-gradient(ellipse at center, ${statusColor}40 0%, transparent 70%)`,
          transition: 'opacity 0.2s',
          pointerEvents: 'none',
        }}
      />

      {/* Selection ring */}
      {isSelected && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 10,
            border: '2px solid rgba(99, 102, 241, 0.8)',
            boxShadow: '0 0 12px rgba(99, 102, 241, 0.4)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Main visual container */}
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          background: 'rgba(15, 23, 42, 0.8)',
          border: `1px solid ${isSelected ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
          overflow: 'hidden',
          transition: 'border-color 0.2s',
        }}
      >
        {/* SVG Visual - rotates independently */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            transform: `rotate(${element.rotation || 0}deg)`,
            transition: 'transform 0.15s ease-out',
          }}
        >
          <EntertainmentVisual
            visualType={element.visualType as any}
            width={element.width - 16}
            height={element.height - 40}
            status={status}
          />
        </div>

        {/* Label - stays fixed at bottom */}
        <div
          style={{
            width: '100%',
            padding: '4px 8px',
            background: 'rgba(0, 0, 0, 0.4)',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#e2e8f0',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {element.abbreviation || element.name}
          </span>
        </div>
      </div>

      {/* Status badge */}
      <div
        style={{
          position: 'absolute',
          top: -8,
          right: -8,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: statusColor,
          border: '2px solid rgba(15, 23, 42, 0.9)',
          boxShadow: `0 0 8px ${statusColor}60`,
        }}
      />

      {/* Time remaining badge (for in_use status) */}
      {status === 'in_use' && timeRemaining && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2px 8px',
            borderRadius: 8,
            background: timeRemaining === 'EXPIRED' ? '#ef4444' : '#f59e0b',
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          }}
        >
          {timeRemaining}
        </div>
      )}

      {/* Waitlist badge */}
      {element.waitlistCount > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            right: -6,
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            background: '#6366f1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            padding: '0 6px',
            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)',
          }}
        >
          {element.waitlistCount}
        </div>
      )}

      {/* Resize handles (admin mode only) */}
      {mode === 'admin' && isSelected && (
        <>
          {/* Corner handles */}
          {['nw', 'ne', 'sw', 'se'].map((corner) => (
            <div
              key={corner}
              onMouseDown={(e) => handleResizeStart(e, corner)}
              style={{
                position: 'absolute',
                width: 10,
                height: 10,
                background: '#6366f1',
                border: '2px solid #fff',
                borderRadius: 2,
                cursor: `${corner}-resize`,
                ...(corner.includes('n') ? { top: -5 } : { bottom: -5 }),
                ...(corner.includes('w') ? { left: -5 } : { right: -5 }),
              }}
            />
          ))}

          {/* Rotation handle */}
          {onRotationChange && (
            <>
              {/* Line from center-top to rotation handle - extended for easier grabbing */}
              <div
                style={{
                  position: 'absolute',
                  top: -48,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 2,
                  height: 40,
                  background: 'rgba(99, 102, 241, 0.6)',
                  pointerEvents: 'none',
                }}
              />
              {/* Rotation handle circle - larger and further out */}
              <div
                onMouseDown={handleRotateStart}
                style={{
                  position: 'absolute',
                  top: -62,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: isRotating ? '#818cf8' : '#6366f1',
                  border: '2px solid #fff',
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)',
                  transition: 'background 0.15s',
                }}
              >
                {/* Rotation icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </>
          )}

          {/* Delete button */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm('Delete this element?')) {
                  onDelete()
                }
              }}
              style={{
                position: 'absolute',
                top: -12,
                left: -12,
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: '#ef4444',
                border: '2px solid #fff',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
              }}
            >
              ×
            </button>
          )}
        </>
      )}
    </div>
  )
}

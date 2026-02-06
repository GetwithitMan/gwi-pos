'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface SignatureCaptureProps {
  onCapture: (signatureData: string) => void  // Base64 PNG
  onSkip?: () => void
  width?: number
  height?: number
  lineColor?: string
  lineWidth?: number
}

/**
 * POS-screen signature capture canvas.
 * Supports touch and mouse drawing. Returns base64 PNG data URL.
 * Used for chargeback defense when reader doesn't support GetSignature.
 */
export function SignatureCapture({
  onCapture,
  onSkip,
  width = 400,
  height = 200,
  lineColor = '#000000',
  lineWidth = 2,
}: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set up canvas with white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    // Draw signature line
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(20, height - 40)
    ctx.lineTo(width - 20, height - 40)
    ctx.stroke()

    // Draw "X" mark
    ctx.fillStyle = '#9ca3af'
    ctx.font = '14px sans-serif'
    ctx.fillText('X', 20, height - 45)
  }, [width, height])

  const getPoint = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    if ('touches' in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  const startDrawing = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    const point = getPoint(e)
    if (!point) return

    setIsDrawing(true)
    setHasDrawn(true)
    lastPoint.current = point
  }, [getPoint])

  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    if (!isDrawing) return

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !lastPoint.current) return

    const point = getPoint(e)
    if (!point) return

    ctx.strokeStyle = lineColor
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()

    lastPoint.current = point
  }, [isDrawing, getPoint, lineColor, lineWidth])

  const stopDrawing = useCallback(() => {
    setIsDrawing(false)
    lastPoint.current = null
  }, [])

  const handleClear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    // Redraw signature line
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(20, height - 40)
    ctx.lineTo(width - 20, height - 40)
    ctx.stroke()

    ctx.fillStyle = '#9ca3af'
    ctx.font = '14px sans-serif'
    ctx.fillText('X', 20, height - 45)

    setHasDrawn(false)
  }

  const handleAccept = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dataUrl = canvas.toDataURL('image/png')
    onCapture(dataUrl)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm font-medium text-gray-700">Please sign below</p>

      <div className="border-2 border-gray-300 rounded-lg overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width: `${width}px`, height: `${height}px` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>

      <div className="flex gap-2">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button variant="ghost" onClick={handleClear} disabled={!hasDrawn}>
          Clear
        </Button>
        <Button variant="primary" onClick={handleAccept} disabled={!hasDrawn}>
          Accept Signature
        </Button>
      </div>
    </div>
  )
}

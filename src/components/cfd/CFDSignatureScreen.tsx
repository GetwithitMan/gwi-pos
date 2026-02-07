'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import type { CFDSignatureRequestEvent } from '@/types/multi-surface'

interface CFDSignatureScreenProps {
  data: CFDSignatureRequestEvent | null
  onSignatureDone: (signatureBase64: string) => void
}

export default function CFDSignatureScreen({ data, onSignatureDone }: CFDSignatureScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = canvas.offsetWidth * 2
    canvas.height = canvas.offsetHeight * 2
    ctx.scale(2, 2)

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

    // Signature line
    ctx.strokeStyle = '#cccccc'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(40, canvas.offsetHeight - 60)
    ctx.lineTo(canvas.offsetWidth - 40, canvas.offsetHeight - 60)
    ctx.stroke()

    // X mark
    ctx.fillStyle = '#999999'
    ctx.font = '24px sans-serif'
    ctx.fillText('X', 20, canvas.offsetHeight - 65)

    // Set drawing style
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }, [])

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
    setHasSignature(true)
  }

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

    ctx.strokeStyle = '#cccccc'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(40, canvas.offsetHeight - 60)
    ctx.lineTo(canvas.offsetWidth - 40, canvas.offsetHeight - 60)
    ctx.stroke()

    ctx.fillStyle = '#999999'
    ctx.font = '24px sans-serif'
    ctx.fillText('X', 20, canvas.offsetHeight - 65)

    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    setHasSignature(false)
  }

  const handleAccept = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const signatureBase64 = canvas.toDataURL('image/png')
    onSignatureDone(signatureBase64)
  }

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-8">
      <div className="text-center mb-6">
        <h2 className="text-2xl text-white/80">Please Sign Below</h2>
        {data && (
          <p className="text-white/40 mt-1">
            Amount: ${data.amount.toFixed(2)} • Card: ...{data.cardLast4}
          </p>
        )}
      </div>

      {/* Signature canvas */}
      <div className="flex-1 max-w-2xl mx-auto w-full rounded-2xl overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-center gap-4 mt-6">
        <button
          onClick={handleClear}
          className="px-8 py-4 text-white/50 text-lg hover:text-white/70 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={handleAccept}
          disabled={!hasSignature}
          className={`px-8 py-4 rounded-2xl text-lg font-medium transition-colors
            ${hasSignature
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
        >
          Accept
        </button>
      </div>
    </div>
  )
}

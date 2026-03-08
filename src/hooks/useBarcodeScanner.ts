'use client'

import { useEffect, useRef, useCallback } from 'react'

interface UseBarcodeScannerOptions {
  /** Called when a complete barcode is detected */
  onScan: (barcode: string) => void
  /** Whether scanning is active (default: true) */
  enabled?: boolean
  /** Max time between keystrokes to count as scanner input, in ms (default: 50) */
  maxKeystrokeGap?: number
  /** Minimum barcode length to accept (default: 4) */
  minLength?: number
}

/**
 * Detects USB/Bluetooth barcode scanner input on the web POS.
 *
 * USB barcode scanners act as keyboard input — they "type" barcode digits
 * followed by Enter, very rapidly (< 50ms between keystrokes). This hook
 * distinguishes scanner input from human typing by keystroke timing.
 *
 * Works even when an input field is focused — the speed threshold (12+ chars
 * in < 600ms) is impossible for human typists to hit.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  maxKeystrokeGap = 50,
  minLength = 4,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef('')
  const lastKeystrokeRef = useRef(0)
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const resetBuffer = useCallback(() => {
    bufferRef.current = ''
    if (clearTimeoutRef.current) {
      clearTimeout(clearTimeoutRef.current)
      clearTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now()
      const gap = now - lastKeystrokeRef.current
      lastKeystrokeRef.current = now

      // Enter key — check if we have a valid barcode in the buffer
      if (e.key === 'Enter') {
        const barcode = bufferRef.current
        if (barcode.length >= minLength) {
          e.preventDefault()
          e.stopPropagation()

          // If scan happened into an input, clear the input's value
          const target = e.target as HTMLElement
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            // Remove the scanned characters from the input value
            const currentVal = target.value
            if (currentVal.endsWith(barcode)) {
              target.value = currentVal.slice(0, -barcode.length)
              // Trigger React's onChange by dispatching an input event
              target.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }

          onScanRef.current(barcode)
        }
        resetBuffer()
        return
      }

      // Only accumulate alphanumeric characters and hyphens
      if (e.key.length !== 1 || !/[a-zA-Z0-9\-]/.test(e.key)) {
        return
      }

      // If gap is too long, this is a new sequence — reset buffer
      if (gap > maxKeystrokeGap && bufferRef.current.length > 0) {
        bufferRef.current = ''
      }

      bufferRef.current += e.key

      // Auto-clear buffer if no Enter comes within 200ms of last keystroke
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current)
      }
      clearTimeoutRef.current = setTimeout(() => {
        bufferRef.current = ''
        clearTimeoutRef.current = null
      }, 200)
    }

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
      resetBuffer()
    }
  }, [enabled, maxKeystrokeGap, minLength, resetBuffer])
}

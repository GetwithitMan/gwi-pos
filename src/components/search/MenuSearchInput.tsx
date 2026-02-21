'use client'

import { useRef, useEffect } from 'react'

// Scanner heuristics
const SCANNER_KEY_INTERVAL_MS = 100  // keys arriving faster than this are scanner input
const SCANNER_RESET_GAP_MS = 500     // gap longer than this resets the buffer
const SCANNER_MIN_LENGTH = 3         // minimum chars to treat as a valid SKU scan

interface MenuSearchInputProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder?: string
  isSearching?: boolean
  className?: string
  autoFocus?: boolean
  onScanComplete?: (sku: string) => void
}

export function MenuSearchInput({
  value,
  onChange,
  onClear,
  placeholder = 'Search menu...',
  isSearching = false,
  className = '',
  autoFocus = false,
  onScanComplete,
}: MenuSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const scanBuffer = useRef('')
  const lastKeyTime = useRef(0)

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus])

  // Global keydown listener for keyboard-wedge barcode scanners.
  // Scanners send digits rapidly (<100ms apart) then fire Enter.
  // When Enter fires with a buffer of 3+ chars and the input is NOT focused,
  // treat it as a scan and fire onScanComplete.
  useEffect(() => {
    if (!onScanComplete) return

    const handler = (e: KeyboardEvent) => {
      const now = Date.now()
      const gap = now - lastKeyTime.current

      // Long gap since last key — not a scanner burst, reset buffer
      if (gap > SCANNER_RESET_GAP_MS && lastKeyTime.current !== 0) {
        scanBuffer.current = ''
      }

      lastKeyTime.current = now

      // If Enter is pressed
      if (e.key === 'Enter') {
        const inputFocused = document.activeElement === inputRef.current
        if (!inputFocused && scanBuffer.current.length >= SCANNER_MIN_LENGTH) {
          // Fast-burst chars accumulated — treat as scan
          e.preventDefault()
          const sku = scanBuffer.current
          scanBuffer.current = ''
          onScanComplete(sku)
        } else {
          // Input is focused or buffer too short — let Enter propagate normally
          scanBuffer.current = ''
        }
        return
      }

      // Only accumulate printable single chars that arrived quickly (scanner burst)
      if (e.key.length === 1 && gap < SCANNER_KEY_INTERVAL_MS) {
        const inputFocused = document.activeElement === inputRef.current
        if (!inputFocused) {
          scanBuffer.current += e.key
        }
      } else if (e.key.length === 1) {
        // Slow keystroke (human typing) — reset buffer
        scanBuffer.current = ''
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onScanComplete])

  return (
    <div className={`relative flex items-center ${className}`}>
      {/* Search Icon / Spinner */}
      <div className="absolute left-3 text-gray-400">
        {isSearching ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-10 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      {value && (
        <button
          onClick={onClear}
          className="absolute right-3 text-gray-400 hover:text-white transition-colors"
          aria-label="Clear search"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

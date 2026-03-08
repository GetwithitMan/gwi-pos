'use client'

import { useState, useRef, useCallback } from 'react'
import { toast } from '@/stores/toast-store'

interface BarcodeLookupResult {
  barcode: string
  label: string | null
  packSize: number
  price: number | null
  menuItem: { id: string; name: string; price: number } | null
  inventoryItem: { id: string; name: string; currentStock: number } | null
  source: 'barcode' | 'sku'
}

interface BarcodeScanFieldProps {
  locationId: string
  onResult: (result: BarcodeLookupResult) => void
  placeholder?: string
  autoFocus?: boolean
}

export function BarcodeScanField({
  locationId,
  onResult,
  placeholder = 'Scan or enter barcode...',
  autoFocus = false,
}: BarcodeScanFieldProps) {
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleLookup = useCallback(async () => {
    const trimmed = code.trim()
    if (!trimmed) return

    setIsLoading(true)
    setNotFound(false)

    try {
      const params = new URLSearchParams({ code: trimmed, locationId })
      const res = await fetch(`/api/barcode/lookup?${params}`)

      if (!res.ok) {
        toast.error('Barcode lookup failed')
        return
      }

      const json = await res.json()

      if (!json.data) {
        setNotFound(true)
        return
      }

      onResult(json.data)
      setCode('')
      setNotFound(false)
      // Refocus for rapid scanning
      inputRef.current?.focus()
    } catch {
      toast.error('Barcode lookup failed')
    } finally {
      setIsLoading(false)
    }
  }, [code, locationId, onResult])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleLookup()
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={code}
          onChange={(e) => { setCode(e.target.value); setNotFound(false) }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`w-full border rounded px-3 py-2 text-sm pr-8 ${
            notFound ? 'border-red-300 bg-red-50' : ''
          }`}
          disabled={isLoading}
        />
        {isLoading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleLookup}
        disabled={isLoading || !code.trim()}
        className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        Lookup
      </button>
      {notFound && (
        <span className="text-xs text-red-600 whitespace-nowrap">Not found</span>
      )}
    </div>
  )
}

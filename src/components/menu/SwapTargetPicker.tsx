'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { SwapTarget } from './item-editor-types'
import { Input } from '@/components/ui/input'
import { formatCurrency, cn } from '@/lib/utils'

interface SwapTargetPickerProps {
  targets: SwapTarget[]
  onChange: (targets: SwapTarget[]) => void
  menuItemId: string
}

interface SearchResult {
  id: string
  name: string
  price: number
}

export function SwapTargetPicker({ targets, onChange, menuItemId }: SwapTargetPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setShowDropdown(false)
      return
    }
    setIsSearching(true)
    try {
      const res = await fetch(`/api/menu/items?q=${encodeURIComponent(q)}&limit=10`)
      if (res.ok) {
        const data = await res.json()
        // Filter out current item
        const filtered = (data as SearchResult[]).filter((item) => item.id !== menuItemId)
        setResults(filtered)
        setShowDropdown(filtered.length > 0)
      }
    } catch {
      // silent
    } finally {
      setIsSearching(false)
    }
  }, [menuItemId])

  function handleQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  function addTarget(item: SearchResult) {
    // Skip if already in targets
    if (targets.some((t) => t.menuItemId === item.id)) return
    const newTarget: SwapTarget = {
      menuItemId: item.id,
      name: item.name,
      snapshotPrice: item.price,
      pricingMode: 'target_price',
      fixedPrice: null,
      sortOrder: targets.length,
    }
    onChange([...targets, newTarget])
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  function removeTarget(menuItemId: string) {
    const filtered = targets
      .filter((t) => t.menuItemId !== menuItemId)
      .map((t, i) => ({ ...t, sortOrder: i }))
    onChange(filtered)
  }

  function updateTarget(menuItemId: string, updates: Partial<SwapTarget>) {
    onChange(targets.map((t) => (t.menuItemId === menuItemId ? { ...t, ...updates } : t)))
  }

  function moveTarget(index: number, direction: -1 | 1) {
    const swapIndex = index + direction
    if (swapIndex < 0 || swapIndex >= targets.length) return
    const reordered = [...targets]
    const temp = reordered[index]
    reordered[index] = reordered[swapIndex]
    reordered[swapIndex] = temp
    // Normalize sortOrder
    onChange(reordered.map((t, i) => ({ ...t, sortOrder: i })))
  }

  const pricingModes: { value: SwapTarget['pricingMode']; label: string }[] = [
    { value: 'target_price', label: 'Item Price' },
    { value: 'fixed_price', label: 'Fixed' },
    { value: 'no_charge', label: 'Free' },
  ]

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative" ref={dropdownRef}>
        <Input
          placeholder="Search menu items to add as swap targets..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          </div>
        )}

        {/* Search results dropdown */}
        {showDropdown && results.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {results.map((item) => {
              const alreadyAdded = targets.some((t) => t.menuItemId === item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={alreadyAdded}
                  onClick={() => addTarget(item)}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                    alreadyAdded
                      ? 'cursor-not-allowed bg-gray-50 text-gray-400'
                      : 'hover:bg-blue-50 cursor-pointer'
                  )}
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-gray-500">{formatCurrency(item.price)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Warning banner */}
      {targets.length > 10 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          More than 10 swap targets — consider reducing for POS usability
        </div>
      )}

      {/* Selected targets list */}
      {targets.length > 0 && (
        <div className="space-y-2">
          {targets.map((target, index) => (
            <div
              key={target.menuItemId}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                {/* Name + price */}
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-sm text-gray-900">{target.name}</span>
                  <span className="ml-2 text-xs text-gray-400">{formatCurrency(target.snapshotPrice)}</span>
                </div>

                {/* Reorder + remove buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveTarget(index, -1)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Move up"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={index === targets.length - 1}
                    onClick={() => moveTarget(index, 1)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Move down"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTarget(target.menuItemId)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="Remove"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Pricing mode selector */}
              <div className="mt-2 flex items-center gap-1">
                {pricingModes.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => {
                      const updates: Partial<SwapTarget> = { pricingMode: mode.value }
                      if (mode.value !== 'fixed_price') updates.fixedPrice = null
                      updateTarget(target.menuItemId, updates)
                    }}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      target.pricingMode === mode.value
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    )}
                  >
                    {mode.label}
                  </button>
                ))}

                {/* Fixed price input */}
                {target.pricingMode === 'fixed_price' && (
                  <div className="ml-2 flex items-center gap-1">
                    <span className="text-xs text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={target.fixedPrice ?? ''}
                      onChange={(e) =>
                        updateTarget(target.menuItemId, {
                          fixedPrice: e.target.value === '' ? null : parseFloat(e.target.value),
                        })
                      }
                      placeholder="0.00"
                      className="w-20 rounded border border-gray-300 px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {targets.length === 0 && (
        <p className="text-xs text-gray-400">No swap targets added. Search above to add menu items.</p>
      )}
    </div>
  )
}

'use client'

/**
 * MenuSearch — Real-time client-side search for menu items.
 *
 * Debounced text input that filters items by name/description.
 * Uses CSS variables from site-theme.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

interface MenuSearchProps {
  onSearch: (query: string) => void
}

export function MenuSearch({ onSearch }: MenuSearchProps) {
  const [value, setValue] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setValue(v)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onSearch(v), 200)
    },
    [onSearch]
  )

  const handleClear = useCallback(() => {
    setValue('')
    onSearch('')
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [onSearch])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className="relative">
      {/* Search icon */}
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 pointer-events-none"
        style={{ color: 'var(--site-text-muted)' }}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>

      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Search menu..."
        className="w-full pl-10 pr-10 py-3 text-sm outline-none transition-shadow focus:ring-2"
        style={{
          backgroundColor: 'var(--site-bg-secondary)',
          color: 'var(--site-text)',
          borderRadius: 'var(--site-border-radius)',
          border: '1px solid var(--site-border)',
        }}
        aria-label="Search menu items"
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full transition-opacity hover:opacity-70"
          style={{ color: 'var(--site-text-muted)' }}
          aria-label="Clear search"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

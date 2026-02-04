'use client'

import { useEffect, useRef } from 'react'

// Inline SVG icons
const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="16" height="16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
)

const StarOffIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18M12 2l1.5 3.05M22 9.27l-4.91.71M18 14.14l1.18 6.88L12 17.77M5.82 21.02L7 14.14 2 9.27l5.59-.81"/>
  </svg>
)

const PaletteIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.1 0 2-.9 2-2 0-.51-.19-.99-.52-1.35-.31-.34-.48-.79-.48-1.25 0-1.1.9-2 2-2h2.36c2.81 0 5.09-2.28 5.09-5.09C21.54 5.79 17.21 2 12 2zm-5.5 10c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
  </svg>
)

const SparklesIcon = () => (
  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l1.5 4.5L19 9l-4.5 1.5L13 15l-1.5-4.5L7 9l4.5-1.5L13 3z"/>
  </svg>
)

interface MenuItemContextMenuProps {
  x: number
  y: number
  itemId: string
  itemName: string
  isInQuickBar: boolean
  onClose: () => void
  onAddToQuickBar: () => void
  onRemoveFromQuickBar: () => void
  onCustomizeColor?: () => void
}

export function MenuItemContextMenu({
  x,
  y,
  itemName,
  isInQuickBar,
  onClose,
  onAddToQuickBar,
  onRemoveFromQuickBar,
  onCustomizeColor,
}: MenuItemContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Adjust horizontal position
      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${viewportWidth - rect.width - 8}px`
      }

      // Adjust vertical position
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${viewportHeight - rect.height - 8}px`
      }
    }
  }, [x, y])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // Delay to prevent immediate close from the same click
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] py-2 rounded-lg shadow-xl
        bg-zinc-800/95 backdrop-blur-sm border border-white/10"
      style={{ left: x, top: y }}
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-white/10 mb-1">
        <p className="text-xs text-white/50 truncate max-w-[180px]">{itemName}</p>
      </div>

      {/* Quick Bar Action */}
      {isInQuickBar ? (
        <button
          onClick={() => {
            onRemoveFromQuickBar()
            onClose()
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm
            hover:bg-white/10 transition-colors text-amber-400"
        >
          <StarOffIcon />
          <span>Remove from Quick Bar</span>
        </button>
      ) : (
        <button
          onClick={() => {
            onAddToQuickBar()
            onClose()
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm
            hover:bg-white/10 transition-colors text-amber-400"
        >
          <StarIcon filled />
          <span>Add to Quick Bar</span>
        </button>
      )}

      {/* Customize Color */}
      {onCustomizeColor && (
        <button
          onClick={() => {
            onCustomizeColor()
            onClose()
          }}
          className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm
            hover:bg-white/10 transition-colors text-purple-400"
        >
          <PaletteIcon />
          <span>Customize Color</span>
        </button>
      )}

      {/* Pop Effect hint */}
      <div className="mt-1 pt-1 border-t border-white/10">
        <div className="px-3 py-1 flex items-center gap-2 text-xs text-white/30">
          <SparklesIcon />
          <span>Use Gear menu for pop effects</span>
        </div>
      </div>
    </div>
  )
}

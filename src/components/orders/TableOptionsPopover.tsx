'use client'

import { useEffect, useRef } from 'react'

interface TableOptionsPopoverProps {
  isOpen: boolean
  onClose: () => void
  tableName: string
  coursingEnabled: boolean
  onCoursingToggle: (enabled: boolean) => void
  guestCount: number
  onGuestCountChange: (count: number) => void
}

/**
 * Small dark popover that appears when user taps the table name in the header.
 * Provides quick access to coursing toggle and guest count.
 */
export function TableOptionsPopover({
  isOpen,
  onClose,
  tableName,
  coursingEnabled,
  onCoursingToggle,
  guestCount,
  onGuestCountChange,
}: TableOptionsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: '6px',
        minWidth: '240px',
        background: 'rgba(15, 23, 42, 0.98)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '16px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        backdropFilter: 'blur(12px)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Title */}
      <div style={{
        fontSize: '12px',
        fontWeight: 700,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '14px',
      }}>
        {tableName} Options
      </div>

      {/* Coursing Toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px',
      }}>
        <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500 }}>
          Enable Coursing
        </span>
        <button
          onClick={() => onCoursingToggle(!coursingEnabled)}
          style={{
            width: '44px',
            height: '24px',
            borderRadius: '12px',
            border: 'none',
            background: coursingEnabled
              ? 'rgba(99, 102, 241, 0.8)'
              : 'rgba(255, 255, 255, 0.1)',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background 0.2s ease',
          }}
        >
          <div style={{
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: '3px',
            left: coursingEnabled ? '23px' : '3px',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          }} />
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '10px 0' }} />

      {/* Guest Count */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500 }}>
          Guests
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => onGuestCountChange(Math.max(1, guestCount - 1))}
            disabled={guestCount <= 1}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: guestCount <= 1 ? '#334155' : '#e2e8f0',
              cursor: guestCount <= 1 ? 'default' : 'pointer',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            -
          </button>
          <span style={{
            fontSize: '16px',
            fontWeight: 600,
            color: '#f1f5f9',
            minWidth: '24px',
            textAlign: 'center',
          }}>
            {guestCount}
          </span>
          <button
            onClick={() => onGuestCountChange(guestCount + 1)}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Done Button */}
      <button
        onClick={onClose}
        style={{
          width: '100%',
          marginTop: '14px',
          padding: '8px',
          borderRadius: '8px',
          border: 'none',
          background: 'rgba(99, 102, 241, 0.2)',
          color: '#a5b4fc',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.35)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)'}
      >
        Done
      </button>
    </div>
  )
}

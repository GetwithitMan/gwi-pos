'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { StockBadge } from '@/components/menu/StockBadge'

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  categoryId: string
  categoryType?: string
  hasModifiers?: boolean
  isPizza?: boolean
  itemType?: string
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | 'reserved' | null
  blockTimeMinutes?: number | null
  modifierGroupCount?: number
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
    minimum?: number
  }
  stockStatus?: 'ok' | 'low' | 'critical' | 'out'
  stockCount?: number | null
  stockIngredientName?: string | null
  is86d?: boolean
  reasons86d?: string[]
}

export interface FloorPlanMenuItemProps {
  item: MenuItem
  customStyle?: { bgColor?: string | null; textColor?: string | null } | null
  inQuickBar: boolean
  pricing: { isDualPricingEnabled: boolean; cashDiscountRate: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTap: (item: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onContextMenu: (e: React.MouseEvent, item: any) => void
  onUnavailable: (reason: string) => void
}

export const FloorPlanMenuItem = memo(function FloorPlanMenuItem({ item, customStyle, inQuickBar, pricing, onTap, onContextMenu, onUnavailable }: FloorPlanMenuItemProps) {
  const isItem86d = item.is86d || item.stockStatus === 'out'
  const bgColor = isItem86d
    ? 'rgba(100, 100, 100, 0.3)'
    : (customStyle?.bgColor || 'rgba(255, 255, 255, 0.05)')
  const textColor = isItem86d
    ? '#6b7280'
    : (customStyle?.textColor || '#e2e8f0')

  return (
    <motion.button
      onClick={() => {
        if (isItem86d) {
          const reason = item.reasons86d?.length
            ? `${item.name} is unavailable - ${item.reasons86d.join(', ')} is out`
            : item.stockIngredientName
              ? `${item.name} is unavailable - ${item.stockIngredientName} is out`
              : `${item.name} is currently unavailable`
          onUnavailable(reason)
        } else {
          onTap(item)
        }
      }}
      onContextMenu={(e) => onContextMenu(e, item)}
      whileHover={isItem86d ? {} : { scale: 1.02, y: -2 }}
      whileTap={isItem86d ? {} : { scale: 0.98 }}
      className={inQuickBar ? 'ring-2 ring-amber-400/50' : ''}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
        background: bgColor,
        backdropFilter: isItem86d ? undefined : 'blur(12px)',
        WebkitBackdropFilter: isItem86d ? undefined : 'blur(12px)',
        border: `1px solid ${isItem86d ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.12)'}`,
        boxShadow: isItem86d ? undefined : '0 4px 12px rgba(0, 0, 0, 0.3)',
        borderRadius: '14px',
        cursor: isItem86d ? 'not-allowed' : 'pointer',
        minHeight: '110px',
        transition: 'all 0.15s ease',
        position: 'relative',
        opacity: isItem86d ? 0.6 : 1,
      }}
      onMouseOver={(e) => {
        if (!isItem86d) {
          if (!customStyle?.bgColor) {
            e.currentTarget.style.background = 'rgba(99, 102, 241, 0.18)'
          }
          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'
          e.currentTarget.style.boxShadow = '0 8px 20px rgba(99, 102, 241, 0.2)'
        }
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = bgColor
        e.currentTarget.style.borderColor = isItem86d
          ? 'rgba(239, 68, 68, 0.3)'
          : 'rgba(255, 255, 255, 0.12)'
        e.currentTarget.style.boxShadow = isItem86d ? '' : '0 4px 12px rgba(0, 0, 0, 0.3)'
      }}
    >
      {/* Quick bar indicator */}
      {inQuickBar && !isItem86d && (
        <span className="absolute top-1 left-1 text-amber-400 z-10">
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </span>
      )}
      {/* 86 badge - ingredient-level */}
      {item.is86d && (
        <span
          className="absolute top-1 right-1 px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded z-10"
          title={item.reasons86d?.length
            ? `Out: ${item.reasons86d.join(', ')}`
            : 'Out of stock'}
        >
          86
        </span>
      )}
      {/* Prep stock status badge (low/critical/out) */}
      {!item.is86d && item.stockStatus && (
        <StockBadge
          status={item.stockStatus}
          count={item.stockCount}
          ingredientName={item.stockIngredientName}
        />
      )}
      {/* Striped overlay for 86'd items */}
      {isItem86d && (
        <div
          className="absolute inset-0 rounded-[14px] pointer-events-none"
          style={{
            background: 'repeating-linear-gradient(135deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)',
          }}
        />
      )}
      <span
        style={{
          fontSize: '15px',
          fontWeight: 500,
          color: textColor,
          textAlign: 'center',
          marginBottom: '8px',
          lineHeight: 1.3,
          textDecoration: isItem86d ? 'line-through' : 'none',
        }}
      >
        {item.name}
      </span>
      <span
        style={{
          fontSize: '15px',
          fontWeight: 600,
          color: isItem86d ? '#6b7280' : '#22c55e',
        }}
      >
        ${pricing.isDualPricingEnabled ? (item.price * (1 + pricing.cashDiscountRate / 100)).toFixed(2) : item.price.toFixed(2)}
      </span>
      {item.hasModifiers && !isItem86d && (
        <span
          style={{
            fontSize: '11px',
            color: '#94a3b8',
            marginTop: '6px',
          }}
        >
          + options
        </span>
      )}
    </motion.button>
  )
})

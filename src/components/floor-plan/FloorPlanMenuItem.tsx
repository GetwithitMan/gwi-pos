'use client'

import { memo, useCallback } from 'react'
import { StockBadge } from '@/components/menu/StockBadge'
import { useLongPress } from '@/hooks/useLongPress'
import type { PricingOptionGroup, PricingOption } from '@/types'
import type { PricingAdjustment } from '@/lib/settings'

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
  waitlistCount?: number
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
  pricingOptionGroups?: PricingOptionGroup[]
  hasPricingOptions?: boolean
  calories?: number | null
  // Pour size options (liquor or food sizes)
  pourSizes?: Record<string, number | { label: string; multiplier: number; customPrice?: number | null }> & { _hideDefaultOnPos?: boolean } | null
  defaultPourSize?: string | null
  isLiquorItem?: boolean
}

export interface FloorPlanMenuItemProps {
  item: MenuItem
  customStyle?: { bgColor?: string | null; textColor?: string | null } | null
  inQuickBar: boolean
  pricing: { isDualPricingEnabled: boolean; cashDiscountRate: number }
  pricingAdjustment?: PricingAdjustment | null

  onTap: (item: any) => void

  onContextMenu: (e: React.MouseEvent, item: any) => void
  onUnavailable: (reason: string) => void
  onQuickPickTap?: (item: MenuItem, option: PricingOption) => void
  onLongPress?: (item: MenuItem) => void
}

export const FloorPlanMenuItem = memo(function FloorPlanMenuItem({ item, customStyle, inQuickBar, pricing, pricingAdjustment, onTap, onContextMenu, onUnavailable, onQuickPickTap, onLongPress }: FloorPlanMenuItemProps) {
  const isItem86d = item.is86d || item.stockStatus === 'out'
  const bgColor = isItem86d
    ? 'rgba(100, 100, 100, 0.3)'
    : (customStyle?.bgColor || 'rgba(255, 255, 255, 0.05)')
  const textColor = isItem86d
    ? '#6b7280'
    : (customStyle?.textColor || '#e2e8f0')

  // Quick pick buttons: options with showOnPos=true from any group (max 4)
  const quickPickOptions = !isItem86d
    ? (item.pricingOptionGroups ?? []).flatMap(g => g.options.filter(o => o.showOnPos)).slice(0, 4)
    : []
  const hasQuickPicks = quickPickOptions.length > 0

  const handleTap = useCallback(() => {
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
  }, [isItem86d, item, onUnavailable, onTap])

  const handleLongPress = useCallback(() => {
    onLongPress?.(item)
  }, [onLongPress, item])

  const longPressHandlers = useLongPress(handleLongPress, { onTap: handleTap })

  return (
    <button
      {...longPressHandlers}
      onContextMenu={(e) => onContextMenu(e, item)}
      className={`floor-plan-menu-item ${inQuickBar ? 'ring-2 ring-amber-400/50' : ''} ${isItem86d ? '' : 'transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98]'}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: hasQuickPicks ? '12px 8px 8px' : '20px 16px',
        background: bgColor,
        backdropFilter: isItem86d ? undefined : 'blur(12px)',
        WebkitBackdropFilter: isItem86d ? undefined : 'blur(12px)',
        border: isItem86d
          ? '1px solid rgba(239, 68, 68, 0.3)'
          : pricingAdjustment
            ? `2px solid ${pricingAdjustment.color || '#10b981'}`
            : '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: isItem86d ? undefined : '0 4px 12px rgba(0, 0, 0, 0.3)',
        borderRadius: '14px',
        cursor: isItem86d ? 'not-allowed' : 'pointer',
        minHeight: hasQuickPicks ? '130px' : '110px',
        transition: 'all 0.15s ease',
        position: 'relative',
        opacity: isItem86d ? 0.6 : 1,
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
      {/* Entertainment status badge */}
      {item.itemType === 'timed_rental' && !isItem86d && (
        <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
          {item.entertainmentStatus === 'in_use' ? (
            <span className="px-1.5 py-0.5 bg-amber-600 text-white text-[10px] font-bold rounded">
              IN USE
            </span>
          ) : item.entertainmentStatus === 'maintenance' ? (
            <span className="px-1.5 py-0.5 bg-gray-600 text-white text-[10px] font-bold rounded">
              MAINT
            </span>
          ) : (
            <span className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] font-bold rounded">
              OPEN
            </span>
          )}
          {(item.waitlistCount ?? 0) > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded">
              {item.waitlistCount} waiting
            </span>
          )}
        </div>
      )}
      {/* Pricing rule badge */}
      {pricingAdjustment?.showBadge && !isItem86d && (
        <span
          className="absolute top-1 right-1 px-1.5 py-0.5 text-white text-[9px] font-bold rounded z-10 truncate"
          style={{
            backgroundColor: pricingAdjustment.color || '#10b981',
            maxWidth: '90px',
          }}
        >
          {(pricingAdjustment.badgeText || pricingAdjustment.ruleName || '').slice(0, 20)}
        </span>
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
          marginBottom: hasQuickPicks ? '4px' : '8px',
          lineHeight: 1.3,
          textDecoration: isItem86d ? 'line-through' : 'none',
        }}
      >
        {item.name}
      </span>
      {/* Hide base price when quick picks are shown */}
      {!hasQuickPicks && (
        pricingAdjustment && !isItem86d ? (
          // Pricing rule active — respect dual pricing display if enabled
          pricing.isDualPricingEnabled ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {pricingAdjustment.showOriginalPrice && (
                <span style={{ fontSize: '10px', fontWeight: 400, color: '#94a3b8', textDecoration: 'line-through' }}>
                  ${(Math.round(item.price * (1 + pricing.cashDiscountRate / 100) * 100) / 100).toFixed(2)}
                </span>
              )}
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#60a5fa' }}>
                ${(Math.round(pricingAdjustment.adjustedPrice * (1 + pricing.cashDiscountRate / 100) * 100) / 100).toFixed(2)}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#4ade80' }}>
                ${pricingAdjustment.adjustedPrice.toFixed(2)}
              </span>
            </div>
          ) : (
            // Standard pricing — show adjusted price in rule color
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {pricingAdjustment.showOriginalPrice && (
                <span style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', textDecoration: 'line-through' }}>
                  ${item.price.toFixed(2)}
                </span>
              )}
              <span style={{ fontSize: '15px', fontWeight: 600, color: pricingAdjustment.color || '#10b981' }}>
                ${pricingAdjustment.adjustedPrice.toFixed(2)}
              </span>
            </div>
          )
        ) : pricing.isDualPricingEnabled ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: isItem86d ? '#6b7280' : '#60a5fa' }}>
              ${(item.price * (1 + pricing.cashDiscountRate / 100)).toFixed(2)}
            </span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: isItem86d ? '#6b7280' : '#4ade80' }}>
              ${item.price.toFixed(2)}
            </span>
          </div>
        ) : (
          <span
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: isItem86d ? '#6b7280' : '#22c55e',
            }}
          >
            ${item.price.toFixed(2)}
          </span>
        )
      )}
      {/* Quick pick pricing option buttons */}
      {hasQuickPicks && (
        <div style={{ display: 'flex', gap: '3px', width: '100%', marginTop: 'auto', paddingTop: '4px' }}>
          {quickPickOptions.map(option => {
            const isVariant = option.price !== null
            const displayPrice = isVariant ? option.price! : item.price
            // For card price: use priceCC if available, otherwise compute from cash price
            const adjustedPrice = pricing.isDualPricingEnabled
              ? (isVariant && option.priceCC != null ? option.priceCC : displayPrice * (1 + pricing.cashDiscountRate / 100))
              : displayPrice
            const bgClass = option.color || '#6366f1'
            const isHex = bgClass.startsWith('#') || bgClass.startsWith('rgb')
            return (
              <div
                key={option.id}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onQuickPickTap?.(item, option)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onQuickPickTap?.(item, option)
                  }
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '3px 2px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: 'white',
                  backgroundColor: isHex ? bgClass : undefined,
                  transition: 'filter 0.15s',
                  minHeight: pricing.isDualPricingEnabled && isVariant ? '40px' : '32px',
                  justifyContent: 'center',
                }}
                className={isHex ? 'hover:brightness-110' : `${bgClass} hover:brightness-110`}
              >
                <span style={{ lineHeight: 1.2 }}>{option.label}</span>
                {isVariant && pricing.isDualPricingEnabled ? (
                  <>
                    <span style={{ fontSize: '9px', lineHeight: 1.1, color: '#93c5fd' }}>${adjustedPrice.toFixed(2)}</span>
                    <span style={{ fontSize: '8px', lineHeight: 1.1, color: '#86efac' }}>${displayPrice.toFixed(2)}</span>
                  </>
                ) : isVariant ? (
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>${adjustedPrice.toFixed(2)}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {/* Calorie badge (subtle, informational) */}
      {item.calories != null && item.calories > 0 && !isItem86d && (
        <span
          style={{
            fontSize: '10px',
            color: '#94a3b8',
            marginTop: hasQuickPicks ? '2px' : '4px',
            opacity: 0.7,
          }}
        >
          {item.calories} cal
        </span>
      )}
      {item.hasModifiers && !isItem86d && !hasQuickPicks && (
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
    </button>
  )
})

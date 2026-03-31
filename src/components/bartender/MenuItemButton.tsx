'use client'

import { memo, useCallback, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'
import { getDualPrices } from '@/lib/pricing'
import {
  type ItemCustomization,
  FONT_FAMILIES,
  POUR_SIZE_CONFIG,
  SPIRIT_TIER_CONFIG,
  HOT_MODIFIER_CONFIG,
} from '@/components/bartender/bartender-settings'

/** Bartender view MenuItem shape (subset of fields needed for button rendering) */
export interface MenuItemButtonMenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  hasModifiers: boolean
  itemType?: string
  pourSizes?: Record<string, any>
  defaultPourSize?: string | null
  pricingOptionGroups?: { options: { id: string; label: string; price: number | null; color: string | null; priceCC?: number | null; showOnPos?: boolean }[] }[] | null
  hasPricingOptions?: boolean
  hasOtherModifiers?: boolean
  spiritTiers?: Record<string, { id: string; name: string; price: number; spiritTier?: string | null; linkedBottleProductId?: string | null; currentStock?: number | null }[]> | null
}

export interface MenuItemButtonProps {
  item: MenuItemButtonMenuItem
  customization: ItemCustomization
  isFavorite: boolean
  isEditingItems: boolean
  isEditingThisItem: boolean
  onTap: (item: MenuItemButtonMenuItem) => void
  onEditToggle: (itemId: string | null) => void
  onContextMenu: (item: MenuItemButtonMenuItem) => void
  onDragStart: (itemId: string) => void
  onDragOver: (itemId: string) => void
  onDragEnd: () => void
  sizeConfig: { height: number; text: string }
  itemSettings: {
    showPrices: boolean
    showQuickPours: boolean
    showDualPricing: boolean
  }
  dualPricing: { enabled: boolean; cashDiscountPercent: number; applyToCredit: boolean; applyToDebit: boolean; showSavingsMessage: boolean }
  onPourSizeClick: (item: MenuItemButtonMenuItem, pourSize: string, pourPrice: number) => void
  onSpiritTierClick: (item: MenuItemButtonMenuItem, tier: string) => void
  hotModifiers: { id: string; name: string; price: number }[] | undefined
  onHotModifierClick: (item: MenuItemButtonMenuItem, mod: { id: string; name: string; price: number }) => void
  onPricingOptionClick: (item: MenuItemButtonMenuItem, option: { id: string; label: string; price: number | null; color: string | null }) => void
}

export const MenuItemButton = memo(function MenuItemButton({
  item,
  customization,
  isFavorite,
  isEditingItems,
  isEditingThisItem,
  onTap,
  onEditToggle,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
  sizeConfig,
  itemSettings,
  dualPricing,
  onPourSizeClick,
  onSpiritTierClick,
  hotModifiers,
  onHotModifierClick,
  onPricingOptionClick,
}: MenuItemButtonProps) {
  const handleClick = useCallback(() => {
    if (isEditingItems) {
      onEditToggle(isEditingThisItem ? null : item.id)
    } else {
      onTap(item)
    }
  }, [isEditingItems, isEditingThisItem, onEditToggle, onTap, item])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!isEditingItems) onContextMenu(item)
  }, [isEditingItems, onContextMenu, item])

  const handleDragStart = useCallback(() => onDragStart(item.id), [onDragStart, item.id])
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    onDragOver(item.id)
  }, [onDragOver, item.id])

  const buttonStyle = useMemo(() => ({
    backgroundColor: customization.backgroundColor || undefined,
    color: customization.textColor || undefined,
    boxShadow: customization.highlight === 'glow'
      ? `0 0 20px ${customization.glowColor || customization.backgroundColor || '#6366f1'}, 0 0 40px ${customization.glowColor || customization.backgroundColor || '#6366f1'}50`
      : customization.effect === 'neon' && customization.glowColor
        ? `0 0 10px ${customization.glowColor}, 0 0 20px ${customization.glowColor}80, 0 0 30px ${customization.glowColor}40`
        : undefined,
    borderColor: customization.highlight === 'border' ? (customization.borderColor || '#fbbf24') : undefined,
    minHeight: `${sizeConfig.height}px`,
  }), [customization.backgroundColor, customization.textColor, customization.highlight, customization.glowColor, customization.effect, customization.borderColor, sizeConfig.height])

  const nameStyle = useMemo(() => ({
    color: customization.textColor || 'white',
  }), [customization.textColor])

  return (
    <button
      key={item.id}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      draggable={isEditingItems}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      className={`relative p-2 rounded-xl text-left transition-all flex flex-col justify-between min-h-0 ${
        isEditingItems
          ? isEditingThisItem
            ? 'ring-2 ring-indigo-500 bg-indigo-900/30'
            : 'bg-slate-700/50 hover:bg-slate-700 cursor-move'
          : 'bg-slate-700/50 hover:bg-slate-700 active:scale-95'
      } ${
        customization.highlight === 'border' ? 'border-2' : 'border border-white/5'
      } ${
        customization.highlight === 'larger' ? 'scale-105 z-10' : ''
      } ${
        customization.effect === 'pulse' ? 'effect-pulse' : ''
      } ${
        customization.effect === 'shimmer' ? 'effect-shimmer' : ''
      } ${
        customization.effect === 'rainbow' ? 'effect-rainbow' : ''
      } ${
        customization.effect === 'neon' ? 'effect-neon' : ''
      } ${
        FONT_FAMILIES.find(f => f.value === customization.fontFamily)?.className || ''
      }`}
      style={buttonStyle}
    >
      <div
        className={`leading-tight ${sizeConfig.text} ${
          customization.fontStyle === 'bold' || customization.fontStyle === 'boldItalic' ? 'font-bold' : 'font-semibold'
        } ${
          customization.fontStyle === 'italic' || customization.fontStyle === 'boldItalic' ? 'italic' : ''
        }`}
        style={nameStyle}
      >
        {item.name}
      </div>
      {/* Price display - hide if quick pours are shown */}
      {itemSettings.showPrices && !(itemSettings.showQuickPours && item.pourSizes && Object.keys(item.pourSizes).length > 0) && (() => {
        const prices = getDualPrices(item.price, dualPricing)
        return (
          <div className="mt-1">
            {itemSettings.showDualPricing && dualPricing.enabled ? (
              <div className="flex flex-col">
                <div
                  className={`font-semibold ${sizeConfig.text}`}
                  style={{ color: customization.textColor ? customization.textColor : '#60a5fa' }}
                >
                  {formatCurrency(prices.cardPrice)}
                </div>
                <div
                  className={`font-semibold ${sizeConfig.text}`}
                  style={{ color: customization.textColor ? customization.textColor : '#4ade80' }}
                >
                  {formatCurrency(prices.cashPrice)}
                </div>
              </div>
            ) : (
              <div
                className={`font-semibold ${sizeConfig.text}`}
                style={{ color: customization.textColor ? customization.textColor : '#4ade80' }}
              >
                {formatCurrency(dualPricing.enabled ? prices.cardPrice : prices.cashPrice)}
              </div>
            )}
          </div>
        )
      })()}

      {/* Quick Pour Buttons - cohesive teal gradient */}
      {/* Skip 'standard' — that's the base item tap, not a quick pick */}
      {itemSettings.showQuickPours && item.pourSizes && Object.keys(item.pourSizes).length > 0 && !isEditingItems && (
        <div className="mt-auto pt-1 flex gap-0.5">
          {Object.entries(item.pourSizes)
            .filter(([size]) => size !== 'standard' && POUR_SIZE_CONFIG[size])
            .map(([size, multiplier]) => {
            const config = POUR_SIZE_CONFIG[size]
            // Handle both formats: number (legacy) or { label, multiplier, customPrice? } (modern)
            const mult = typeof multiplier === 'number' ? multiplier : (multiplier as any)?.multiplier ?? 1.0
            const custom = typeof multiplier === 'object' ? (multiplier as any)?.customPrice : null
            const pourPrice = custom != null ? custom : item.price * mult
            const prices = getDualPrices(pourPrice, dualPricing)
            const isDefault = item.defaultPourSize === size
            return (
              <div
                key={size}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onPourSizeClick(item, size, pourPrice)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onPourSizeClick(item, size, pourPrice)
                  }
                }}
                className={`flex-1 flex flex-col items-center px-1.5 py-1 rounded text-[12px] font-semibold transition-all cursor-pointer ${dualPricing.enabled ? 'min-h-[44px]' : 'min-h-[36px]'} ${config.color} ${isDefault ? 'ring-1 ring-white/50' : ''} text-white hover:brightness-110`}
              >
                <span className="leading-tight">{config.label}</span>
                {dualPricing.enabled ? (
                  <>
                    <span className="text-[10px] leading-tight" style={{ color: '#93c5fd' }}>{formatCurrency(prices.cardPrice)}</span>
                    <span className="text-[9px] leading-tight" style={{ color: '#86efac' }}>{formatCurrency(prices.cashPrice)}</span>
                  </>
                ) : (
                  <span className="text-[10px] opacity-75">{formatCurrency(prices.cashPrice)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Spirit Tier Buttons for cocktails - skip Well (default) */}
      {item.spiritTiers && !isEditingItems && (
        <div className="mt-auto pt-1 flex gap-0.5">
          {(['call', 'premium', 'top_shelf'] as const).map((tier) => {
            const config = SPIRIT_TIER_CONFIG[tier]
            const tierOptions = item.spiritTiers?.[tier]
            if (!tierOptions || tierOptions.length === 0) return null
            // Show the cheapest option's price as the tier price
            const minPrice = Math.min(...tierOptions.map(o => o.price))
            const prices = getDualPrices(item.price + minPrice, dualPricing)
            const suffix = tierOptions.length > 1 ? '+' : ''
            return (
              <div
                key={tier}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onSpiritTierClick(item, tier)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onSpiritTierClick(item, tier)
                  }
                }}
                className={`flex-1 flex flex-col items-center px-1.5 py-1 rounded text-[12px] font-semibold transition-all ${dualPricing.enabled ? 'min-h-[44px]' : 'min-h-[36px]'} ${config.color} ${config.hoverColor} text-white cursor-pointer`}
              >
                <span className="leading-tight">{config.label}</span>
                {dualPricing.enabled ? (
                  <>
                    <span className="text-[10px] leading-tight" style={{ color: '#93c5fd' }}>{formatCurrency(prices.cardPrice)}{suffix}</span>
                    <span className="text-[9px] leading-tight" style={{ color: '#86efac' }}>{formatCurrency(prices.cashPrice)}{suffix}</span>
                  </>
                ) : (
                  <span className="text-[10px] opacity-75">{formatCurrency(prices.cashPrice)}{suffix}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* W3-11: Hot modifier buttons for liquor items — warm amber/orange palette */}
      {hotModifiers && hotModifiers.length > 0 && !isEditingItems && (
        <div className="mt-auto pt-1 flex gap-0.5 flex-wrap">
          {hotModifiers.map(mod => {
            const config = HOT_MODIFIER_CONFIG[mod.name.toLowerCase().trim()]
            if (!config) return null
            return (
              <div
                key={mod.id}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onHotModifierClick(item, mod)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onHotModifierClick(item, mod)
                  }
                }}
                className={`flex-1 min-w-[40px] flex items-center justify-center px-1 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${config.color} text-white hover:brightness-110`}
              >
                {config.label}
              </div>
            )
          })}
        </div>
      )}

      {/* Pricing option quick pick buttons */}
      {item.pricingOptionGroups && item.pricingOptionGroups.length > 0 && !isEditingItems && (() => {
        const quickPickOptions = item.pricingOptionGroups!.flatMap(g => g.options.filter(o => o.showOnPos)).slice(0, 4)
        if (quickPickOptions.length === 0) return null
        return (
          <div className="mt-auto pt-1 flex gap-0.5">
            {quickPickOptions.map(option => {
              const isVariant = option.price !== null
              const displayPrice = isVariant ? option.price! : item.price
              const prices = getDualPrices(displayPrice, dualPricing)
              // Use explicit priceCC if available, otherwise computed card price
              const shown = dualPricing.enabled
                ? (isVariant && option.priceCC != null ? option.priceCC : prices.cardPrice)
                : prices.cashPrice
              const bgColor = option.color || '#6366f1'
              const isHex = bgColor.startsWith('#') || bgColor.startsWith('rgb')
              return (
                <div
                  key={option.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPricingOptionClick(item, option)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      onPricingOptionClick(item, option)
                    }
                  }}
                  className={`flex-1 flex flex-col items-center px-1.5 py-1 rounded text-[12px] font-semibold transition-all cursor-pointer min-h-[36px] text-white hover:brightness-110 ${isHex ? '' : bgColor}`}
                  style={isHex ? { backgroundColor: bgColor } : undefined}
                >
                  <span className="leading-tight">{option.label}</span>
                  {isVariant && dualPricing.enabled ? (
                    <>
                      <span className="text-[10px] leading-tight" style={{ color: '#93c5fd' }}>{formatCurrency(isVariant && option.priceCC != null ? option.priceCC : prices.cardPrice)}</span>
                      <span className="text-[9px] leading-tight" style={{ color: '#86efac' }}>{formatCurrency(prices.cashPrice)}</span>
                    </>
                  ) : isVariant ? (
                    <span className="text-[10px] opacity-75">{formatCurrency(shown)}</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })()}

      {isFavorite && !isEditingItems && (
        <span className="absolute top-1 right-1 text-amber-400 text-xs">⭐</span>
      )}
      {isEditingItems && (
        <span className="absolute top-1 right-1 text-indigo-400 text-xs">✏️</span>
      )}
    </button>
  )
})

'use client'

/**
 * FloorPlanMenuView — The menu/category item grid shown when a category is selected.
 * Extracted from FloorPlanHome.tsx to reduce component complexity.
 *
 * Renders: loading spinner, empty state, quantity multiplier, menu item grid.
 */

import { memo } from 'react'
import { motion } from 'framer-motion'
import { FloorPlanMenuItem } from './FloorPlanMenuItem'
import { QuantityMultiplier } from './QuantityMultiplier'
import type { MenuItem, PricingOption } from '@/types'
import type { PricingAdjustment } from '@/lib/settings'

interface FloorPlanMenuViewProps {
  menuItems: MenuItem[]
  loadingMenuItems: boolean
  isCategoryPending: boolean
  menuItemColors: Record<string, { bgColor?: string; textColor?: string } | undefined>
  isInQuickBar: (itemId: string) => boolean
  pricing: any
  pricingAdjustmentMap: Map<string, PricingAdjustment | null>
  quantityMultiplier: number
  onSetQuantity: (qty: number) => void
  onMenuItemTap: (item: any) => void
  onContextMenu: (e: React.MouseEvent, item: MenuItem) => void
  onQuickPickTap: (item: MenuItem, option: PricingOption) => void
  onLongPress: (item: MenuItem) => void
  onUnavailable: (reason: string) => void
  onDeselectCategory: () => void
}

export const FloorPlanMenuView = memo(function FloorPlanMenuView({
  menuItems,
  loadingMenuItems,
  isCategoryPending,
  menuItemColors,
  isInQuickBar,
  pricing,
  pricingAdjustmentMap,
  quantityMultiplier,
  onSetQuantity,
  onMenuItemTap,
  onContextMenu,
  onQuickPickTap,
  onLongPress,
  onUnavailable,
  onDeselectCategory,
}: FloorPlanMenuViewProps) {
  return (
    <div
      style={{ flex: 1, overflow: 'auto', padding: '20px' }}
      onClick={(e) => {
        // Click on empty area deselects category
        if (e.target === e.currentTarget) {
          onDeselectCategory()
        }
      }}
    >
      {loadingMenuItems ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#64748b' }}>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </motion.div>
        </div>
      ) : menuItems.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.5, marginBottom: '16px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p style={{ fontSize: '14px' }}>No items in this category</p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.6 }}>Tap the category again to go back</p>
        </div>
      ) : (
        <>
          <QuantityMultiplier
            quantity={quantityMultiplier}
            onSetQuantity={onSetQuantity}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '16px',
              opacity: isCategoryPending ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {menuItems.map((item) => (
              <FloorPlanMenuItem
                key={item.id}
                item={item}
                customStyle={menuItemColors[item.id]}
                inQuickBar={isInQuickBar(item.id)}
                pricing={pricing}
                pricingAdjustment={pricingAdjustmentMap.get(item.id)}
                onTap={onMenuItemTap}
                onContextMenu={onContextMenu}
                onUnavailable={onUnavailable}
                onQuickPickTap={onQuickPickTap}
                onLongPress={onLongPress}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
})

'use client'

import { memo, useMemo } from 'react'
import { toast } from '@/stores/toast-store'
import { MenuItemButton } from '@/components/bartender/MenuItemButton'
import type { MenuItemButtonMenuItem } from '@/components/bartender/MenuItemButton'
import {
  type ItemCustomization,
  type ItemDisplaySettings,
  type ItemsPerRow,
  type BartenderMenuItem,
  ITEM_SIZES,
  FONT_FAMILIES,
  EFFECT_PRESETS,
  GLOW_COLORS,
} from '@/components/bartender/bartender-settings'

// ============================================================================
// TYPES
// ============================================================================

type MenuItem = BartenderMenuItem

interface BartenderMenuGridProps {
  /** Items to display (already filtered/paginated/searched by parent) */
  items: MenuItem[]
  /** Whether menu data is loading */
  isLoading: boolean
  /** Whether a category transition is pending (shows opacity) */
  isCategoryPending: boolean
  /** Current search query (for empty-state message) */
  searchQuery: string
  /** Whether a category is selected (for empty-state message) */
  hasSelectedCategory: boolean
  /** Current selected category ID (for item order reset) */
  selectedCategoryId: string | null

  // Item display settings
  itemSettings: ItemDisplaySettings
  effectiveItemsPerRow: number
  itemCustomizations: Record<string, ItemCustomization>
  favorites: { menuItemId: string }[]
  hotModifierCache: Record<string, { id: string; name: string; price: number }[]>
  dualPricing: { enabled: boolean; cashDiscountPercent: number; applyToCredit: boolean; applyToDebit: boolean; showSavingsMessage: boolean }

  // Editing state
  isEditingItems: boolean
  editingItemId: string | null
  /** All menu items in the current category (needed for the customization panel) */
  allCategoryItems: MenuItem[]
  /** Item order for current category (for reset button visibility) */
  itemOrderForCategory: string[]

  // Pagination
  menuPage: number
  totalMenuPages: number
  onSetMenuPage: (page: number) => void

  // Callbacks
  onMenuItemTap: (item: MenuItem) => void
  onEditToggle: (itemId: string | null) => void
  onAddToFavorites: (item: MenuItem) => void
  onItemDragStart: (itemId: string) => void
  onItemDragOver: (itemId: string) => void
  onItemDragEnd: () => void
  onPourSizeClick: (item: MenuItem, pourSize: string, pourPrice: number) => void
  onSpiritTierClick: (item: MenuItem, tier: string) => void
  onHotModifierClick: (item: MenuItem, mod: { id: string; name: string; price: number }) => void
  onPricingOptionClick: (item: MenuItem, option: { id: string; label: string; price: number | null; color: string | null }) => void
  onClearSearch: () => void

  // Settings panel callbacks
  onSaveItemSettings: (settings: ItemDisplaySettings) => void
  onSaveItemCustomization: (itemId: string, customization: ItemCustomization | null) => void
  onResetAllItemCustomizations: () => void
  onResetItemOrder: () => void
  onStopEditing: () => void

  // Long-press binding for the "items" label
  itemsLongPressProps: Record<string, any>
}

// Stable empty customization object (prevents new {} per render)
const EMPTY_CUSTOMIZATION: ItemCustomization = {} as ItemCustomization

// ============================================================================
// COMPONENT
// ============================================================================

export const BartenderMenuGrid = memo(function BartenderMenuGrid({
  items,
  isLoading,
  isCategoryPending,
  searchQuery,
  hasSelectedCategory,
  selectedCategoryId,
  itemSettings,
  effectiveItemsPerRow,
  itemCustomizations,
  favorites,
  hotModifierCache,
  dualPricing,
  isEditingItems,
  editingItemId,
  allCategoryItems,
  itemOrderForCategory,
  menuPage,
  totalMenuPages,
  onSetMenuPage,
  onMenuItemTap,
  onEditToggle,
  onAddToFavorites,
  onItemDragStart,
  onItemDragOver,
  onItemDragEnd,
  onPourSizeClick,
  onSpiritTierClick,
  onHotModifierClick,
  onPricingOptionClick,
  onClearSearch,
  onSaveItemSettings,
  onSaveItemCustomization,
  onResetAllItemCustomizations,
  onResetItemOrder,
  onStopEditing,
  itemsLongPressProps,
}: BartenderMenuGridProps) {
  const currentItemSizeConfig = ITEM_SIZES.find(s => s.value === itemSettings.size) || ITEM_SIZES[1]

  // Stable subset of itemSettings for MenuItemButton (avoids object identity change)
  const itemSettingsForButton = useMemo(() => ({
    showPrices: itemSettings.showPrices,
    showQuickPours: itemSettings.showQuickPours,
    showDualPricing: itemSettings.showDualPricing,
  }), [itemSettings.showPrices, itemSettings.showQuickPours, itemSettings.showDualPricing])

  // Stable sizeConfig for MenuItemButton
  const sizeConfigForButton = useMemo(() => ({
    height: currentItemSizeConfig.height,
    text: currentItemSizeConfig.text,
  }), [currentItemSizeConfig.height, currentItemSizeConfig.text])

  return (
    <div className="flex-1 overflow-hidden p-3 flex flex-col">
      {/* Item Settings Panel - shown when editing */}
      {isEditingItems && (
        <ItemSettingsPanel
          itemSettings={itemSettings}
          editingItemId={editingItemId}
          allCategoryItems={allCategoryItems}
          itemCustomizations={itemCustomizations}
          selectedCategoryId={selectedCategoryId}
          itemOrderForCategory={itemOrderForCategory}
          dualPricing={dualPricing}
          onSaveItemSettings={onSaveItemSettings}
          onSaveItemCustomization={onSaveItemCustomization}
          onResetAllItemCustomizations={onResetAllItemCustomizations}
          onResetItemOrder={onResetItemOrder}
          onStopEditing={onStopEditing}
          onEditToggle={onEditToggle}
        />
      )}

      {/* Search results indicator */}
      {searchQuery.trim() && (
        <div className="flex-shrink-0 mb-2 flex items-center gap-2 text-sm">
          <span className="text-slate-400">
            {items.length} result{items.length !== 1 ? 's' : ''} for &ldquo;{searchQuery.trim()}&rdquo;
          </span>
          <button
            onClick={onClearSearch}
            className="text-indigo-400 hover:text-indigo-300 text-xs font-medium px-2 py-1 min-h-[32px]"
            aria-label="Clear search"
          >
            Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          {searchQuery.trim() ? 'No items match your search' : hasSelectedCategory ? 'No items in this category' : 'Select a category'}
        </div>
      ) : (
        <>
          {/* Items Grid - Dynamic based on settings */}
          <div
            className={`flex-1 grid gap-2 min-h-0 transition-opacity ${isCategoryPending ? 'opacity-50' : ''} ${itemSettings.useScrolling || searchQuery.trim() ? 'overflow-y-auto content-start scrollbar-hide' : 'auto-rows-fr'}`}
            style={{ gridTemplateColumns: `repeat(${effectiveItemsPerRow}, 1fr)` }}
          >
            {items.map(item => (
              <MenuItemButton
                key={item.id}
                item={item as MenuItemButtonMenuItem}
                customization={itemCustomizations[item.id] || EMPTY_CUSTOMIZATION}
                isFavorite={favorites.some(f => f.menuItemId === item.id)}
                isEditingItems={isEditingItems}
                isEditingThisItem={editingItemId === item.id}
                onTap={onMenuItemTap as (item: MenuItemButtonMenuItem) => void}
                onEditToggle={onEditToggle}
                onContextMenu={onAddToFavorites as (item: MenuItemButtonMenuItem) => void}
                onDragStart={onItemDragStart}
                onDragOver={onItemDragOver}
                onDragEnd={onItemDragEnd}
                sizeConfig={sizeConfigForButton}
                itemSettings={itemSettingsForButton}
                dualPricing={dualPricing}
                onPourSizeClick={onPourSizeClick as (item: MenuItemButtonMenuItem, pourSize: string, pourPrice: number) => void}
                onSpiritTierClick={onSpiritTierClick as (item: MenuItemButtonMenuItem, tier: string) => void}
                hotModifiers={hotModifierCache[item.id]}
                onHotModifierClick={onHotModifierClick as (item: MenuItemButtonMenuItem, mod: { id: string; name: string; price: number }) => void}
                onPricingOptionClick={onPricingOptionClick as (item: MenuItemButtonMenuItem, option: { id: string; label: string; price: number | null; color: string | null }) => void}
              />
            ))}
          </div>

          {/* Pagination & Items Button */}
          <div className="flex-shrink-0 flex items-center justify-between pt-2">
            {/* Items Edit Button - Subtle, long press to activate */}
            <div
              {...itemsLongPressProps}
              className={`px-2 py-1 rounded text-[10px] transition-all select-none cursor-pointer ${
                isEditingItems
                  ? 'bg-indigo-600/80 text-white'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              items
            </div>

            {/* Pagination - Center (hidden during search) */}
            {totalMenuPages > 1 && !searchQuery.trim() && (
              <div className="flex items-center gap-2">
                {Array.from({ length: totalMenuPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => onSetMenuPage(page)}
                    className={`w-11 h-11 rounded-xl font-bold text-lg transition-colors ${
                      menuPage === page
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                        : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                    }`}
                    aria-label={`Go to page ${page}`}
                  >
                    {page}
                  </button>
                ))}
              </div>
            )}

            {/* Spacer for balance */}
            <div className="w-20" />
          </div>
        </>
      )}
    </div>
  )
})

// ============================================================================
// ITEM SETTINGS PANEL (internal sub-component)
// ============================================================================

interface ItemSettingsPanelProps {
  itemSettings: ItemDisplaySettings
  editingItemId: string | null
  allCategoryItems: MenuItem[]
  itemCustomizations: Record<string, ItemCustomization>
  selectedCategoryId: string | null
  itemOrderForCategory: string[]
  dualPricing: { enabled: boolean; cashDiscountPercent: number; applyToCredit: boolean; applyToDebit: boolean; showSavingsMessage: boolean }
  onSaveItemSettings: (settings: ItemDisplaySettings) => void
  onSaveItemCustomization: (itemId: string, customization: ItemCustomization | null) => void
  onResetAllItemCustomizations: () => void
  onResetItemOrder: () => void
  onStopEditing: () => void
  onEditToggle: (itemId: string | null) => void
}

const ItemSettingsPanel = memo(function ItemSettingsPanel({
  itemSettings,
  editingItemId,
  allCategoryItems,
  itemCustomizations,
  selectedCategoryId,
  itemOrderForCategory,
  dualPricing,
  onSaveItemSettings,
  onSaveItemCustomization,
  onResetAllItemCustomizations,
  onResetItemOrder,
  onStopEditing,
  onEditToggle,
}: ItemSettingsPanelProps) {
  return (
    <div className="flex-shrink-0 mb-2 p-3 bg-slate-700/50 rounded-lg border border-indigo-500/30">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Size */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">Size:</span>
          <div className="flex gap-1">
            {ITEM_SIZES.map(s => (
              <button
                key={s.value}
                onClick={() => onSaveItemSettings({ ...itemSettings, size: s.value })}
                className={`px-2 h-7 rounded text-xs font-bold transition-all ${
                  itemSettings.size === s.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Items Per Row */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">Per Row:</span>
          <div className="flex gap-1">
            {(['auto', 3, 4, 5, 6] as ItemsPerRow[]).map(n => (
              <button
                key={n}
                onClick={() => onSaveItemSettings({ ...itemSettings, itemsPerRow: n })}
                className={`w-8 h-7 rounded text-xs font-bold transition-all ${
                  itemSettings.itemsPerRow === n
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                {n === 'auto' ? 'A' : n}
              </button>
            ))}
          </div>
        </div>

        {/* Show Prices Toggle */}
        <button
          onClick={() => onSaveItemSettings({ ...itemSettings, showPrices: !itemSettings.showPrices })}
          className={`px-2 h-7 rounded text-xs font-bold transition-all ${
            itemSettings.showPrices
              ? 'bg-green-600 text-white'
              : 'bg-slate-600 text-slate-300'
          }`}
        >
          {itemSettings.showPrices ? '$ On' : '$ Off'}
        </button>

        {/* Show Dual Pricing Toggle (Cash/Card from system settings) */}
        {dualPricing.enabled && (
          <button
            onClick={() => onSaveItemSettings({ ...itemSettings, showDualPricing: !itemSettings.showDualPricing })}
            className={`px-2 h-7 rounded text-xs font-bold transition-all flex items-center gap-1 ${
              itemSettings.showDualPricing
                ? 'bg-blue-600 text-white'
                : 'bg-slate-600 text-slate-300'
            }`}
            title={`Cash discount: ${dualPricing.cashDiscountPercent}%`}
          >
            {'💵/💳'} {itemSettings.showDualPricing ? 'On' : 'Off'}
          </button>
        )}

        {/* Quick Pour Buttons Toggle */}
        <button
          onClick={() => onSaveItemSettings({ ...itemSettings, showQuickPours: !itemSettings.showQuickPours })}
          className={`px-2 h-7 rounded text-xs font-bold transition-all ${
            itemSettings.showQuickPours
              ? 'bg-purple-600 text-white'
              : 'bg-slate-600 text-slate-300'
          }`}
          title="Show quick pour size buttons on liquor items"
        >
          {'🥃'} Pours {itemSettings.showQuickPours ? 'On' : 'Off'}
        </button>

        {/* Scrolling vs Pagination Toggle */}
        <button
          onClick={() => onSaveItemSettings({ ...itemSettings, useScrolling: !itemSettings.useScrolling })}
          className={`px-2 h-7 rounded text-xs font-bold transition-all ${
            itemSettings.useScrolling
              ? 'bg-cyan-600 text-white'
              : 'bg-slate-600 text-slate-300'
          }`}
          title="Toggle between scrolling and pagination"
        >
          {itemSettings.useScrolling ? '📜 Scroll' : '📄 Pages'}
        </button>

        {/* Reset Customizations */}
        {Object.keys(itemCustomizations).length > 0 && (
          <button
            onClick={() => {
              onResetAllItemCustomizations()
              toast.success('Item styles reset')
            }}
            className="px-2 h-7 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-all"
          >
            Reset Styles
          </button>
        )}

        {/* Reset Order for current category */}
        {selectedCategoryId && itemOrderForCategory.length > 0 && (
          <button
            onClick={onResetItemOrder}
            className="px-2 h-7 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-all"
          >
            Reset Order
          </button>
        )}

        <span className="text-slate-500 text-xs italic">Tap item to customize {'·'} Drag to reorder</span>

        <button
          onClick={onStopEditing}
          className="ml-auto px-3 py-1 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-500"
        >
          Done
        </button>
      </div>

      {/* Individual Item Customization Panel */}
      {editingItemId && (() => {
        const editingItem = allCategoryItems.find(i => i.id === editingItemId)
        const currentCustomization = itemCustomizations[editingItemId] || {}
        if (!editingItem) return null
        return (
          <ItemCustomizationPanel
            editingItemId={editingItemId}
            editingItemName={editingItem.name}
            currentCustomization={currentCustomization}
            onSaveItemCustomization={onSaveItemCustomization}
            onEditToggle={onEditToggle}
          />
        )
      })()}
    </div>
  )
})

// ============================================================================
// ITEM CUSTOMIZATION PANEL (internal sub-component)
// ============================================================================

interface ItemCustomizationPanelProps {
  editingItemId: string
  editingItemName: string
  currentCustomization: ItemCustomization
  onSaveItemCustomization: (itemId: string, customization: ItemCustomization | null) => void
  onEditToggle: (itemId: string | null) => void
}

const ItemCustomizationPanel = memo(function ItemCustomizationPanel({
  editingItemId,
  editingItemName,
  currentCustomization,
  onSaveItemCustomization,
  onEditToggle,
}: ItemCustomizationPanelProps) {
  return (
    <div className="mt-3 pt-3 border-t border-slate-600 space-y-2">
      {/* Row 1: Item name & Colors */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-white font-medium text-sm">{editingItemName}</span>
        <div className="flex items-center gap-1">
          <span className="text-slate-500 text-[10px]">BG</span>
          <input
            type="color"
            value={currentCustomization.backgroundColor || '#334155'}
            onChange={(e) => onSaveItemCustomization(editingItemId, { ...currentCustomization, backgroundColor: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500 text-[10px]">Text</span>
          <input
            type="color"
            value={currentCustomization.textColor || '#ffffff'}
            onChange={(e) => onSaveItemCustomization(editingItemId, { ...currentCustomization, textColor: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer"
          />
        </div>
        <button
          onClick={() => {
            onSaveItemCustomization(editingItemId, null)
            onEditToggle(null)
          }}
          className="ml-auto px-2 h-5 rounded text-[9px] font-bold bg-red-600/40 text-red-300 hover:bg-red-600"
        >
          Clear All
        </button>
      </div>

      {/* Row 2: Font Style & Family */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-500 text-[10px]">Font:</span>
        {(['normal', 'bold', 'italic', 'boldItalic'] as const).map(style => (
          <button
            key={style}
            onClick={() => onSaveItemCustomization(editingItemId, { ...currentCustomization, fontStyle: style })}
            className={`px-1.5 h-5 rounded text-[9px] transition-all ${
              (currentCustomization.fontStyle || 'normal') === style
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            } ${style === 'bold' || style === 'boldItalic' ? 'font-bold' : ''} ${style === 'italic' || style === 'boldItalic' ? 'italic' : ''}`}
          >
            {style === 'boldItalic' ? 'B+I' : style.charAt(0).toUpperCase() + style.slice(1)}
          </button>
        ))}
        <span className="text-slate-600">|</span>
        {FONT_FAMILIES.map(font => (
          <button
            key={font.value}
            onClick={() => onSaveItemCustomization(editingItemId, { ...currentCustomization, fontFamily: font.value as ItemCustomization['fontFamily'] })}
            className={`px-1.5 h-5 rounded text-[9px] transition-all ${font.className} ${
              (currentCustomization.fontFamily || 'default') === font.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {font.label}
          </button>
        ))}
      </div>

      {/* Row 3: Highlight & Glow Color */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-500 text-[10px]">Pop:</span>
        {(['none', 'glow', 'border', 'larger'] as const).map(effect => (
          <button
            key={effect}
            onClick={() => onSaveItemCustomization(editingItemId, { ...currentCustomization, highlight: effect })}
            className={`px-1.5 h-5 rounded text-[9px] font-medium transition-all ${
              (currentCustomization.highlight || 'none') === effect
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {effect}
          </button>
        ))}
        {(currentCustomization.highlight === 'glow' || currentCustomization.highlight === 'border') && (
          <>
            <span className="text-slate-600">|</span>
            <span className="text-slate-500 text-[10px]">Color:</span>
            {GLOW_COLORS.map(gc => (
              <button
                key={gc.color}
                onClick={() => onSaveItemCustomization(editingItemId, {
                  ...currentCustomization,
                  glowColor: currentCustomization.highlight === 'glow' ? gc.color : currentCustomization.glowColor,
                  borderColor: currentCustomization.highlight === 'border' ? gc.color : currentCustomization.borderColor
                })}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  (currentCustomization.highlight === 'glow' ? currentCustomization.glowColor : currentCustomization.borderColor) === gc.color
                    ? 'border-white scale-110'
                    : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: gc.color }}
                title={gc.label}
              />
            ))}
          </>
        )}
      </div>

      {/* Row 4: Animation Effects */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-500 text-[10px]">Animate:</span>
        {EFFECT_PRESETS.map(effect => (
          <button
            key={effect.value}
            onClick={() => onSaveItemCustomization(editingItemId, { ...currentCustomization, effect: effect.value as ItemCustomization['effect'] })}
            className={`px-1.5 h-5 rounded text-[9px] transition-all flex items-center gap-0.5 ${
              (currentCustomization.effect || 'none') === effect.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            <span>{effect.emoji}</span>
            <span>{effect.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
})

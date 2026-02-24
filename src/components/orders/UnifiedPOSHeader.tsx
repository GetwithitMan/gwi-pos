'use client'

import { useState, useRef, useEffect, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MenuSearchResults } from '@/components/search'
import type { OrderTypeConfig } from '@/types/order-types'

interface SearchMenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  is86d?: boolean
}

interface IngredientMatch {
  ingredientType: 'spirit' | 'food'
  ingredientName: string
  ingredientId: string
  items: SearchMenuItem[]
}

interface SearchResults {
  directMatches: SearchMenuItem[]
  ingredientMatches: IngredientMatch[]
  totalMatches: number
}

// Scanner heuristics (keyboard-wedge barcode scanners send chars very rapidly then Enter)
const SCANNER_KEY_INTERVAL_MS = 100
const SCANNER_RESET_GAP_MS = 500
const SCANNER_MIN_LENGTH = 3

export interface UnifiedPOSHeaderProps {
  employeeName: string
  employeeRole?: string
  viewMode: 'floor-plan' | 'bartender'
  onViewModeChange: (mode: 'floor-plan' | 'bartender') => void
  activeOrderType: string | null
  onQuickOrderType: (type: string) => void
  orderTypes?: OrderTypeConfig[]
  onTablesClick: () => void
  onSwitchUser?: () => void
  onOpenTimeClock?: () => void
  onLogout: () => void
  onOpenSettings?: () => void
  onOpenAdminNav?: () => void
  canCustomize: boolean
  quickBarEnabled: boolean
  onToggleQuickBar: () => void
  quickPickEnabled: boolean
  onToggleQuickPick: () => void
  isEditingFavorites: boolean
  onToggleEditFavorites: () => void
  isEditingCategories: boolean
  onToggleEditCategories: () => void
  isEditingMenuItems: boolean
  onToggleEditMenuItems: () => void
  onResetAllCategoryColors: () => void
  onResetAllMenuItemStyles: () => void
  openOrdersCount: number
  onOpenOrdersPanel: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  onSearchClear: () => void
  searchResults: SearchResults
  isSearching: boolean
  onSearchSelect: (item: SearchMenuItem) => void
  cardPriceMultiplier?: number
  onScanComplete?: (sku: string) => void
  onQuickServiceOrder?: () => void
}

export const UnifiedPOSHeader = memo(function UnifiedPOSHeader({
  employeeName,
  employeeRole,
  viewMode,
  onViewModeChange,
  activeOrderType,
  onQuickOrderType,
  orderTypes,
  onTablesClick,
  onSwitchUser,
  onOpenTimeClock,
  onLogout,
  onOpenSettings,
  onOpenAdminNav,
  canCustomize,
  quickBarEnabled,
  onToggleQuickBar,
  quickPickEnabled,
  onToggleQuickPick,
  isEditingFavorites,
  onToggleEditFavorites,
  isEditingCategories,
  onToggleEditCategories,
  isEditingMenuItems,
  onToggleEditMenuItems,
  onResetAllCategoryColors,
  onResetAllMenuItemStyles,
  openOrdersCount,
  onOpenOrdersPanel,
  searchQuery,
  onSearchChange,
  onSearchClear,
  searchResults,
  isSearching,
  onSearchSelect,
  cardPriceMultiplier,
  onScanComplete,
  onQuickServiceOrder,
}: UnifiedPOSHeaderProps) {
  const [showEmployeeMenu, setShowEmployeeMenu] = useState(false)
  const [showGearMenu, setShowGearMenu] = useState(false)
  const employeeRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const scanBuffer = useRef('')
  const lastKeyTime = useRef(0)

  // Click-outside to close dropdowns
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showEmployeeMenu && employeeRef.current && !employeeRef.current.contains(e.target as Node))
        setShowEmployeeMenu(false)
      if (showGearMenu && gearRef.current && !gearRef.current.contains(e.target as Node))
        setShowGearMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showEmployeeMenu, showGearMenu])

  // Cmd+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === 'Escape' && searchQuery) {
        onSearchClear()
        searchInputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchQuery, onSearchClear])

  // Keyboard-wedge barcode scanner detection.
  // Scanners send chars at <100ms intervals then fire Enter.
  // When Enter fires with buffer.length >= 3 and search input is NOT focused → fire onScanComplete.
  useEffect(() => {
    if (!onScanComplete) return

    const handler = (e: KeyboardEvent) => {
      const now = Date.now()
      const gap = now - lastKeyTime.current

      // Long gap since last keypress — not a scanner burst, reset buffer
      if (gap > SCANNER_RESET_GAP_MS && lastKeyTime.current !== 0) {
        scanBuffer.current = ''
      }

      lastKeyTime.current = now

      if (e.key === 'Enter') {
        const inputFocused = document.activeElement === searchInputRef.current
        if (!inputFocused && scanBuffer.current.length >= SCANNER_MIN_LENGTH) {
          e.preventDefault()
          const sku = scanBuffer.current
          scanBuffer.current = ''
          onScanComplete(sku)
        } else {
          scanBuffer.current = ''
        }
        return
      }

      // Accumulate printable single-char keys that arrive in rapid succession
      if (e.key.length === 1) {
        const inputFocused = document.activeElement === searchInputRef.current
        if (!inputFocused && gap < SCANNER_KEY_INTERVAL_MS) {
          scanBuffer.current += e.key
        } else if (!inputFocused) {
          // Human-speed keystroke outside the input — reset buffer
          scanBuffer.current = e.key
        }
        // If input is focused, let normal typing work (don't accumulate in scan buffer)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onScanComplete])

  const defaultOrderTypes: Pick<OrderTypeConfig, 'slug' | 'name' | 'color' | 'isActive'>[] = [
    { slug: 'dine_in', name: 'Dine In', color: '#6366f1', isActive: true },
    { slug: 'takeout', name: 'Takeout', color: '#22c55e', isActive: true },
    { slug: 'delivery', name: 'Delivery', color: '#6366f1', isActive: true },
    { slug: 'bar_tab', name: 'Bar Tab', color: '#6366f1', isActive: true },
  ]
  const resolvedOrderTypes = orderTypes && orderTypes.length > 0 ? orderTypes : defaultOrderTypes

  const isTablesActive = viewMode === 'floor-plan' && (!activeOrderType || activeOrderType === 'dine_in')

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      height: '44px',
      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.85) 100%)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      flexShrink: 0,
      zIndex: 50,
      gap: '6px',
    }}>
      {/* ── Employee Dropdown ── */}
      <div ref={employeeRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setShowEmployeeMenu(!showEmployeeMenu)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            height: '30px', padding: '0 10px',
            background: showEmployeeMenu ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            border: `1px solid ${showEmployeeMenu ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
            borderRadius: '6px',
            color: '#e2e8f0',
            fontSize: '13px', fontWeight: 500,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.7 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {employeeName}
          <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <AnimatePresence>
          {showEmployeeMenu && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                minWidth: '180px',
                background: 'rgba(15, 23, 42, 0.98)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px', padding: '4px 0',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
                zIndex: 1000,
              }}
            >
              <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>{employeeName}</div>
                {employeeRole && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>{employeeRole}</div>}
              </div>
              <div style={{ padding: '2px 0' }}>
                {onSwitchUser && <DropItem label="Switch User" onClick={() => { setShowEmployeeMenu(false); onSwitchUser() }} />}
                <Sep />
                <DropLink href="/crew" label="Crew Hub" onClick={() => setShowEmployeeMenu(false)} />
                <DropLink href="/crew/shift" label="My Shift" onClick={() => setShowEmployeeMenu(false)} />
                <DropLink href="/crew/tip-bank" label="Tip Bank" onClick={() => setShowEmployeeMenu(false)} />
                <DropLink href="/crew/tip-group" label="Tip Group" onClick={() => setShowEmployeeMenu(false)} />
                <Sep />
                {onOpenSettings && <DropItem label="Settings" onClick={() => { setShowEmployeeMenu(false); onOpenSettings() }} />}
                <Sep />
                <DropItem label="Clock Out" color="#f87171" onClick={() => { setShowEmployeeMenu(false); onOpenTimeClock ? onOpenTimeClock() : onLogout() }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Divider ── */}
      <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.08)', flexShrink: 0 }} />

      {/* ── Nav Tabs ── */}
      <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
        {(resolvedOrderTypes).filter(ot => ot.isActive).map(ot => {
          const isDineIn = ot.slug === 'dine_in'
          const isBarTab = ot.slug === 'bar_tab'
          const displayName = isDineIn ? 'Tables' : isBarTab ? 'Bar' : ot.name
          const isActive = isDineIn ? isTablesActive : isBarTab ? viewMode === 'bartender' : activeOrderType === ot.slug

          return (
            <NavTab
              key={ot.slug}
              active={isActive}
              accentColor={ot.color}
              onClick={() => {
                if (isDineIn) { onViewModeChange('floor-plan'); onTablesClick() }
                else if (isBarTab) { onViewModeChange('bartender'); onQuickOrderType(ot.slug) }
                else { onViewModeChange('floor-plan'); onQuickOrderType(ot.slug) }
              }}
            >
              {displayName}
            </NavTab>
          )
        })}
      </div>

      {/* ── Quick Order ── */}
      {onQuickServiceOrder && (
        <>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.08)', flexShrink: 0 }} />
          <button
            onClick={onQuickServiceOrder}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              height: '30px', padding: '0 10px',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: '6px',
              color: '#6ee7b7',
              fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Quick Order
          </button>
        </>
      )}

      {/* ── Gear Dropdown ── */}
      {canCustomize && (
        <>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.08)', flexShrink: 0 }} />
          <div ref={gearRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowGearMenu(!showGearMenu)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '30px', height: '30px',
                background: showGearMenu ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                border: 'none',
                borderRadius: '6px', cursor: 'pointer',
                color: showGearMenu ? '#a5b4fc' : '#64748b',
                transition: 'color 0.15s',
              }}
              title="Layout Settings"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <AnimatePresence>
              {showGearMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                    minWidth: '200px',
                    background: 'rgba(15, 23, 42, 0.98)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '10px', padding: '4px 0',
                    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
                    zIndex: 1000,
                  }}
                >
                  <DropItem
                    label={quickBarEnabled ? '\u2713 Quick Bar Enabled' : 'Enable Quick Bar'}
                    onClick={() => { onToggleQuickBar(); setShowGearMenu(false) }}
                  />
                  <DropItem
                    label={quickPickEnabled ? '\u2713 Quick Pick Numbers' : 'Quick Pick Numbers'}
                    onClick={() => { onToggleQuickPick(); setShowGearMenu(false) }}
                  />
                  <Sep />
                  <DropItem
                    label={isEditingFavorites ? '\u2713 Done Editing Favorites' : 'Edit Favorites'}
                    color={isEditingFavorites ? '#a5b4fc' : undefined}
                    onClick={() => { onToggleEditFavorites(); setShowGearMenu(false) }}
                  />
                  <DropItem
                    label={isEditingCategories ? '\u2713 Done Reordering' : 'Reorder Categories'}
                    color={isEditingCategories ? '#a5b4fc' : undefined}
                    onClick={() => { onToggleEditCategories(); setShowGearMenu(false) }}
                  />
                  <DropItem
                    label={isEditingMenuItems ? '\u2713 Done Customizing' : 'Customize Item Colors'}
                    color={isEditingMenuItems ? '#c4b5fd' : undefined}
                    onClick={() => { onToggleEditMenuItems(); setShowGearMenu(false) }}
                  />
                  <Sep />
                  <DropItem label="Reset Category Colors" color="#f87171" onClick={() => { onResetAllCategoryColors(); setShowGearMenu(false) }} />
                  <DropItem label="Reset Item Styles" color="#f87171" onClick={() => { onResetAllMenuItemStyles(); setShowGearMenu(false) }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── Search (inline, compact) ── */}
      <div ref={searchWrapRef} style={{ position: 'relative', width: '220px', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <svg
            width="14" height="14" fill="none" stroke="#64748b" viewBox="0 0 24 24"
            style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {isSearching && (
            <svg
              width="14" height="14" fill="none" viewBox="0 0 24 24"
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite' }}
            >
              <circle cx="12" cy="12" r="10" stroke="#64748b" strokeWidth="3" opacity={0.25} />
              <path fill="#64748b" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity={0.75} />
            </svg>
          )}
          {searchQuery && !isSearching && (
            <button
              onClick={onSearchClear}
              style={{
                position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                color: '#64748b', display: 'flex',
              }}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search... (\u2318K)"
            style={{
              width: '100%',
              height: '30px',
              paddingLeft: '28px',
              paddingRight: '28px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              color: '#e2e8f0',
              fontSize: '12px',
              outline: 'none',
            }}
          />
        </div>
        {/* Search results dropdown */}
        <MenuSearchResults
          results={searchResults}
          query={searchQuery}
          isSearching={isSearching}
          onSelectItem={onSearchSelect}
          onClose={onSearchClear}
          cardPriceMultiplier={cardPriceMultiplier}
        />
        <style>{`@keyframes spin { from { transform: translateY(-50%) rotate(0deg); } to { transform: translateY(-50%) rotate(360deg); } }`}</style>
      </div>

      {/* ── Divider ── */}
      <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.08)', flexShrink: 0 }} />

      {/* ── Open Orders ── */}
      <button
        onClick={onOpenOrdersPanel}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          height: '30px', padding: '0 10px',
          background: openOrdersCount > 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.06)',
          border: `1px solid ${openOrdersCount > 0 ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
          borderRadius: '6px',
          color: openOrdersCount > 0 ? '#a5b4fc' : '#94a3b8',
          fontSize: '12px', fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Open Orders
        {openOrdersCount > 0 && (
          <span style={{
            background: 'rgba(99, 102, 241, 0.3)',
            padding: '0 5px', borderRadius: '8px',
            fontSize: '11px', fontWeight: 700,
            lineHeight: '18px',
          }}>
            {openOrdersCount}
          </span>
        )}
      </button>

      {/* ── Admin Gear ── */}
      {onOpenAdminNav && (
        <button
          onClick={onOpenAdminNav}
          title="Admin Settings"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '30px', height: '30px',
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '6px', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <svg width="15" height="15" fill="none" stroke="#60a5fa" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}
    </header>
  )
})

// ── Sub-components ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null
}

function lightenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const r = Math.min(255, rgb.r + Math.round((255 - rgb.r) * amount))
  const g = Math.min(255, rgb.g + Math.round((255 - rgb.g) * amount))
  const b = Math.min(255, rgb.b + Math.round((255 - rgb.b) * amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function NavTab({ active, accentColor, onClick, children }: {
  active: boolean
  accentColor?: string
  onClick: () => void
  children: React.ReactNode
}) {
  const defaultColor = '#6366f1' // indigo
  const baseColor = accentColor || defaultColor
  const rgb = hexToRgb(baseColor)
  const colors = rgb
    ? {
        activeBg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`,
        activeBorder: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`,
        activeText: lightenHex(baseColor, 0.5),
      }
    : { activeBg: 'rgba(99, 102, 241, 0.2)', activeBorder: 'rgba(99, 102, 241, 0.5)', activeText: '#a5b4fc' }

  return (
    <button
      onClick={onClick}
      style={{
        height: '30px',
        padding: '0 12px',
        fontSize: '12px', fontWeight: 600,
        borderRadius: '6px',
        border: active ? `1px solid ${colors.activeBorder}` : '1px solid transparent',
        background: active ? colors.activeBg : 'transparent',
        color: active ? colors.activeText : '#94a3b8',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

function DropItem({ label, color, onClick }: { label: string; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 12px', background: 'transparent', border: 'none',
        color: color || '#e2e8f0', fontSize: '12px', cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  )
}

function DropLink({ href, label, onClick }: { href: string; label: string; onClick: () => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      style={{
        display: 'block', padding: '7px 12px', textDecoration: 'none',
        color: '#e2e8f0', fontSize: '12px',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </a>
  )
}

function Sep() {
  return <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '2px 0' }} />
}

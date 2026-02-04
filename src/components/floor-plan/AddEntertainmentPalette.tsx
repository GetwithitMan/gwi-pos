'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  EntertainmentVisual,
  ENTERTAINMENT_VISUAL_OPTIONS,
  type EntertainmentVisualType,
} from './entertainment-visuals'

interface EntertainmentMenuItem {
  id: string
  name: string
  price: number
  blockTimeMinutes?: number | null
  categoryType?: string | null
  isPlaced?: boolean // Whether already on floor plan
}

interface AddEntertainmentPaletteProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
  selectedSectionId: string | null
  placedMenuItemIds: string[] // IDs of menu items already on the floor plan
  onAddElement: (element: {
    name: string
    visualType: EntertainmentVisualType
    linkedMenuItemId: string
    width: number
    height: number
  }) => void
}

// Try to auto-detect visual type from item name
function detectVisualType(name: string): EntertainmentVisualType {
  const lower = name.toLowerCase()
  if (lower.includes('pool')) return 'pool_table'
  if (lower.includes('dart')) return 'dartboard'
  if (lower.includes('arcade')) return 'arcade'
  if (lower.includes('foosball') || lower.includes('foos')) return 'foosball'
  if (lower.includes('shuffle')) return 'shuffleboard'
  if (lower.includes('ping') || lower.includes('pong')) return 'ping_pong'
  if (lower.includes('bowl')) return 'bowling_lane'
  if (lower.includes('karaoke')) return 'karaoke_stage'
  if (lower.includes('dj')) return 'dj_booth'
  if (lower.includes('photo')) return 'photo_booth'
  if (lower.includes('vr') || lower.includes('virtual')) return 'vr_station'
  return 'game_table' // Default
}

export function AddEntertainmentPalette({
  isOpen,
  onClose,
  locationId,
  selectedSectionId,
  placedMenuItemIds,
  onAddElement,
}: AddEntertainmentPaletteProps) {
  const [entertainmentItems, setEntertainmentItems] = useState<EntertainmentMenuItem[]>([])
  const [selectedMenuItem, setSelectedMenuItem] = useState<EntertainmentMenuItem | null>(null)
  const [selectedVisualType, setSelectedVisualType] = useState<EntertainmentVisualType | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Fetch entertainment menu items
  useEffect(() => {
    if (isOpen && locationId) {
      fetchEntertainmentItems()
    }
  }, [isOpen, locationId])

  // Reset when closing
  useEffect(() => {
    if (!isOpen) {
      setSelectedMenuItem(null)
      setSelectedVisualType(null)
    }
  }, [isOpen])

  const fetchEntertainmentItems = async () => {
    setIsLoading(true)
    try {
      // Fetch all items for the location, then filter by categoryType = 'entertainment'
      const response = await fetch(
        `/api/menu/items?locationId=${locationId}`
      )
      if (response.ok) {
        const data = await response.json()
        // Filter to only items in entertainment category
        const entertainmentOnly = (data.items || []).filter(
          (item: EntertainmentMenuItem) => item.categoryType === 'entertainment'
        )
        setEntertainmentItems(entertainmentOnly)
      }
    } catch (error) {
      console.error('Failed to fetch entertainment items:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Filter out already placed items
  const availableItems = entertainmentItems.filter(
    (item) => !placedMenuItemIds.includes(item.id)
  )

  const handleSelectMenuItem = (item: EntertainmentMenuItem) => {
    setSelectedMenuItem(item)
    // Auto-detect visual type from name
    setSelectedVisualType(detectVisualType(item.name))
  }

  const handleAdd = useCallback(() => {
    if (!selectedMenuItem || !selectedVisualType) return

    const visualOption = ENTERTAINMENT_VISUAL_OPTIONS.find((v) => v.value === selectedVisualType)
    if (!visualOption) return

    onAddElement({
      name: selectedMenuItem.name,
      visualType: selectedVisualType,
      linkedMenuItemId: selectedMenuItem.id,
      width: visualOption.defaultWidth,
      height: visualOption.defaultHeight,
    })

    // Reset state
    setSelectedMenuItem(null)
    setSelectedVisualType(null)
    onClose()
  }, [selectedMenuItem, selectedVisualType, onAddElement, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-50 lg:ml-64"
            style={{
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '24px 24px 0 0',
              maxHeight: '70vh',
            }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1.5 bg-slate-600 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-6 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">Add Entertainment</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {availableItems.length === 0
                    ? 'All entertainment items have been placed'
                    : 'Select an item from your menu to place on the floor plan'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-slate-400">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(70vh - 100px)' }}>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
                </div>
              ) : availableItems.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-400 text-sm">
                    {entertainmentItems.length === 0
                      ? 'No entertainment items in your menu.'
                      : 'All entertainment items have been placed on the floor plan.'}
                  </p>
                  <p className="text-slate-500 text-xs mt-2">
                    {entertainmentItems.length === 0
                      ? 'Add timed rental items in Menu Builder first.'
                      : 'To add more, create additional items in Menu Builder.'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Step 1: Select Menu Item */}
                  <div className="mb-6">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3 block">
                      1. Select Item to Place
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {availableItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleSelectMenuItem(item)}
                          className={`relative p-4 rounded-xl text-left transition-all ${
                            selectedMenuItem?.id === item.id
                              ? 'bg-indigo-500/20 ring-2 ring-indigo-500'
                              : 'bg-slate-800/50 hover:bg-slate-700/50'
                          }`}
                        >
                          <div className="font-semibold text-white text-sm">{item.name}</div>
                          <div className="text-slate-400 text-xs mt-1">
                            ${item.price.toFixed(2)}
                            {item.blockTimeMinutes && (
                              <span className="text-slate-500 ml-1">
                                / {item.blockTimeMinutes}min
                              </span>
                            )}
                          </div>
                          {selectedMenuItem?.id === item.id && (
                            <motion.div
                              layoutId="selectedItem"
                              className="absolute inset-0 rounded-xl border-2 border-indigo-500"
                              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Step 2: Select Visual Style (shown after item selected) */}
                  {selectedMenuItem && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-6"
                    >
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-3 block">
                        2. Choose Visual Style for "{selectedMenuItem.name}"
                      </label>
                      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
                        {ENTERTAINMENT_VISUAL_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => setSelectedVisualType(option.value)}
                            className={`relative p-3 rounded-xl transition-all ${
                              selectedVisualType === option.value
                                ? 'bg-indigo-500/20 ring-2 ring-indigo-500'
                                : 'bg-slate-800/50 hover:bg-slate-700/50'
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <div
                                className="flex items-center justify-center"
                                style={{
                                  width: 60,
                                  height: 50,
                                  transform: `scale(${Math.min(60 / option.defaultWidth, 50 / option.defaultHeight) * 0.9})`,
                                }}
                              >
                                <EntertainmentVisual
                                  visualType={option.value}
                                  width={option.defaultWidth}
                                  height={option.defaultHeight}
                                  status="available"
                                />
                              </div>
                              <span className="text-[10px] text-slate-400 text-center leading-tight">
                                {option.label}
                              </span>
                            </div>
                            {selectedVisualType === option.value && (
                              <motion.div
                                layoutId="selectedVisual"
                                className="absolute inset-0 rounded-xl border-2 border-indigo-500"
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Preview & Add */}
                  {selectedMenuItem && selectedVisualType && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-4"
                    >
                      {/* Preview */}
                      <div
                        className="flex-1 flex items-center justify-center p-4 rounded-xl"
                        style={{
                          background: 'rgba(0, 0, 0, 0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                        }}
                      >
                        <div className="flex items-center gap-4">
                          <EntertainmentVisual
                            visualType={selectedVisualType}
                            width={ENTERTAINMENT_VISUAL_OPTIONS.find((v) => v.value === selectedVisualType)?.defaultWidth || 100}
                            height={ENTERTAINMENT_VISUAL_OPTIONS.find((v) => v.value === selectedVisualType)?.defaultHeight || 100}
                            status="available"
                          />
                          <div>
                            <div className="text-white font-semibold">{selectedMenuItem.name}</div>
                            <div className="text-slate-400 text-sm">${selectedMenuItem.price.toFixed(2)}</div>
                          </div>
                        </div>
                      </div>

                      {/* Add Button */}
                      <button
                        onClick={handleAdd}
                        className="px-8 py-4 rounded-2xl text-sm font-bold text-white transition-all"
                        style={{
                          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                          boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                        }}
                      >
                        Add to Floor Plan
                      </button>
                    </motion.div>
                  )}
                </>
              )}

              {/* Already Placed Items */}
              {entertainmentItems.length > 0 && placedMenuItemIds.length > 0 && (
                <div className="mt-6 pt-6 border-t border-white/10">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2 block">
                    Already Placed ({placedMenuItemIds.length})
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {entertainmentItems
                      .filter((item) => placedMenuItemIds.includes(item.id))
                      .map((item) => (
                        <span
                          key={item.id}
                          className="px-3 py-1.5 rounded-lg text-xs text-slate-500 bg-slate-800/30"
                        >
                          {item.name}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

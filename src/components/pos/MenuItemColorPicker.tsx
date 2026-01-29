'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import type { MenuItemCustomization, PopEffect } from '@/lib/settings'

interface MenuItemColorPickerProps {
  isOpen: boolean
  onClose: () => void
  itemName: string
  currentStyle: MenuItemCustomization
  onSave: (style: MenuItemCustomization) => void
  onReset: () => void
}

export function MenuItemColorPicker({
  isOpen,
  onClose,
  itemName,
  currentStyle,
  onSave,
  onReset,
}: MenuItemColorPickerProps) {
  const [bgColor, setBgColor] = useState(currentStyle.bgColor || '')
  const [textColor, setTextColor] = useState(currentStyle.textColor || '')
  const [popEffect, setPopEffect] = useState<PopEffect>(currentStyle.popEffect || 'none')
  const [glowColor, setGlowColor] = useState(currentStyle.glowColor || '')

  // Sync state when props change
  useEffect(() => {
    setBgColor(currentStyle.bgColor || '')
    setTextColor(currentStyle.textColor || '')
    setPopEffect(currentStyle.popEffect || 'none')
    setGlowColor(currentStyle.glowColor || '')
  }, [currentStyle])

  const handleSave = () => {
    onSave({
      bgColor: bgColor || null,
      textColor: textColor || null,
      popEffect: popEffect !== 'none' ? popEffect : null,
      glowColor: glowColor || null,
    })
    onClose()
  }

  const handleReset = () => {
    setBgColor('')
    setTextColor('')
    setPopEffect('none')
    setGlowColor('')
    onReset()
    onClose()
  }

  // Get preview styles based on current settings
  const getPreviewStyle = () => {
    const style: React.CSSProperties = {
      backgroundColor: bgColor || 'rgba(255,255,255,0.7)',
      color: textColor || '#374151',
      transition: 'all 0.2s ease-out',
    }

    const effectColor = glowColor || bgColor || '#3B82F6'

    if (popEffect === 'glow' || popEffect === 'all') {
      style.boxShadow = `0 8px 25px ${effectColor}50`
    }
    if (popEffect === 'border' || popEffect === 'all') {
      style.border = `2px solid ${effectColor}`
    }
    if (popEffect === 'larger' || popEffect === 'all') {
      style.transform = 'scale(1.1)'
    }

    return style
  }

  const hasCustomization = !!(bgColor || textColor || popEffect !== 'none' || glowColor)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Customize "${itemName}"`}>
      <div className="space-y-5">
        {/* Preview */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">Preview</label>
          <div className="flex gap-4 items-center justify-center py-4 bg-gray-100 rounded-xl">
            <div
              className="px-6 py-4 rounded-xl font-semibold text-sm shadow-md"
              style={getPreviewStyle()}
            >
              {itemName}
            </div>
          </div>
        </div>

        {/* Background Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Background Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={bgColor || '#ffffff'}
              onChange={(e) => setBgColor(e.target.value)}
              className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Leave empty for default"
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setBgColor('')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
            >
              Default
            </button>
            <button
              type="button"
              onClick={() => setBgColor('#FEF3C7')}
              className="px-3 py-1 text-xs rounded-lg bg-amber-100 text-amber-800"
            >
              Gold
            </button>
            <button
              type="button"
              onClick={() => setBgColor('#DBEAFE')}
              className="px-3 py-1 text-xs rounded-lg bg-blue-100 text-blue-800"
            >
              Blue
            </button>
            <button
              type="button"
              onClick={() => setBgColor('#DCFCE7')}
              className="px-3 py-1 text-xs rounded-lg bg-green-100 text-green-800"
            >
              Green
            </button>
          </div>
        </div>

        {/* Text Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Text Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={textColor || '#374151'}
              onChange={(e) => setTextColor(e.target.value)}
              className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Leave empty for default"
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setTextColor('')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
            >
              Default
            </button>
            <button
              type="button"
              onClick={() => setTextColor('#000000')}
              className="px-3 py-1 text-xs rounded-lg bg-white text-black border border-gray-300"
            >
              Black
            </button>
            <button
              type="button"
              onClick={() => setTextColor('#FFFFFF')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-white"
            >
              White
            </button>
          </div>
        </div>

        {/* Pop Effect */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Pop Effect <span className="text-gray-400 font-normal">(make it stand out!)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPopEffect('none')}
              className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                popEffect === 'none'
                  ? 'border-gray-800 bg-gray-100'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              None
            </button>
            <button
              type="button"
              onClick={() => setPopEffect('glow')}
              className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                popEffect === 'glow'
                  ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/30'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              Glow
            </button>
            <button
              type="button"
              onClick={() => setPopEffect('larger')}
              className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                popEffect === 'larger'
                  ? 'border-purple-500 bg-purple-50 scale-105'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              Larger
            </button>
            <button
              type="button"
              onClick={() => setPopEffect('border')}
              className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                popEffect === 'border'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              Border
            </button>
            <button
              type="button"
              onClick={() => setPopEffect('all')}
              className={`col-span-2 px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                popEffect === 'all'
                  ? 'border-amber-500 bg-amber-50 shadow-lg shadow-amber-500/30 scale-105'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              All Effects (Maximum Pop!)
            </button>
          </div>
        </div>

        {/* Glow Color (only shown if glow or all effect) */}
        {(popEffect === 'glow' || popEffect === 'all' || popEffect === 'border') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Effect Color <span className="text-gray-400 font-normal">(glow/border color)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={glowColor || bgColor || '#3B82F6'}
                onChange={(e) => setGlowColor(e.target.value)}
                className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={glowColor}
                onChange={(e) => setGlowColor(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                placeholder="Leave empty to match background"
              />
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setGlowColor('')}
                className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
              >
                Match BG
              </button>
              <button
                type="button"
                onClick={() => setGlowColor('#F59E0B')}
                className="px-3 py-1 text-xs rounded-lg bg-amber-500 text-white"
              >
                Gold
              </button>
              <button
                type="button"
                onClick={() => setGlowColor('#3B82F6')}
                className="px-3 py-1 text-xs rounded-lg bg-blue-500 text-white"
              >
                Blue
              </button>
              <button
                type="button"
                onClick={() => setGlowColor('#10B981')}
                className="px-3 py-1 text-xs rounded-lg bg-emerald-500 text-white"
              >
                Green
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={handleReset}
            disabled={!hasCustomization}
          >
            Reset to Default
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

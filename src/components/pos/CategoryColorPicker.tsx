'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import type { CategoryColorOverride } from '@/lib/settings'

interface CategoryColorPickerProps {
  isOpen: boolean
  onClose: () => void
  categoryName: string
  currentColors: CategoryColorOverride
  defaultColor: string
  onSave: (colors: CategoryColorOverride) => void
  onReset: () => void
}

export function CategoryColorPicker({
  isOpen,
  onClose,
  categoryName,
  currentColors,
  defaultColor,
  onSave,
  onReset,
}: CategoryColorPickerProps) {
  const [bgColor, setBgColor] = useState(currentColors.bgColor || defaultColor)
  const [textColor, setTextColor] = useState(currentColors.textColor || '#FFFFFF')
  const [unselectedBgColor, setUnselectedBgColor] = useState(currentColors.unselectedBgColor || '')
  const [unselectedTextColor, setUnselectedTextColor] = useState(currentColors.unselectedTextColor || '')

  // Sync state when props change (e.g., opening modal for different category)
  useEffect(() => {
    setBgColor(currentColors.bgColor || defaultColor)
    setTextColor(currentColors.textColor || '#FFFFFF')
    setUnselectedBgColor(currentColors.unselectedBgColor || '')
    setUnselectedTextColor(currentColors.unselectedTextColor || '')
  }, [currentColors, defaultColor])

  const handleSave = () => {
    onSave({
      bgColor: bgColor !== defaultColor ? bgColor : null,
      textColor: textColor !== '#FFFFFF' ? textColor : null,
      unselectedBgColor: unselectedBgColor || null,
      unselectedTextColor: unselectedTextColor || null,
    })
    onClose()
  }

  const handleReset = () => {
    setBgColor(defaultColor)
    setTextColor('#FFFFFF')
    setUnselectedBgColor('')
    setUnselectedTextColor('')
    onReset()
    onClose()
  }

  // Calculate unselected preview style
  const getUnselectedStyle = () => {
    const baseStyle = {
      backgroundColor: unselectedBgColor || `${bgColor}15`,
      color: unselectedTextColor || bgColor,
      borderColor: `${bgColor}40`,
    }
    return baseStyle
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Customize "${categoryName}"`}>
      <div className="space-y-5">
        {/* Preview */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">Preview</label>
          <div className="flex gap-3">
            <div
              className="px-5 py-3 rounded-xl font-semibold text-sm shadow-lg"
              style={{
                backgroundColor: bgColor,
                color: textColor,
              }}
            >
              Selected
            </div>
            <div
              className="px-5 py-3 rounded-xl font-semibold text-sm border"
              style={getUnselectedStyle()}
            >
              {categoryName}
            </div>
          </div>
        </div>

        {/* Selected Background Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Selected Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="#3B82F6"
            />
          </div>
        </div>

        {/* Text Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Selected Text Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="#FFFFFF"
            />
          </div>
          {/* Quick presets */}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setTextColor('#FFFFFF')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-white"
            >
              White
            </button>
            <button
              type="button"
              onClick={() => setTextColor('#000000')}
              className="px-3 py-1 text-xs rounded-lg bg-white text-black border border-gray-300"
            >
              Black
            </button>
          </div>
        </div>

        {/* Unselected Background Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Unselected Color <span className="text-gray-400 font-normal">(makes it pop!)</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={unselectedBgColor || `${bgColor}30`}
              onChange={(e) => setUnselectedBgColor(e.target.value)}
              className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={unselectedBgColor}
              onChange={(e) => setUnselectedBgColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Leave empty for subtle tint"
            />
          </div>
          {/* Quick presets */}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setUnselectedBgColor('')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
            >
              Subtle Tint
            </button>
            <button
              type="button"
              onClick={() => setUnselectedBgColor(`${bgColor}40`)}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
            >
              Light Fill
            </button>
            <button
              type="button"
              onClick={() => setUnselectedBgColor(bgColor)}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
            >
              Same as Selected
            </button>
          </div>
        </div>

        {/* Unselected Text Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Unselected Text Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={unselectedTextColor || bgColor}
              onChange={(e) => setUnselectedTextColor(e.target.value)}
              className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={unselectedTextColor}
              onChange={(e) => setUnselectedTextColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Leave empty to match button color"
            />
          </div>
          {/* Quick presets */}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setUnselectedTextColor('')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 text-gray-700"
            >
              Match Button
            </button>
            <button
              type="button"
              onClick={() => setUnselectedTextColor('#FFFFFF')}
              className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-white"
            >
              White
            </button>
            <button
              type="button"
              onClick={() => setUnselectedTextColor('#000000')}
              className="px-3 py-1 text-xs rounded-lg bg-white text-black border border-gray-300"
            >
              Black
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={handleReset}
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

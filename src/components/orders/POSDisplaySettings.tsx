'use client'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Label } from '@/components/ui/label'
import type { POSDisplaySettings } from '@/lib/settings'

interface POSDisplaySettingsProps {
  isOpen: boolean
  onClose: () => void
  settings: POSDisplaySettings
  onUpdate: <K extends keyof POSDisplaySettings>(key: K, value: POSDisplaySettings[K]) => void
  onBatchUpdate?: (updates: Partial<POSDisplaySettings>) => void
}

const SIZE_OPTIONS = [
  { value: 'compact' as const, label: 'Compact', description: 'More items visible' },
  { value: 'normal' as const, label: 'Normal', description: 'Balanced view' },
  { value: 'large' as const, label: 'Large', description: 'Easier to tap' },
]

const COLUMN_OPTIONS = [
  { value: 3 as const, label: '3' },
  { value: 4 as const, label: '4' },
  { value: 5 as const, label: '5' },
  { value: 6 as const, label: '6' },
]

const CATEGORY_SIZE_OPTIONS = [
  { value: 'sm' as const, label: 'Small' },
  { value: 'md' as const, label: 'Medium' },
  { value: 'lg' as const, label: 'Large' },
]

const PANEL_WIDTH_OPTIONS = [
  { value: 'narrow' as const, label: 'Narrow', description: 'More menu space' },
  { value: 'normal' as const, label: 'Normal', description: 'Default' },
  { value: 'wide' as const, label: 'Wide', description: 'More order details' },
]

const COLOR_MODE_OPTIONS = [
  { value: 'solid' as const, label: 'Solid', description: 'Full color fill' },
  { value: 'subtle' as const, label: 'Subtle', description: 'Light tint' },
  { value: 'outline' as const, label: 'Outline', description: 'Border only' },
]

export function POSDisplaySettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onBatchUpdate,
}: POSDisplaySettingsProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Display Settings">
      <div className="space-y-6">
        {/* Menu Item Size */}
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Menu Item Size</Label>
          <div className="grid grid-cols-3 gap-2">
            {SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onUpdate('menuItemSize', option.value)}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  settings.menuItemSize === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="block font-medium text-sm">{option.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{option.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Columns Per Row */}
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Items Per Row</Label>
          <div className="flex gap-2">
            {COLUMN_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onUpdate('menuItemsPerRow', option.value)}
                className={`flex-1 py-2 rounded-lg border text-center font-medium transition-colors ${
                  settings.menuItemsPerRow === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Button Size */}
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Category Button Size</Label>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORY_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onUpdate('categorySize', option.value)}
                className={`py-2 rounded-lg border text-center font-medium transition-colors ${
                  settings.categorySize === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Order Panel Width */}
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Order Panel Width</Label>
          <div className="grid grid-cols-3 gap-2">
            {PANEL_WIDTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onUpdate('orderPanelWidth', option.value)}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  settings.orderPanelWidth === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="block font-medium text-sm">{option.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{option.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Category Color Mode */}
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Category Style</Label>
          <div className="grid grid-cols-3 gap-2">
            {COLOR_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onUpdate('categoryColorMode', option.value)}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  settings.categoryColorMode === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="block font-medium text-sm">{option.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{option.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Button Colors */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm font-medium text-gray-700">Custom Button Colors</Label>
            {(settings.categoryButtonBgColor || settings.categoryButtonTextColor) && (
              <button
                type="button"
                onClick={() => {
                  if (onBatchUpdate) {
                    onBatchUpdate({ categoryButtonBgColor: null, categoryButtonTextColor: null })
                  } else {
                    onUpdate('categoryButtonBgColor', null)
                    setTimeout(() => onUpdate('categoryButtonTextColor', null), 50)
                  }
                }}
                className="text-xs text-red-500 hover:text-red-600 font-medium"
              >
                Reset to Default
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Background Color */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Button Background</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.categoryButtonBgColor || '#3B82F6'}
                  onChange={(e) => onUpdate('categoryButtonBgColor', e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer"
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={settings.categoryButtonBgColor || ''}
                    onChange={(e) => onUpdate('categoryButtonBgColor', e.target.value || null)}
                    placeholder="Default"
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Text Color */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Button Text</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.categoryButtonTextColor || '#FFFFFF'}
                  onChange={(e) => onUpdate('categoryButtonTextColor', e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer"
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={settings.categoryButtonTextColor || ''}
                    onChange={(e) => onUpdate('categoryButtonTextColor', e.target.value || null)}
                    placeholder="Default"
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-1.5">Preview</label>
            <div className="flex gap-2">
              <div
                className="px-4 py-2 rounded-xl font-semibold text-sm"
                style={{
                  backgroundColor: settings.categoryButtonBgColor || '#3B82F6',
                  color: settings.categoryButtonTextColor || '#FFFFFF',
                }}
              >
                Selected
              </div>
              <div
                className="px-4 py-2 rounded-xl font-semibold text-sm border"
                style={{
                  backgroundColor: settings.categoryButtonBgColor ? `${settings.categoryButtonBgColor}20` : '#EFF6FF',
                  color: settings.categoryButtonBgColor || '#3B82F6',
                  borderColor: settings.categoryButtonBgColor ? `${settings.categoryButtonBgColor}50` : '#BFDBFE',
                }}
              >
                Unselected
              </div>
            </div>
          </div>
        </div>

        {/* Show Price Toggle */}
        <div className="flex items-center justify-between py-3 border-t">
          <div>
            <span className="font-medium text-sm">Show Prices on Items</span>
            <p className="text-xs text-gray-500">Display price below item name</p>
          </div>
          <button
            type="button"
            onClick={() => onUpdate('showPriceOnMenuItems', !settings.showPriceOnMenuItems)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              settings.showPriceOnMenuItems ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.showPriceOnMenuItems ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Close Button */}
        <div className="pt-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

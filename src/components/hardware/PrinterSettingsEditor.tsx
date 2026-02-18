'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PrinterSettings, DEFAULT_THERMAL_SETTINGS, DEFAULT_IMPACT_SETTINGS } from '@/types/print'

interface PrinterSettingsEditorProps {
  settings: PrinterSettings | null
  printerType: 'thermal' | 'impact'
  printerName: string
  onSave: (settings: PrinterSettings) => void
  onClose: () => void
}

export function PrinterSettingsEditor({
  settings,
  printerType,
  printerName,
  onSave,
  onClose,
}: PrinterSettingsEditorProps) {
  const defaultSettings = printerType === 'impact' ? DEFAULT_IMPACT_SETTINGS : DEFAULT_THERMAL_SETTINGS
  const [localSettings, setLocalSettings] = useState<PrinterSettings>(settings || defaultSettings)

  const updateTextSizing = (updates: Partial<PrinterSettings['textSizing']>) => {
    setLocalSettings(prev => ({
      ...prev,
      textSizing: { ...prev.textSizing, ...updates },
    }))
  }

  const updateRibbon = (updates: Partial<PrinterSettings['ribbon']>) => {
    setLocalSettings(prev => ({
      ...prev,
      ribbon: { ...prev.ribbon, ...updates },
    }))
  }

  const updateFormatting = (updates: Partial<PrinterSettings['formatting']>) => {
    setLocalSettings(prev => ({
      ...prev,
      formatting: { ...prev.formatting, ...updates },
    }))
  }

  const handleResetToDefaults = () => {
    setLocalSettings(defaultSettings)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">Printer Settings: {printerName}</h2>
          <p className="text-sm text-gray-600 mt-1">
            Configure text sizes and formatting for this {printerType} printer
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Text Sizing Section */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Text Sizing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Header Size</label>
                <select
                  value={localSettings.textSizing.headerSize}
                  onChange={(e) => updateTextSizing({ headerSize: e.target.value as 'normal' | 'large' | 'xlarge' })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                  <option value="xlarge">Extra Large</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">KITCHEN header, order number</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Item Name Size</label>
                <select
                  value={localSettings.textSizing.itemNameSize}
                  onChange={(e) => updateTextSizing({ itemNameSize: e.target.value as 'normal' | 'large' | 'xlarge' })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                  <option value="xlarge">Extra Large</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">e.g., "2x Pepperoni Pizza"</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Modifier Size</label>
                <select
                  value={localSettings.textSizing.modifierSize}
                  onChange={(e) => updateTextSizing({ modifierSize: e.target.value as 'small' | 'normal' | 'large' })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="small">Small</option>
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Modifiers and toppings</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes Size</label>
                <select
                  value={localSettings.textSizing.notesSize}
                  onChange={(e) => updateTextSizing({ notesSize: e.target.value as 'normal' | 'large' })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Special notes and instructions</p>
              </div>
            </div>
          </div>

          {/* Ribbon/Color Section - Only for impact printers or if enabled */}
          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Two-Color Ribbon (Red/Black)</h3>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={localSettings.ribbon.hasRedRibbon}
                  onChange={(e) => updateRibbon({ hasRedRibbon: e.target.checked })}
                  className="w-5 h-5 rounded"
                />
                <span className="text-sm font-medium">Has Red Ribbon</span>
              </label>
            </div>

            {localSettings.ribbon.hasRedRibbon && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 mb-3">
                  Select which elements should print in <span className="text-red-600 font-semibold">RED</span>:
                </p>

                <label className="flex items-center gap-3 p-2 bg-white rounded hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={localSettings.ribbon.useRedForResend}
                    onChange={(e) => updateRibbon({ useRedForResend: e.target.checked })}
                    className="w-5 h-5 rounded"
                  />
                  <div>
                    <span className="font-medium">RESEND</span>
                    <p className="text-xs text-gray-500">Print "RESEND" banner in red</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2 bg-white rounded hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={localSettings.ribbon.useRedForNoItems}
                    onChange={(e) => updateRibbon({ useRedForNoItems: e.target.checked })}
                    className="w-5 h-5 rounded"
                  />
                  <div>
                    <span className="font-medium">NO Items (Critical)</span>
                    <p className="text-xs text-gray-500">Print "NO [ingredient]" in red for allergies</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2 bg-white rounded hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={localSettings.ribbon.useRedForAllergies}
                    onChange={(e) => updateRibbon({ useRedForAllergies: e.target.checked })}
                    className="w-5 h-5 rounded"
                  />
                  <div>
                    <span className="font-medium">Allergy Warnings</span>
                    <p className="text-xs text-gray-500">Print allergy alerts in red</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2 bg-white rounded hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={localSettings.ribbon.useRedForNotes}
                    onChange={(e) => updateRibbon({ useRedForNotes: e.target.checked })}
                    className="w-5 h-5 rounded"
                  />
                  <div>
                    <span className="font-medium">Special Notes</span>
                    <p className="text-xs text-gray-500">Print special instructions in red</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2 bg-white rounded hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={localSettings.ribbon.useRedForHeaders}
                    onChange={(e) => updateRibbon({ useRedForHeaders: e.target.checked })}
                    className="w-5 h-5 rounded"
                  />
                  <div>
                    <span className="font-medium">Headers</span>
                    <p className="text-xs text-gray-500">Print "KITCHEN" and order number in red</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Formatting Section */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Formatting</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={localSettings.formatting.allCapsItems}
                  onChange={(e) => updateFormatting({ allCapsItems: e.target.checked })}
                  className="w-5 h-5 rounded"
                />
                <div>
                  <span className="font-medium">ITEM NAMES IN ALL CAPS</span>
                  <p className="text-xs text-gray-500">Print item names in uppercase</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={localSettings.formatting.allCapsMods}
                  onChange={(e) => updateFormatting({ allCapsMods: e.target.checked })}
                  className="w-5 h-5 rounded"
                />
                <div>
                  <span className="font-medium">MODIFIERS IN ALL CAPS</span>
                  <p className="text-xs text-gray-500">Print modifiers and toppings in uppercase</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={localSettings.formatting.compactSpacing}
                  onChange={(e) => updateFormatting({ compactSpacing: e.target.checked })}
                  className="w-5 h-5 rounded"
                />
                <div>
                  <span className="font-medium">Compact Spacing</span>
                  <p className="text-xs text-gray-500">Reduce line spacing for busy kitchens</p>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1">Divider Style</label>
                <select
                  value={localSettings.formatting.dividerStyle}
                  onChange={(e) => updateFormatting({ dividerStyle: e.target.value as 'dashes' | 'equals' | 'stars' | 'none' })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="dashes">--- Dashes ---</option>
                  <option value="equals">=== Equals ===</option>
                  <option value="stars">*** Stars ***</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50 flex justify-between">
          <Button variant="outline" onClick={handleResetToDefaults}>
            Reset to Defaults
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onSave(localSettings)}>
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

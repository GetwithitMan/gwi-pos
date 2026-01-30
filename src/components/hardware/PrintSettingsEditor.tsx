'use client'

import { useState } from 'react'
import type { PrintTemplateSettings } from '@/types/print-settings'
import { DEFAULT_KITCHEN_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from '@/types/print-settings'

interface PrintSettingsEditorProps {
  settings: PrintTemplateSettings
  printerRole: 'receipt' | 'kitchen' | 'bar'
  onSave: (settings: PrintTemplateSettings) => void
  onCancel: () => void
}

type TabId = 'header' | 'orderInfo' | 'items' | 'modifiers' | 'instructions' | 'layout' | 'footer' | 'kitchen'

export default function PrintSettingsEditor({
  settings,
  printerRole,
  onSave,
  onCancel,
}: PrintSettingsEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('items')
  const [localSettings, setLocalSettings] = useState<PrintTemplateSettings>(settings)

  const tabs: { id: TabId; label: string; showFor: ('receipt' | 'kitchen' | 'bar')[] }[] = [
    { id: 'header', label: 'Header', showFor: ['receipt'] },
    { id: 'orderInfo', label: 'Order Info', showFor: ['receipt', 'kitchen', 'bar'] },
    { id: 'items', label: 'Items', showFor: ['receipt', 'kitchen', 'bar'] },
    { id: 'modifiers', label: 'Modifiers', showFor: ['receipt', 'kitchen', 'bar'] },
    { id: 'instructions', label: 'Notes', showFor: ['receipt', 'kitchen', 'bar'] },
    { id: 'layout', label: 'Layout', showFor: ['receipt', 'kitchen', 'bar'] },
    { id: 'footer', label: 'Footer', showFor: ['receipt'] },
    { id: 'kitchen', label: 'Kitchen', showFor: ['kitchen', 'bar'] },
  ]

  const visibleTabs = tabs.filter(tab => tab.showFor.includes(printerRole))

  const updateSetting = <K extends keyof PrintTemplateSettings>(
    section: K,
    field: keyof PrintTemplateSettings[K],
    value: PrintTemplateSettings[K][typeof field]
  ) => {
    setLocalSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }))
  }

  const handleReset = () => {
    const defaultTemplate = printerRole === 'receipt' ? DEFAULT_RECEIPT_TEMPLATE : DEFAULT_KITCHEN_TEMPLATE
    setLocalSettings(defaultTemplate)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Print Template Settings</h2>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-2 bg-gray-900 border-b border-gray-700 overflow-x-auto">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Header Settings */}
          {activeTab === 'header' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Receipt Header</h3>

              <Toggle
                label="Show Logo"
                checked={localSettings.header.showLogo}
                onChange={(v) => updateSetting('header', 'showLogo', v)}
              />

              <TextInput
                label="Business Name"
                value={localSettings.header.businessName}
                onChange={(v) => updateSetting('header', 'businessName', v)}
              />

              <Toggle
                label="Show Address"
                checked={localSettings.header.showAddress}
                onChange={(v) => updateSetting('header', 'showAddress', v)}
              />

              {localSettings.header.showAddress && (
                <TextInput
                  label="Address"
                  value={localSettings.header.address || ''}
                  onChange={(v) => updateSetting('header', 'address', v)}
                />
              )}

              <Toggle
                label="Show Phone"
                checked={localSettings.header.showPhone}
                onChange={(v) => updateSetting('header', 'showPhone', v)}
              />

              {localSettings.header.showPhone && (
                <TextInput
                  label="Phone"
                  value={localSettings.header.phone || ''}
                  onChange={(v) => updateSetting('header', 'phone', v)}
                />
              )}

              <TextInput
                label="Custom Header Text"
                value={localSettings.header.customText || ''}
                onChange={(v) => updateSetting('header', 'customText', v)}
                placeholder="e.g., Welcome!"
              />
            </div>
          )}

          {/* Order Info Settings */}
          {activeTab === 'orderInfo' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Order Information</h3>

              <Toggle
                label="Show Order Number"
                checked={localSettings.orderInfo.showOrderNumber}
                onChange={(v) => updateSetting('orderInfo', 'showOrderNumber', v)}
              />

              {localSettings.orderInfo.showOrderNumber && (
                <Select
                  label="Order Number Size"
                  value={localSettings.orderInfo.orderNumberSize}
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'large', label: 'Large' },
                    { value: 'xlarge', label: 'Extra Large' },
                  ]}
                  onChange={(v) => updateSetting('orderInfo', 'orderNumberSize', v as 'normal' | 'large' | 'xlarge')}
                />
              )}

              <Toggle
                label="Show Order Type"
                checked={localSettings.orderInfo.showOrderType}
                onChange={(v) => updateSetting('orderInfo', 'showOrderType', v)}
              />

              <Toggle
                label="Show Table Name"
                checked={localSettings.orderInfo.showTableName}
                onChange={(v) => updateSetting('orderInfo', 'showTableName', v)}
              />

              <Toggle
                label="Show Server Name"
                checked={localSettings.orderInfo.showServerName}
                onChange={(v) => updateSetting('orderInfo', 'showServerName', v)}
              />

              <Toggle
                label="Show Date/Time"
                checked={localSettings.orderInfo.showDateTime}
                onChange={(v) => updateSetting('orderInfo', 'showDateTime', v)}
              />

              <Toggle
                label="Show Guest Count"
                checked={localSettings.orderInfo.showGuestCount}
                onChange={(v) => updateSetting('orderInfo', 'showGuestCount', v)}
              />
            </div>
          )}

          {/* Item Display Settings */}
          {activeTab === 'items' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Item Display</h3>

              <Select
                label="Font Size"
                value={localSettings.items.fontSize}
                options={[
                  { value: 'small', label: 'Small' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'large', label: 'Large' },
                ]}
                onChange={(v) => updateSetting('items', 'fontSize', v as 'small' | 'normal' | 'large')}
              />

              <Toggle
                label="Item Name Bold"
                checked={localSettings.items.itemNameBold}
                onChange={(v) => updateSetting('items', 'itemNameBold', v)}
              />

              <Toggle
                label="Show Prices"
                checked={localSettings.items.showPrices}
                onChange={(v) => updateSetting('items', 'showPrices', v)}
              />

              {localSettings.items.showPrices && (
                <Select
                  label="Price Alignment"
                  value={localSettings.items.priceAlignment}
                  options={[
                    { value: 'right', label: 'Right Column' },
                    { value: 'same-line', label: 'Same Line as Item' },
                  ]}
                  onChange={(v) => updateSetting('items', 'priceAlignment', v as 'right' | 'same-line')}
                />
              )}

              <Toggle
                label="Show Quantity"
                checked={localSettings.items.showQuantity}
                onChange={(v) => updateSetting('items', 'showQuantity', v)}
              />

              {localSettings.items.showQuantity && (
                <Select
                  label="Quantity Style"
                  value={localSettings.items.quantityStyle}
                  options={[
                    { value: 'prefix', label: 'Prefix (2x Burger)' },
                    { value: 'suffix', label: 'Suffix (Burger x2)' },
                    { value: 'column', label: 'Separate Column' },
                  ]}
                  onChange={(v) => updateSetting('items', 'quantityStyle', v as 'prefix' | 'suffix' | 'column')}
                />
              )}
            </div>
          )}

          {/* Modifier Display Settings */}
          {activeTab === 'modifiers' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Modifier Display</h3>

              <Select
                label="Font Size"
                value={localSettings.modifiers.fontSize}
                options={[
                  { value: 'small', label: 'Small' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'large', label: 'Large' },
                ]}
                onChange={(v) => updateSetting('modifiers', 'fontSize', v as 'small' | 'normal' | 'large')}
              />

              <Toggle
                label="Bold Modifiers"
                checked={localSettings.modifiers.bold}
                onChange={(v) => updateSetting('modifiers', 'bold', v)}
              />

              <Toggle
                label="Indent Under Items"
                checked={localSettings.modifiers.indent}
                onChange={(v) => updateSetting('modifiers', 'indent', v)}
              />

              {localSettings.modifiers.indent && (
                <Select
                  label="Indent Style"
                  value={localSettings.modifiers.indentStyle}
                  options={[
                    { value: 'spaces', label: 'Spaces (  Ranch)' },
                    { value: 'dash', label: 'Dash (- Ranch)' },
                    { value: 'arrow', label: 'Arrow (> Ranch)' },
                  ]}
                  onChange={(v) => updateSetting('modifiers', 'indentStyle', v as 'spaces' | 'dash' | 'arrow')}
                />
              )}

              <Toggle
                label="Show Modifier Prices"
                checked={localSettings.modifiers.showPrices}
                onChange={(v) => updateSetting('modifiers', 'showPrices', v)}
              />

              <Toggle
                label="Show Pre-Modifiers (NO, EXTRA, etc.)"
                checked={localSettings.modifiers.showPreModifiers}
                onChange={(v) => updateSetting('modifiers', 'showPreModifiers', v)}
              />

              {localSettings.modifiers.showPreModifiers && (
                <Select
                  label="Pre-Modifier Style"
                  value={localSettings.modifiers.preModifierStyle}
                  options={[
                    { value: 'uppercase', label: 'Uppercase (NO Onion)' },
                    { value: 'prefix', label: 'Prefix (No: Onion)' },
                  ]}
                  onChange={(v) => updateSetting('modifiers', 'preModifierStyle', v as 'uppercase' | 'prefix')}
                />
              )}

              <Toggle
                label="Group Modifiers by Type"
                checked={localSettings.modifiers.groupByType}
                onChange={(v) => updateSetting('modifiers', 'groupByType', v)}
              />
            </div>
          )}

          {/* Special Instructions Settings */}
          {activeTab === 'instructions' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Special Instructions / Notes</h3>

              <Toggle
                label="Show Special Instructions"
                checked={localSettings.specialInstructions.show}
                onChange={(v) => updateSetting('specialInstructions', 'show', v)}
              />

              {localSettings.specialInstructions.show && (
                <>
                  <Select
                    label="Font Size"
                    value={localSettings.specialInstructions.fontSize}
                    options={[
                      { value: 'small', label: 'Small' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'large', label: 'Large' },
                    ]}
                    onChange={(v) => updateSetting('specialInstructions', 'fontSize', v as 'small' | 'normal' | 'large')}
                  />

                  <Toggle
                    label="Bold"
                    checked={localSettings.specialInstructions.bold}
                    onChange={(v) => updateSetting('specialInstructions', 'bold', v)}
                  />

                  <Toggle
                    label="Draw Box Around Notes"
                    checked={localSettings.specialInstructions.boxed}
                    onChange={(v) => updateSetting('specialInstructions', 'boxed', v)}
                  />

                  <TextInput
                    label="Label"
                    value={localSettings.specialInstructions.label}
                    onChange={(v) => updateSetting('specialInstructions', 'label', v)}
                    placeholder="e.g., *** NOTES ***"
                  />
                </>
              )}
            </div>
          )}

          {/* Layout Settings */}
          {activeTab === 'layout' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Layout & Spacing</h3>

              <Select
                label="Divider Style"
                value={localSettings.layout.dividerStyle}
                options={[
                  { value: 'dashes', label: 'Dashes (-------)' },
                  { value: 'equals', label: 'Equals (=======)' },
                  { value: 'dots', label: 'Dots (.......)' },
                  { value: 'stars', label: 'Stars (*******)' },
                  { value: 'blank', label: 'Blank Line' },
                ]}
                onChange={(v) => updateSetting('layout', 'dividerStyle', v as 'dashes' | 'equals' | 'dots' | 'stars' | 'blank')}
              />

              <Select
                label="Item Spacing"
                value={localSettings.layout.itemSpacing}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'spacious', label: 'Spacious' },
                ]}
                onChange={(v) => updateSetting('layout', 'itemSpacing', v as 'compact' | 'normal' | 'spacious')}
              />

              <NumberInput
                label="Lines Between Sections"
                value={localSettings.layout.sectionSpacing}
                min={0}
                max={5}
                onChange={(v) => updateSetting('layout', 'sectionSpacing', v)}
              />
            </div>
          )}

          {/* Footer Settings */}
          {activeTab === 'footer' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Receipt Footer</h3>

              <Toggle
                label="Show Subtotal"
                checked={localSettings.footer.showSubtotal}
                onChange={(v) => updateSetting('footer', 'showSubtotal', v)}
              />

              <Toggle
                label="Show Tax"
                checked={localSettings.footer.showTax}
                onChange={(v) => updateSetting('footer', 'showTax', v)}
              />

              <Toggle
                label="Show Total"
                checked={localSettings.footer.showTotal}
                onChange={(v) => updateSetting('footer', 'showTotal', v)}
              />

              {localSettings.footer.showTotal && (
                <>
                  <Select
                    label="Total Size"
                    value={localSettings.footer.totalSize}
                    options={[
                      { value: 'normal', label: 'Normal' },
                      { value: 'large', label: 'Large' },
                      { value: 'xlarge', label: 'Extra Large' },
                    ]}
                    onChange={(v) => updateSetting('footer', 'totalSize', v as 'normal' | 'large' | 'xlarge')}
                  />

                  <Toggle
                    label="Bold Total"
                    checked={localSettings.footer.totalBold}
                    onChange={(v) => updateSetting('footer', 'totalBold', v)}
                  />
                </>
              )}

              <Toggle
                label="Show Tip Line"
                checked={localSettings.footer.showTipLine}
                onChange={(v) => updateSetting('footer', 'showTipLine', v)}
              />

              <Toggle
                label="Show Signature Line"
                checked={localSettings.footer.showSignatureLine}
                onChange={(v) => updateSetting('footer', 'showSignatureLine', v)}
              />

              <TextInput
                label="Custom Footer Text"
                value={localSettings.footer.customText || ''}
                onChange={(v) => updateSetting('footer', 'customText', v)}
                placeholder="e.g., Thank you for your business!"
              />

              <Toggle
                label="Show Order Barcode"
                checked={localSettings.footer.showBarcode}
                onChange={(v) => updateSetting('footer', 'showBarcode', v)}
              />
            </div>
          )}

          {/* Kitchen-Specific Settings */}
          {activeTab === 'kitchen' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white mb-4">Kitchen Ticket Settings</h3>

              <Toggle
                label="Show Course Number"
                checked={localSettings.kitchen.showCourseNumber}
                onChange={(v) => updateSetting('kitchen', 'showCourseNumber', v)}
              />

              <Toggle
                label="Show Seat Number"
                checked={localSettings.kitchen.showSeatNumber}
                onChange={(v) => updateSetting('kitchen', 'showSeatNumber', v)}
              />

              <Toggle
                label="Highlight Allergies"
                checked={localSettings.kitchen.highlightAllergies}
                onChange={(v) => updateSetting('kitchen', 'highlightAllergies', v)}
              />

              {localSettings.kitchen.highlightAllergies && (
                <Select
                  label="Allergy Highlight Style"
                  value={localSettings.kitchen.allergyStyle}
                  options={[
                    { value: 'bold', label: 'Bold' },
                    { value: 'boxed', label: 'Boxed' },
                    { value: 'uppercase', label: 'UPPERCASE' },
                  ]}
                  onChange={(v) => updateSetting('kitchen', 'allergyStyle', v as 'bold' | 'boxed' | 'uppercase')}
                />
              )}

              <Toggle
                label="Show Prep Station"
                checked={localSettings.kitchen.showPrepStation}
                onChange={(v) => updateSetting('kitchen', 'showPrepStation', v)}
              />

              <Toggle
                label="Consolidate Items (2x Burger instead of Burger, Burger)"
                checked={localSettings.kitchen.consolidateItems}
                onChange={(v) => updateSetting('kitchen', 'consolidateItems', v)}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between bg-gray-800">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white"
          >
            Reset to Defaults
          </button>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(localSettings)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-500"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper Components

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700">
      <span className="text-gray-200">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="p-3 bg-gray-700/50 rounded-lg">
      <label className="block text-sm text-gray-400 mb-2">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="p-3 bg-gray-700/50 rounded-lg">
      <label className="block text-sm text-gray-400 mb-2">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="p-3 bg-gray-700/50 rounded-lg">
      <label className="block text-sm text-gray-400 mb-2">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PizzaPrintSettings, DEFAULT_PIZZA_PRINT_SETTINGS, PIZZA_PRINT_PRESETS } from '@/types/print'

interface PizzaPrintSettingsEditorProps {
  settings: PizzaPrintSettings | null
  onSave: (settings: PizzaPrintSettings) => void
  onClose: () => void
}

type TabType = 'textSize' | 'redRibbon' | 'formatting' | 'modifications' | 'instructions' | 'layout'

// Receipt Preview Component
function ReceiptPreview({ settings }: { settings: PizzaPrintSettings }) {
  const getTextSize = (size: string) => {
    switch (size) {
      case 'small': return 'text-xs'
      case 'normal': return 'text-sm'
      case 'large': return 'text-base font-bold'
      case 'xlarge': return 'text-lg font-bold'
      default: return 'text-sm'
    }
  }

  const isRed = (setting: boolean | undefined) => settings.redRibbon?.enabled && setting
  const redClass = 'text-red-600'

  const getStyle = (style: string | undefined) => {
    if (!style) return ''
    if (style.includes('red')) return redClass
    if (style === 'inverted') return 'bg-black text-white px-1'
    if (style === 'bold') return 'font-bold'
    if (style === 'boxed') return 'border border-black px-1'
    return ''
  }

  const caps = (text: string, shouldCaps: boolean | undefined) => shouldCaps ? text.toUpperCase() : text

  return (
    <div className="bg-white border-2 border-gray-300 rounded p-3 font-mono text-xs w-64 shadow-inner" style={{ minHeight: '400px' }}>
      {/* Header */}
      <div className="text-center border-b border-dashed border-gray-400 pb-2 mb-2">
        <div className={`${getTextSize(settings.textSizing?.headerSize || 'large')} ${isRed(settings.redRibbon?.useRedForHeaders) ? redClass : ''}`}>
          KITCHEN
        </div>
        <div className={`${getTextSize(settings.header?.orderNumberSize || 'large')} ${isRed(settings.redRibbon?.useRedForHeaders) ? redClass : ''}`}>
          #1234 DINE IN
        </div>
        <div className="text-xs text-gray-600">Table 5</div>
        <div className="text-xs text-gray-600">Server: John</div>
      </div>

      {/* Divider */}
      <div className="text-center text-gray-400 my-1">
        {settings.sections?.sectionDivider === 'dashes' && '------------------------'}
        {settings.sections?.sectionDivider === 'equals' && '========================'}
        {settings.sections?.sectionDivider === 'stars' && '************************'}
        {settings.sections?.sectionDivider === 'double-line' && '════════════════════════'}
        {settings.sections?.sectionDivider === 'blank' && <div className="h-2" />}
      </div>

      {/* Item Name */}
      <div className={`${getTextSize(settings.textSizing?.itemNameSize || 'large')} ${isRed(settings.redRibbon?.useRedForItemNames) ? redClass : ''} ${settings.formatting?.boldItemNames ? 'font-bold' : ''}`}>
        {caps('2x Large Pepperoni Pizza', settings.formatting?.allCapsItemNames)}
      </div>

      {/* Section Header */}
      {settings.sections?.useSectionHeaders && (
        <div className={`mt-2 ${getTextSize(settings.textSizing?.sectionHeaderSize || 'large')} ${getStyle(settings.sections?.sectionHeaderStyle)} ${isRed(settings.redRibbon?.useRedForSectionHeaders) ? redClass : ''}`}>
          {caps(settings.sections?.showSectionLabels === 'abbreviated' ? '[L]' : settings.sections?.showSectionLabels === 'numbered' ? '[1/2]' : '[LEFT HALF]', settings.formatting?.allCapsSectionHeaders)}
        </div>
      )}

      {/* Toppings */}
      <div className={`${settings.toppings?.indentToppings ? 'ml-3' : ''} ${getTextSize(settings.textSizing?.modifierSize || 'normal')} ${isRed(settings.redRibbon?.useRedForModifiers) ? redClass : ''} ${settings.toppings?.boldToppings ? 'font-bold' : ''}`}>
        {settings.toppings?.numberToppings && '1. '}
        {caps('Pepperoni', settings.toppings?.allCaps)}
      </div>
      <div className={`${settings.toppings?.indentToppings ? 'ml-3' : ''} ${getTextSize(settings.textSizing?.modifierSize || 'normal')} ${isRed(settings.redRibbon?.useRedForModifiers) ? redClass : ''} ${settings.toppings?.boldToppings ? 'font-bold' : ''}`}>
        {settings.toppings?.numberToppings && '2. '}
        {caps('Mushrooms', settings.toppings?.allCaps)}
      </div>

      {/* EXTRA Item */}
      {settings.modifications?.highlightExtra && (
        <div className={`${settings.toppings?.indentToppings ? 'ml-3' : ''} ${getTextSize(settings.textSizing?.modifierSize || 'normal')} ${getStyle(settings.modifications?.extraStyle)} ${isRed(settings.redRibbon?.useRedForExtraItems) ? redClass : ''}`}>
          {caps(`${settings.modifications?.extraPrefix || 'EXTRA'} Cheese`, settings.formatting?.allCapsModifiers)}
        </div>
      )}

      {/* LIGHT Item */}
      {settings.modifications?.highlightLight && (
        <div className={`${settings.toppings?.indentToppings ? 'ml-3' : ''} ${getTextSize(settings.textSizing?.modifierSize || 'normal')} ${getStyle(settings.modifications?.lightStyle)} ${isRed(settings.redRibbon?.useRedForLightItems) ? redClass : ''}`}>
          {caps(`${settings.modifications?.lightPrefix || 'LIGHT'} Sauce`, settings.formatting?.allCapsModifiers)}
        </div>
      )}

      {/* NO Item */}
      {settings.modifications?.highlightNo && (
        <div className={`mt-2 ${getTextSize(settings.modifications?.noStyle === 'all' ? 'large' : (settings.textSizing?.modifierSize || 'normal'))} ${getStyle(settings.modifications?.noStyle)} ${isRed(settings.redRibbon?.useRedForNoItems) ? redClass : ''}`}>
          {settings.modifications?.noStyle === 'boxed' && '['}
          {settings.modifications?.noStyle === 'all' && '** '}
          {caps(`${settings.modifications?.noPrefix || 'NO'} Onions`, true)}
          {settings.modifications?.noStyle === 'all' && ' **'}
          {settings.modifications?.noStyle === 'boxed' && ']'}
        </div>
      )}

      {/* Special Instructions */}
      {settings.specialInstructions?.show && (
        <div className={`mt-2 ${getTextSize(settings.textSizing?.notesSize || 'large')} ${getStyle(settings.specialInstructions?.style)} ${isRed(settings.redRibbon?.useRedForNotes) ? redClass : ''}`}>
          {settings.specialInstructions?.style === 'boxed' && '['}
          {caps(`${settings.specialInstructions?.label || 'SPECIAL:'} Well done, cut in squares`, settings.specialInstructions?.allCaps)}
          {settings.specialInstructions?.style === 'boxed' && ']'}
        </div>
      )}

      {/* Allergy Alert */}
      {settings.allergyAlerts?.highlightAllergies && (
        <div className={`mt-2 ${getStyle(settings.allergyAlerts?.allergyStyle)} ${isRed(settings.redRibbon?.useRedForAllergies) ? redClass : ''} font-bold`}>
          {settings.allergyAlerts?.allergyLabel || '*** ALLERGY ***'}
          <div className="text-xs">Gluten allergy - use GF crust</div>
        </div>
      )}

      {/* Footer */}
      {settings.footer?.showToppingCount && (
        <div className="mt-2 text-xs text-gray-600">Total toppings: 4</div>
      )}
      {settings.footer?.repeatSizeAtBottom && (
        <div className="mt-1 font-bold">LARGE - 14"</div>
      )}

      {/* Divider */}
      <div className="text-center text-gray-400 mt-2">
        {settings.sections?.sectionDivider === 'dashes' && '------------------------'}
        {settings.sections?.sectionDivider === 'equals' && '========================'}
        {settings.sections?.sectionDivider === 'stars' && '************************'}
        {settings.sections?.sectionDivider === 'double-line' && '════════════════════════'}
      </div>

      <div className="text-center text-xs text-gray-500 mt-2">
        {new Date().toLocaleTimeString()}
      </div>
    </div>
  )
}

export function PizzaPrintSettingsEditor({ settings, onSave, onClose }: PizzaPrintSettingsEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('textSize')
  const [localSettings, setLocalSettings] = useState<PizzaPrintSettings>(
    settings || DEFAULT_PIZZA_PRINT_SETTINGS
  )

  const updateSettings = <K extends keyof PizzaPrintSettings>(
    section: K,
    updates: Partial<PizzaPrintSettings[K]>
  ) => {
    setLocalSettings(prev => ({
      ...prev,
      [section]: { ...prev[section], ...updates }
    }))
  }

  const applyPreset = (presetName: keyof typeof PIZZA_PRINT_PRESETS) => {
    setLocalSettings(PIZZA_PRINT_PRESETS[presetName])
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'textSize', label: 'Text Size' },
    { id: 'redRibbon', label: 'Red/Color' },
    { id: 'formatting', label: 'Formatting' },
    { id: 'modifications', label: 'Mods' },
    { id: 'instructions', label: 'Notes' },
    { id: 'layout', label: 'Layout' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl flex flex-col">
        {/* Header */}
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Pizza Print Settings</h2>
            <p className="text-xs text-gray-500">Configure kitchen ticket appearance - preview updates live</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              onChange={(e) => applyPreset(e.target.value as keyof typeof PIZZA_PRINT_PRESETS)}
              className="p-1.5 border rounded text-sm"
              defaultValue=""
            >
              <option value="" disabled>Preset...</option>
              <option value="standard">Standard</option>
              <option value="compact">Compact</option>
              <option value="highVisibility">High Visibility</option>
              <option value="impactPrinter">Impact Printer (TM-U220)</option>
            </select>
          </div>
        </div>

        {/* Main Content - Settings + Preview */}
        <div className="flex">
          {/* Left: Settings */}
          <div className="flex-1 border-r">
            {/* Tabs */}
            <div className="flex border-b px-2 bg-gray-50">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2 font-medium text-sm border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-orange-500 text-orange-600 bg-white'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="p-4">
              {/* TEXT SIZE TAB */}
              {activeTab === 'textSize' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Header Size</label>
                    <select value={localSettings.textSizing?.headerSize || 'large'}
                      onChange={(e) => updateSettings('textSizing', { headerSize: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                      <option value="xlarge">X-Large</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Item Name Size</label>
                    <select value={localSettings.textSizing?.itemNameSize || 'large'}
                      onChange={(e) => updateSettings('textSizing', { itemNameSize: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                      <option value="xlarge">X-Large</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Modifier/Topping Size</label>
                    <select value={localSettings.textSizing?.modifierSize || 'normal'}
                      onChange={(e) => updateSettings('textSizing', { modifierSize: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="small">Small</option>
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Section Header Size</label>
                    <select value={localSettings.textSizing?.sectionHeaderSize || 'large'}
                      onChange={(e) => updateSettings('textSizing', { sectionHeaderSize: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                      <option value="xlarge">X-Large</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Notes Size</label>
                    <select value={localSettings.textSizing?.notesSize || 'large'}
                      onChange={(e) => updateSettings('textSizing', { notesSize: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Order # Size</label>
                    <select value={localSettings.header?.orderNumberSize || 'large'}
                      onChange={(e) => updateSettings('header', { orderNumberSize: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                      <option value="xlarge">X-Large</option>
                    </select>
                  </div>
                </div>
              )}

              {/* RED/COLOR TAB */}
              {activeTab === 'redRibbon' && (
                <div>
                  <label className="flex items-center gap-2 mb-3 p-2 bg-red-100 rounded border border-red-300">
                    <input type="checkbox" checked={localSettings.redRibbon?.enabled ?? true}
                      onChange={(e) => updateSettings('redRibbon', { enabled: e.target.checked })}
                      className="w-5 h-5" />
                    <span className="font-bold text-red-800">Enable Red Printing (TM-U220)</span>
                  </label>

                  {localSettings.redRibbon?.enabled && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 p-2 bg-red-50 rounded text-sm border border-red-200">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForNoItems ?? true}
                          onChange={(e) => updateSettings('redRibbon', { useRedForNoItems: e.target.checked })} className="w-4 h-4" />
                        <span className="font-medium text-red-700">NO Items</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-red-50 rounded text-sm border border-red-200">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForAllergies ?? true}
                          onChange={(e) => updateSettings('redRibbon', { useRedForAllergies: e.target.checked })} className="w-4 h-4" />
                        <span className="font-medium text-red-700">Allergies</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-red-50 rounded text-sm border border-red-200">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForResend ?? true}
                          onChange={(e) => updateSettings('redRibbon', { useRedForResend: e.target.checked })} className="w-4 h-4" />
                        <span className="font-medium text-red-700">RESEND</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForNotes ?? true}
                          onChange={(e) => updateSettings('redRibbon', { useRedForNotes: e.target.checked })} className="w-4 h-4" />
                        <span>Notes/Instructions</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForModifiers ?? false}
                          onChange={(e) => updateSettings('redRibbon', { useRedForModifiers: e.target.checked })} className="w-4 h-4" />
                        <span>All Modifiers/Toppings</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForExtraItems ?? false}
                          onChange={(e) => updateSettings('redRibbon', { useRedForExtraItems: e.target.checked })} className="w-4 h-4" />
                        <span>EXTRA Items</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForLightItems ?? false}
                          onChange={(e) => updateSettings('redRibbon', { useRedForLightItems: e.target.checked })} className="w-4 h-4" />
                        <span>LIGHT Items</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForItemNames ?? false}
                          onChange={(e) => updateSettings('redRibbon', { useRedForItemNames: e.target.checked })} className="w-4 h-4" />
                        <span>Item Names</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForHeaders ?? false}
                          onChange={(e) => updateSettings('redRibbon', { useRedForHeaders: e.target.checked })} className="w-4 h-4" />
                        <span>Headers</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                        <input type="checkbox" checked={localSettings.redRibbon?.useRedForSectionHeaders ?? false}
                          onChange={(e) => updateSettings('redRibbon', { useRedForSectionHeaders: e.target.checked })} className="w-4 h-4" />
                        <span>Section Headers</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* FORMATTING TAB */}
              {activeTab === 'formatting' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.formatting?.allCapsItemNames ?? true}
                      onChange={(e) => updateSettings('formatting', { allCapsItemNames: e.target.checked })} className="w-4 h-4" />
                    <span>ITEM NAMES CAPS</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.formatting?.allCapsModifiers ?? true}
                      onChange={(e) => updateSettings('formatting', { allCapsModifiers: e.target.checked })} className="w-4 h-4" />
                    <span>MODIFIERS CAPS</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.formatting?.boldItemNames ?? true}
                      onChange={(e) => updateSettings('formatting', { boldItemNames: e.target.checked })} className="w-4 h-4" />
                    <span>Bold Item Names</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.formatting?.boldModifiers ?? false}
                      onChange={(e) => updateSettings('formatting', { boldModifiers: e.target.checked })} className="w-4 h-4" />
                    <span>Bold Modifiers</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.toppings?.allCaps ?? true}
                      onChange={(e) => updateSettings('toppings', { allCaps: e.target.checked })} className="w-4 h-4" />
                    <span>TOPPINGS CAPS</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.toppings?.boldToppings ?? false}
                      onChange={(e) => updateSettings('toppings', { boldToppings: e.target.checked })} className="w-4 h-4" />
                    <span>Bold Toppings</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.toppings?.indentToppings ?? true}
                      onChange={(e) => updateSettings('toppings', { indentToppings: e.target.checked })} className="w-4 h-4" />
                    <span>Indent Toppings</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.toppings?.numberToppings ?? false}
                      onChange={(e) => updateSettings('toppings', { numberToppings: e.target.checked })} className="w-4 h-4" />
                    <span>Number Toppings (1. 2. 3.)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.sections?.useSectionHeaders ?? true}
                      onChange={(e) => updateSettings('sections', { useSectionHeaders: e.target.checked })} className="w-4 h-4" />
                    <span>Section Headers [LEFT/RIGHT]</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.formatting?.compactSpacing ?? false}
                      onChange={(e) => updateSettings('formatting', { compactSpacing: e.target.checked })} className="w-4 h-4" />
                    <span>Compact Spacing</span>
                  </label>
                  <div>
                    <label className="block text-xs font-medium mb-1">Section Style</label>
                    <select value={localSettings.sections?.sectionHeaderStyle || 'bold'}
                      onChange={(e) => updateSettings('sections', { sectionHeaderStyle: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="uppercase">UPPERCASE</option>
                      <option value="bold">Bold</option>
                      <option value="boxed">[Boxed]</option>
                      <option value="red">🔴 Red</option>
                      <option value="red-bold">🔴 Red Bold</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Divider Style</label>
                    <select value={localSettings.sections?.sectionDivider || 'dashes'}
                      onChange={(e) => updateSettings('sections', { sectionDivider: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="dashes">--- Dashes ---</option>
                      <option value="equals">=== Equals ===</option>
                      <option value="stars">*** Stars ***</option>
                      <option value="double-line">═══ Double ═══</option>
                      <option value="blank">Blank</option>
                    </select>
                  </div>
                </div>
              )}

              {/* MODIFICATIONS TAB */}
              {activeTab === 'modifications' && (
                <div className="space-y-2">
                  {/* NO Items */}
                  <div className="bg-red-50 p-2 rounded border border-red-200">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={localSettings.modifications?.highlightNo ?? true}
                        onChange={(e) => updateSettings('modifications', { highlightNo: e.target.checked })} className="w-4 h-4" />
                      <span className="font-bold text-red-700 text-sm w-24">NO Items</span>
                      <select value={localSettings.modifications?.noStyle || 'all'}
                        onChange={(e) => updateSettings('modifications', { noStyle: e.target.value as any })}
                        className="flex-1 p-1 border rounded text-sm">
                        <option value="bold">Bold</option>
                        <option value="caps">ALL CAPS</option>
                        <option value="boxed">[Boxed]</option>
                        <option value="inverted">Inverted</option>
                        <option value="red">🔴 RED</option>
                        <option value="red-bold">🔴 RED Bold</option>
                        <option value="red-inverted">🔴 RED Inverted</option>
                        <option value="all">All Effects</option>
                      </select>
                      <input type="text" value={localSettings.modifications?.noPrefix || 'NO'}
                        onChange={(e) => updateSettings('modifications', { noPrefix: e.target.value })}
                        className="w-16 p-1 border rounded text-sm" placeholder="NO" />
                    </div>
                  </div>

                  {/* EXTRA Items */}
                  <div className="bg-orange-50 p-2 rounded border border-orange-200">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={localSettings.modifications?.highlightExtra ?? true}
                        onChange={(e) => updateSettings('modifications', { highlightExtra: e.target.checked })} className="w-4 h-4" />
                      <span className="font-bold text-orange-700 text-sm w-24">EXTRA</span>
                      <select value={localSettings.modifications?.extraStyle || 'bold'}
                        onChange={(e) => updateSettings('modifications', { extraStyle: e.target.value as any })}
                        className="flex-1 p-1 border rounded text-sm">
                        <option value="bold">Bold</option>
                        <option value="caps">ALL CAPS</option>
                        <option value="boxed">[Boxed]</option>
                        <option value="red">🔴 RED</option>
                        <option value="red-bold">🔴 RED Bold</option>
                        <option value="all">All Effects</option>
                      </select>
                      <input type="text" value={localSettings.modifications?.extraPrefix || 'EXTRA'}
                        onChange={(e) => updateSettings('modifications', { extraPrefix: e.target.value })}
                        className="w-16 p-1 border rounded text-sm" placeholder="EXTRA" />
                    </div>
                  </div>

                  {/* LIGHT Items */}
                  <div className="bg-blue-50 p-2 rounded border border-blue-200">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={localSettings.modifications?.highlightLight ?? true}
                        onChange={(e) => updateSettings('modifications', { highlightLight: e.target.checked })} className="w-4 h-4" />
                      <span className="font-bold text-blue-700 text-sm w-24">LIGHT</span>
                      <select value={localSettings.modifications?.lightStyle || 'caps'}
                        onChange={(e) => updateSettings('modifications', { lightStyle: e.target.value as any })}
                        className="flex-1 p-1 border rounded text-sm">
                        <option value="bold">Bold</option>
                        <option value="caps">ALL CAPS</option>
                        <option value="red">🔴 RED</option>
                        <option value="red-bold">🔴 RED Bold</option>
                      </select>
                      <input type="text" value={localSettings.modifications?.lightPrefix || 'LIGHT'}
                        onChange={(e) => updateSettings('modifications', { lightPrefix: e.target.value })}
                        className="w-16 p-1 border rounded text-sm" placeholder="LIGHT" />
                    </div>
                  </div>

                  {/* Allergy Alerts */}
                  <div className="bg-yellow-50 p-2 rounded border border-yellow-300">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={localSettings.allergyAlerts?.highlightAllergies ?? true}
                        onChange={(e) => updateSettings('allergyAlerts', { highlightAllergies: e.target.checked })} className="w-4 h-4" />
                      <span className="font-bold text-yellow-700 text-sm w-24">Allergies</span>
                      <select value={localSettings.allergyAlerts?.allergyStyle || 'inverted'}
                        onChange={(e) => updateSettings('allergyAlerts', { allergyStyle: e.target.value as any })}
                        className="flex-1 p-1 border rounded text-sm">
                        <option value="bold">Bold</option>
                        <option value="boxed">[Boxed]</option>
                        <option value="inverted">Inverted</option>
                        <option value="starred">*** Starred ***</option>
                        <option value="red">🔴 RED</option>
                        <option value="red-bold">🔴 RED Bold</option>
                        <option value="red-inverted">🔴 RED Inverted</option>
                      </select>
                      <input type="text" value={localSettings.allergyAlerts?.allergyLabel || '*** ALLERGY ***'}
                        onChange={(e) => updateSettings('allergyAlerts', { allergyLabel: e.target.value })}
                        className="w-28 p-1 border rounded text-sm" />
                    </div>
                  </div>
                </div>
              )}

              {/* INSTRUCTIONS TAB */}
              {activeTab === 'instructions' && (
                <div className="space-y-2">
                  <div className="bg-gray-50 p-2 rounded border">
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" checked={localSettings.specialInstructions?.show ?? true}
                        onChange={(e) => updateSettings('specialInstructions', { show: e.target.checked })} className="w-4 h-4" />
                      <span className="font-bold text-sm">Special Instructions</span>
                      <select value={localSettings.specialInstructions?.style || 'boxed'}
                        onChange={(e) => updateSettings('specialInstructions', { style: e.target.value as any })}
                        className="flex-1 p-1 border rounded text-sm">
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="boxed">[Boxed]</option>
                        <option value="inverted">Inverted</option>
                        <option value="red">🔴 RED</option>
                        <option value="red-bold">🔴 RED Bold</option>
                        <option value="red-inverted">🔴 RED Inverted</option>
                      </select>
                      <input type="text" value={localSettings.specialInstructions?.label || 'SPECIAL:'}
                        onChange={(e) => updateSettings('specialInstructions', { label: e.target.value })}
                        className="w-24 p-1 border rounded text-sm" />
                    </div>
                    <div className="flex gap-4 ml-6">
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" checked={localSettings.specialInstructions?.allCaps ?? true}
                          onChange={(e) => updateSettings('specialInstructions', { allCaps: e.target.checked })} className="w-3 h-3" />
                        ALL CAPS
                      </label>
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" checked={localSettings.specialInstructions?.separateLine ?? true}
                          onChange={(e) => updateSettings('specialInstructions', { separateLine: e.target.checked })} className="w-3 h-3" />
                        Separate Line
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <input type="checkbox" checked={localSettings.header?.showOrderNumber ?? true}
                        onChange={(e) => updateSettings('header', { showOrderNumber: e.target.checked })} className="w-4 h-4" />
                      Show Order Number
                    </label>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <input type="checkbox" checked={localSettings.header?.showSizeLarge ?? true}
                        onChange={(e) => updateSettings('header', { showSizeLarge: e.target.checked })} className="w-4 h-4" />
                      Size in Large Text
                    </label>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <input type="checkbox" checked={localSettings.header?.showSizeInches ?? true}
                        onChange={(e) => updateSettings('header', { showSizeInches: e.target.checked })} className="w-4 h-4" />
                      Show Inches (14")
                    </label>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <input type="checkbox" checked={localSettings.header?.showCrustProminent ?? true}
                        onChange={(e) => updateSettings('header', { showCrustProminent: e.target.checked })} className="w-4 h-4" />
                      Highlight Crust
                    </label>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <input type="checkbox" checked={localSettings.footer?.showToppingCount ?? true}
                        onChange={(e) => updateSettings('footer', { showToppingCount: e.target.checked })} className="w-4 h-4" />
                      Show Topping Count
                    </label>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <input type="checkbox" checked={localSettings.footer?.repeatSizeAtBottom ?? true}
                        onChange={(e) => updateSettings('footer', { repeatSizeAtBottom: e.target.checked })} className="w-4 h-4" />
                      Repeat Size at Bottom
                    </label>
                  </div>
                </div>
              )}

              {/* LAYOUT TAB */}
              {activeTab === 'layout' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Paper Width</label>
                    <select value={localSettings.layout?.paperWidth || 80}
                      onChange={(e) => updateSettings('layout', { paperWidth: parseInt(e.target.value) as 80 | 40 })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value={80}>80mm (Standard)</option>
                      <option value={40}>40mm (Narrow)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Section Labels</label>
                    <select value={localSettings.sections?.showSectionLabels || 'full'}
                      onChange={(e) => updateSettings('sections', { showSectionLabels: e.target.value as any })}
                      className="w-full p-1.5 border rounded text-sm">
                      <option value="full">[LEFT HALF]</option>
                      <option value="abbreviated">[L] [R]</option>
                      <option value="numbered">[1/2] [2/2]</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.layout?.useFullWidth ?? true}
                      onChange={(e) => updateSettings('layout', { useFullWidth: e.target.checked })} className="w-4 h-4" />
                    Use Full Width
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.layout?.compactMode ?? false}
                      onChange={(e) => updateSettings('layout', { compactMode: e.target.checked })} className="w-4 h-4" />
                    Compact Mode
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.layout?.cutAfterEach ?? true}
                      onChange={(e) => updateSettings('layout', { cutAfterEach: e.target.checked })} className="w-4 h-4" />
                    Cut After Each
                  </label>
                  <label className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                    <input type="checkbox" checked={localSettings.sections?.groupToppingsBySection ?? true}
                      onChange={(e) => updateSettings('sections', { groupToppingsBySection: e.target.checked })} className="w-4 h-4" />
                    Group by Section
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div className="p-4 bg-gray-100 flex flex-col items-center">
            <div className="text-sm font-bold text-gray-700 mb-2">LIVE PREVIEW</div>
            <ReceiptPreview settings={localSettings} />
            <p className="text-xs text-gray-500 mt-2 text-center max-w-[200px]">
              Changes update instantly. Red text shows what will print in red on TM-U220.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-gray-50 flex justify-between">
          <Button variant="outline" size="sm"
            onClick={() => setLocalSettings(DEFAULT_PIZZA_PRINT_SETTINGS)}>
            Reset Defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => onSave(localSettings)}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

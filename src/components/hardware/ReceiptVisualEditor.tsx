'use client'

import { useState, useMemo, useCallback } from 'react'

/**
 * ReceiptVisualEditor - Station-Based Template Engine
 *
 * Every metadata field (Station, Tab, Order Type) has its own:
 * - Alignment, Size, Weight, Color property
 * - Reverse Print mode for thermal paper highlighting
 * - Impact Red support for high-priority items (Allergies, Rush)
 * - Configurable ASCII dividers for visual hierarchy
 */

import type { TemplateType } from '@/types/routing'
import {
  type PrintTemplateSettings,
  type ElementConfig,
  type DividerConfig,
  type AlertRule,
  type GlobalReceiptSettings,
  DEFAULT_GLOBAL_RECEIPT_SETTINGS,
} from '@/types/print'

import { usePrintTemplateEditor } from './usePrintTemplateEditor'
import { ElementEditor } from './ElementEditor'
import { TicketPreview } from './TicketPreview'
import type { PreviewMode } from './TicketPreview'
import { Section, DividerSelector, OptionButtons, Toggle } from './printEditorHelpers'

// Re-export types for consumers
export type { PrintTemplateSettings, ElementConfig, DividerConfig, AlertRule }

interface ReceiptVisualEditorProps {
  initialSettings?: Partial<PrintTemplateSettings>
  templateType: TemplateType
  printerType?: 'thermal' | 'impact'
  /** Printer role determines which view to show - receipt, kitchen, bar, or entertainment */
  printerRole?: 'receipt' | 'kitchen' | 'bar' | 'entertainment'
  /** Global receipt settings from location - controls what features are available */
  globalSettings?: Partial<GlobalReceiptSettings>
  onSave?: (settings: PrintTemplateSettings) => void
  onCancel?: () => void
  onTestPrint?: (settings: PrintTemplateSettings) => Promise<void>
}

export function ReceiptVisualEditor({
  initialSettings,
  templateType,
  printerType = 'impact',
  printerRole = 'kitchen',
  globalSettings,
  onSave,
  onCancel,
  onTestPrint,
}: ReceiptVisualEditorProps) {
  const {
    settings,
    history,
    historyIndex,
    undo,
    redo,
    updateElement,
    moveElement,
    update,
    updateNested,
    isDirty,
    resetSettings,
  } = usePrintTemplateEditor(initialSettings)

  // Merge global settings with defaults
  const global = { ...DEFAULT_GLOBAL_RECEIPT_SETTINGS, ...globalSettings }

  const [paperWidth, setPaperWidth] = useState<80 | 58>(80)
  // Printer type is fixed from prop - no toggle, prevents misconfiguration
  const showImpactMode = printerType === 'impact'
  // Preview mode is determined by printer role - no manual toggle
  const previewMode: PreviewMode = printerRole === 'receipt' ? 'receipt' : printerRole === 'entertainment' ? 'entertainment' : 'kitchen'
  // Show appropriate tabs based on printer role
  const [activeTab, setActiveTab] = useState<'header' | 'items' | 'alerts' | 'receipt' | 'entertainment'>(
    printerRole === 'receipt' ? 'receipt' : printerRole === 'entertainment' ? 'entertainment' : 'header'
  )
  const [editingElement, setEditingElement] = useState<string | null>(null)
  const [draggedElement, setDraggedElement] = useState<string | null>(null)

  const [isTestPrinting, setIsTestPrinting] = useState(false)
  const handleTestPrint = useCallback(async () => {
    if (!onTestPrint) return
    setIsTestPrinting(true)
    try {
      await onTestPrint(settings)
    } finally {
      setIsTestPrinting(false)
    }
  }, [onTestPrint, settings])

  const templateName = useMemo(() => {
    // Use printer role to determine primary label, template type for specifics
    if (printerRole === 'receipt') return 'Customer Receipt'
    if (printerRole === 'bar') return 'Bar Ticket'
    if (printerRole === 'entertainment') return 'Entertainment Ticket'

    // Kitchen printers - check template type for specifics
    switch (templateType) {
      case 'PIZZA_STATION': return 'Pizza Station'
      case 'EXPO_SUMMARY': return 'Expo'
      case 'ENTERTAINMENT_TICKET': return 'Entertainment'
      case 'BAR_TICKET': return 'Bar'
      default: return 'Kitchen Ticket'
    }
  }, [printerRole, templateType])

  // Handle drag and drop for element reordering
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedElement(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedElement || draggedElement === targetId) return

    const fromIndex = settings.headerElements.findIndex((el) => el.id === draggedElement)
    const toIndex = settings.headerElements.findIndex((el) => el.id === targetId)

    if (fromIndex !== -1 && toIndex !== -1) {
      moveElement(fromIndex, toIndex)
    }
  }

  const handleDragEnd = () => {
    setDraggedElement(null)
  }

  return (
    <div className="flex h-[900px] bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* CONFIGURATION PANEL */}
      <div className="w-[55%] border-r border-slate-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {templateName} Template Designer
            </h2>
            {isDirty && (
              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded-full">Unsaved</span>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={undo} disabled={historyIndex <= 0} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded disabled:opacity-30" title="Undo">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </button>
            <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded disabled:opacity-30" title="Redo">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
              </svg>
            </button>
            <div className="h-4 w-px bg-slate-700 mx-1" />
            {/* Printer type is fixed when creating the printer - shown here for reference */}
            <span className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-300 border border-slate-600">
              {showImpactMode ? 'TM-U220 (Impact)' : 'TM-T88 (Thermal)'}
            </span>
            <div className="h-4 w-px bg-slate-700 mx-1" />
            <button
              onClick={() => setPaperWidth(80)}
              className={`px-2 py-1 text-xs rounded ${paperWidth === 80 ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            >
              80mm
            </button>
            <button
              onClick={() => setPaperWidth(58)}
              className={`px-2 py-1 text-xs rounded ${paperWidth === 58 ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            >
              58mm
            </button>
            <div className="h-4 w-px bg-slate-700 mx-1" />
            {/* Printer Role Badge - determined by Add Printer selection */}
            <span className={`px-3 py-1 text-xs rounded font-medium ${
              printerRole === 'receipt'
                ? 'bg-purple-600 text-white'
                : printerRole === 'bar'
                  ? 'bg-blue-600 text-white'
                  : printerRole === 'entertainment'
                    ? 'bg-green-600 text-white'
                    : 'bg-orange-600 text-white'
            }`}>
              {printerRole === 'receipt' ? 'Receipt Printer' : printerRole === 'bar' ? 'Bar Printer' : printerRole === 'entertainment' ? 'Entertainment Printer' : 'Kitchen Printer'}
            </span>
            <div className="flex-1" />
            <button
              onClick={resetSettings}
              className="px-2 py-1 text-xs bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-400 rounded"
            >
              Reset
            </button>
          </div>

          {/* Tabs - filtered by printer role */}
          <div className="flex gap-1 mt-3">
            {printerRole === 'receipt' ? (
              // Receipt printer tabs - focus on receipt formatting
              <>
                {(['header', 'receipt'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                      activeTab === tab
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'header' ? 'Header & Business Info' : 'Totals, Tips & Signature'}
                  </button>
                ))}
              </>
            ) : printerRole === 'entertainment' ? (
              // Entertainment printer tabs - waitlist, sessions, warnings
              <>
                {(['header', 'entertainment'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                      activeTab === tab
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'header' ? 'Header & Name' : 'Session & Ticket Options'}
                  </button>
                ))}
              </>
            ) : (
              // Kitchen/Bar printer tabs - focus on ticket formatting
              <>
                {(['header', 'items', 'alerts'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                      activeTab === tab
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'header' ? 'Header Stack' : tab === 'items' ? 'Items & Mods' : 'Alerts & Colors'}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'header' && (
            <>
              {/* Header Elements - Draggable List */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 overflow-hidden">
                <div className="p-3 border-b border-slate-700 flex items-center justify-between">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Header Elements</span>
                  <span className="text-xs text-slate-500">Drag to reorder</span>
                </div>
                <div className="divide-y divide-slate-700/50">
                  {settings.headerElements.map((element, index) => (
                    <div
                      key={element.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, element.id)}
                      onDragOver={(e) => handleDragOver(e, element.id)}
                      onDragEnd={handleDragEnd}
                      className={`p-3 flex items-center gap-3 cursor-move hover:bg-slate-700/30 transition-colors ${
                        draggedElement === element.id ? 'opacity-50 bg-slate-700/50' : ''
                      } ${editingElement === element.id ? 'bg-cyan-900/20' : ''}`}
                    >
                      {/* Drag Handle */}
                      <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                      </svg>

                      {/* Toggle */}
                      <button
                        onClick={() => updateElement(element.id, { enabled: !element.enabled })}
                        className={`w-8 h-5 rounded-full transition-colors flex-shrink-0 ${element.enabled ? 'bg-cyan-600' : 'bg-slate-700'}`}
                      >
                        <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${element.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>

                      {/* Label */}
                      <span className={`flex-1 text-sm ${element.enabled ? 'text-white' : 'text-slate-500'}`}>
                        {element.label}
                      </span>

                      {/* Quick indicators */}
                      <div className="flex items-center gap-1">
                        {element.reversePrint && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-slate-600 text-white rounded">REV</span>
                        )}
                        {element.redPrint && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-red-600 text-white rounded">RED</span>
                        )}
                        {element.size !== 'normal' && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-slate-700 text-slate-300 rounded">{element.size.toUpperCase()}</span>
                        )}
                      </div>

                      {/* Edit Button */}
                      <button
                        onClick={() => setEditingElement(editingElement === element.id ? null : element.id)}
                        className="p-1 hover:bg-slate-600 rounded"
                      >
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Element Editor (when selected) */}
              {editingElement && (
                <ElementEditor
                  element={settings.headerElements.find((el) => el.id === editingElement)!}
                  showImpactMode={showImpactMode}
                  onUpdate={(updates) => updateElement(editingElement, updates)}
                  onClose={() => setEditingElement(null)}
                />
              )}

              {/* Dividers */}
              <Section title="Dividers" defaultOpen={false}>
                <div className="space-y-4">
                  <DividerSelector
                    label="After Header"
                    value={settings.dividers.afterHeader}
                    onChange={(v) => update('dividers', 'afterHeader', v)}
                  />
                  <DividerSelector
                    label="Between Categories"
                    value={settings.dividers.betweenCategories}
                    onChange={(v) => update('dividers', 'betweenCategories', v)}
                  />
                  <DividerSelector
                    label="Before Footer"
                    value={settings.dividers.beforeFooter}
                    onChange={(v) => update('dividers', 'beforeFooter', v)}
                  />
                </div>
              </Section>

              {/* Spacing */}
              <Section title="Spacing" defaultOpen={false}>
                <Toggle label="Compact Mode" checked={settings.spacing.compact} onChange={(v) => update('spacing', 'compact', v)} />
              </Section>
            </>
          )}

          {activeTab === 'items' && (
            <>
              {/* Item Display */}
              <Section title="Item Display" defaultOpen={true}>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-2">Quantity Position</label>
                    <OptionButtons
                      options={[
                        { value: 'before', label: '1x Item' },
                        { value: 'after', label: 'Item x1' },
                        { value: 'none', label: 'No Qty' },
                      ]}
                      value={settings.items.quantityPosition}
                      onChange={(v) => update('items', 'quantityPosition', v)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-2">Item Size</label>
                    <OptionButtons
                      options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'xlarge', label: 'XL' }]}
                      value={settings.items.size}
                      onChange={(v) => update('items', 'size', v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Toggle label="Bold Items" checked={settings.items.bold} onChange={(v) => update('items', 'bold', v)} />
                    <Toggle label="ALL CAPS" checked={settings.items.caps} onChange={(v) => update('items', 'caps', v)} />
                  </div>
                </div>
              </Section>

              {/* Seat Numbers */}
              <Section title="Seat Numbers" defaultOpen={false}>
                <div>
                  <label className="text-xs text-slate-400 block mb-2">Display Mode</label>
                  <OptionButtons
                    options={[
                      { value: 'none', label: 'Off' },
                      { value: 'prefix', label: 'S1: Item' },
                      { value: 'inline', label: 'Item (S1)' },
                      { value: 'header', label: 'Group' },
                    ]}
                    value={settings.seats.display}
                    onChange={(v) => update('seats', 'display', v)}
                  />
                </div>
                {settings.seats.display !== 'none' && (
                  <>
                    <div className="mt-3">
                      <label className="text-xs text-slate-400 block mb-2">Format</label>
                      <OptionButtons
                        options={[
                          { value: 'S1', label: 'S1' },
                          { value: 'Seat 1', label: 'Seat 1' },
                          { value: '#1', label: '#1' },
                          { value: '(1)', label: '(1)' },
                        ]}
                        value={settings.seats.format}
                        onChange={(v) => update('seats', 'format', v)}
                      />
                    </div>
                    <Toggle
                      label="Group Items by Seat"
                      checked={settings.seats.groupBySeat}
                      onChange={(v) => update('seats', 'groupBySeat', v)}
                    />
                    {settings.seats.groupBySeat && (
                      <>
                        <div className="mt-3">
                          <label className="text-xs text-slate-400 block mb-2">Seat Separator</label>
                          <OptionButtons
                            options={[
                              { value: 'none', label: 'None' },
                              { value: 'blank', label: 'Blank Line' },
                              { value: 'dash', label: '------' },
                              { value: 'double', label: '======' },
                              { value: 'newSeat', label: 'NEW SEAT' },
                            ]}
                            value={settings.seats.seatSeparator}
                            onChange={(v) => update('seats', 'seatSeparator', v)}
                          />
                        </div>
                        {settings.seats.seatSeparator === 'newSeat' && (
                          <div className="mt-3">
                            <label className="text-xs text-slate-400 block mb-1">New Seat Text</label>
                            <input
                              type="text"
                              value={settings.seats.newSeatText}
                              onChange={(e) => update('seats', 'newSeatText', e.target.value)}
                              placeholder="--- SEAT {n} ---"
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                            />
                            <p className="text-[10px] text-slate-500 mt-1">Use {'{n}'} for seat number</p>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </Section>

              {/* Modifiers */}
              <Section title="Modifiers" defaultOpen={true}>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-2">Indent</label>
                    <OptionButtons
                      options={[
                        { value: 0, label: 'None' },
                        { value: 2, label: '2 sp' },
                        { value: 4, label: '4 sp' },
                        { value: 6, label: '6 sp' },
                      ]}
                      value={settings.modifiers.indent}
                      onChange={(v) => update('modifiers', 'indent', v)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-2">Prefix</label>
                    <OptionButtons
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'dash', label: '- Mod' },
                        { value: 'bullet', label: '• Mod' },
                        { value: 'arrow', label: '> Mod' },
                        { value: 'asterisk', label: '* Mod' },
                      ]}
                      value={settings.modifiers.prefix}
                      onChange={(v) => update('modifiers', 'prefix', v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Toggle label="Bold" checked={settings.modifiers.bold} onChange={(v) => update('modifiers', 'bold', v)} />
                    <Toggle label="ALL CAPS" checked={settings.modifiers.caps} onChange={(v) => update('modifiers', 'caps', v)} />
                  </div>
                </div>
              </Section>

              {/* Pre-Modifiers */}
              <Section title="Pre-Modifiers (NO, EXTRA, LITE)" color="orange" defaultOpen={true}>
                <div>
                  <label className="text-xs text-slate-400 block mb-2">Style</label>
                  <OptionButtons
                    options={[
                      { value: 'plain', label: 'NO Onion' },
                      { value: 'stars', label: '*NO* Onion' },
                      { value: 'brackets', label: '[NO] Onion' },
                      { value: 'parens', label: '(NO) Onion' },
                      { value: 'caps', label: 'NO ONION' },
                    ]}
                    value={settings.preModifiers.style}
                    onChange={(v) => update('preModifiers', 'style', v)}
                  />
                </div>
                <div className="mt-3">
                  <Toggle
                    label="Highlight (Reverse/Red)"
                    checked={settings.preModifiers.highlight}
                    onChange={(v) => update('preModifiers', 'highlight', v)}
                    important
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {showImpactMode ? 'Uses red ink for NO/EXTRA' : 'Uses reverse (white on black) printing'}
                  </p>
                </div>
              </Section>

              {/* Category Headers */}
              <Section title="Category Headers" defaultOpen={false}>
                <Toggle label="Show Categories" checked={settings.categories.enabled} onChange={(v) => update('categories', 'enabled', v)} />
                {settings.categories.enabled && (
                  <div className="space-y-3 mt-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-2">Style</label>
                      <OptionButtons
                        options={[
                          { value: 'plain', label: 'Plain' },
                          { value: 'bold', label: 'Bold' },
                          { value: 'boxed', label: '[Boxed]' },
                          { value: 'banner', label: '=Banner=' },
                          { value: 'reverse', label: 'Reverse' },
                        ]}
                        value={settings.categories.style}
                        onChange={(v) => update('categories', 'style', v)}
                      />
                    </div>
                    <Toggle label="ALL CAPS" checked={settings.categories.caps} onChange={(v) => update('categories', 'caps', v)} />
                  </div>
                )}
              </Section>

              {/* Collapsing */}
              <Section title="Item Collapsing" defaultOpen={false}>
                <p className="text-xs text-slate-400 mb-3">
                  Collapse: "2x Burger" vs print each item separately for seat modifications
                </p>
                <div className="space-y-3">
                  <Toggle label="Collapse identical items" checked={settings.collapsing.enabled} onChange={(v) => update('collapsing', 'enabled', v)} />
                  <Toggle label="Collapse on kitchen" checked={settings.collapsing.onKitchen} onChange={(v) => update('collapsing', 'onKitchen', v)} />
                  <Toggle label="Collapse on expo" checked={settings.collapsing.onExpo} onChange={(v) => update('collapsing', 'onExpo', v)} />
                </div>
              </Section>
            </>
          )}

          {activeTab === 'alerts' && (
            <>
              {/* Alert Rules */}
              <Section title="High-Alert Printing" color="red" defaultOpen={true}>
                <p className="text-xs text-slate-400 mb-3">
                  Special formatting for allergies, rush orders, and alerts.
                  {showImpactMode ? ' Uses RED ink on impact printers.' : ' Uses REVERSE (white on black) on thermal.'}
                </p>
                {settings.alerts.map((alert) => (
                  <div key={alert.id} className="p-3 bg-slate-800/50 rounded-lg mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">{alert.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] rounded ${showImpactMode ? 'bg-red-600 text-white' : 'bg-slate-600 text-white'}`}>
                          {showImpactMode ? alert.impactStyle.toUpperCase() : alert.thermalStyle.toUpperCase()}
                        </span>
                        {alert.forceSize !== 'inherit' && (
                          <span className="px-2 py-0.5 text-[10px] bg-slate-700 text-slate-300 rounded">
                            {alert.forceSize.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </Section>

              {/* Indicators */}
              <Section title="Special Indicators" defaultOpen={true}>
                {(['resend', 'rush', 'fire', 'void'] as const).map((key) => (
                  <div key={key} className="p-3 bg-slate-800/50 rounded-lg mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <Toggle
                        label={key.toUpperCase()}
                        checked={settings.indicators[key].enabled}
                        onChange={(v) => updateNested('indicators', key, 'enabled', v)}
                      />
                    </div>
                    {settings.indicators[key].enabled && (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={settings.indicators[key].format}
                          onChange={(e) => updateNested('indicators', key, 'format', e.target.value)}
                          className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white"
                        />
                        <Toggle
                          label="Rev"
                          checked={settings.indicators[key].reverse}
                          onChange={(v) => updateNested('indicators', key, 'reverse', v)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </Section>

              {/* Notes */}
              <Section title="Special Notes" defaultOpen={false}>
                <Toggle label="Show Notes" checked={settings.notes.enabled} onChange={(v) => update('notes', 'enabled', v)} />
                {settings.notes.enabled && (
                  <div className="space-y-3 mt-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-2">Style</label>
                      <OptionButtons
                        options={[
                          { value: 'plain', label: 'Plain' },
                          { value: 'italic', label: 'Italic' },
                          { value: 'boxed', label: '[Boxed]' },
                          { value: 'reverse', label: 'Reverse' },
                        ]}
                        value={settings.notes.style}
                        onChange={(v) => update('notes', 'style', v)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Prefix</label>
                      <input
                        type="text"
                        value={settings.notes.prefix}
                        onChange={(e) => update('notes', 'prefix', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                        placeholder="NOTE:"
                      />
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}

          {activeTab === 'entertainment' && (
            <>
              {/* Print Triggers */}
              <Section title="When to Print Tickets" color="cyan" defaultOpen={true}>
                <div className="space-y-3">
                  <Toggle
                    label="Print when added to Waitlist"
                    checked={settings.entertainment?.printOnWaitlist ?? true}
                    onChange={(v) => update('entertainment', 'printOnWaitlist', v)}
                  />
                  <Toggle
                    label="Print when Session Starts"
                    checked={settings.entertainment?.printOnSessionStart ?? true}
                    onChange={(v) => update('entertainment', 'printOnSessionStart', v)}
                  />
                  <Toggle
                    label="Print when Session Ends"
                    checked={settings.entertainment?.printOnSessionEnd ?? true}
                    onChange={(v) => update('entertainment', 'printOnSessionEnd', v)}
                  />
                  <Toggle
                    label="Print Time Warning Ticket"
                    checked={settings.entertainment?.printOnTimeWarning ?? true}
                    onChange={(v) => update('entertainment', 'printOnTimeWarning', v)}
                  />
                </div>
              </Section>

              {/* Content Options */}
              <Section title="Ticket Content" color="cyan" defaultOpen={true}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Toggle
                      label="Show Guest Name"
                      checked={settings.entertainment?.showGuestName ?? true}
                      onChange={(v) => update('entertainment', 'showGuestName', v)}
                    />
                    <Toggle
                      label="Show Party Size"
                      checked={settings.entertainment?.showPartySize ?? true}
                      onChange={(v) => update('entertainment', 'showPartySize', v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Toggle
                      label="Show Table/Lane Assignment"
                      checked={settings.entertainment?.showTableAssignment ?? true}
                      onChange={(v) => update('entertainment', 'showTableAssignment', v)}
                    />
                    <Toggle
                      label="Show Price"
                      checked={settings.entertainment?.showPrice ?? true}
                      onChange={(v) => update('entertainment', 'showPrice', v)}
                    />
                  </div>
                  <div className="border-t border-slate-700 pt-3 mt-3">
                    <label className="text-xs text-slate-400 block mb-2">Time Display</label>
                    <div className="grid grid-cols-2 gap-3">
                      <Toggle
                        label="Show Start Time"
                        checked={settings.entertainment?.showStartTime ?? true}
                        onChange={(v) => update('entertainment', 'showStartTime', v)}
                      />
                      <Toggle
                        label="Show End Time"
                        checked={settings.entertainment?.showEndTime ?? true}
                        onChange={(v) => update('entertainment', 'showEndTime', v)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <Toggle
                        label="Show Duration"
                        checked={settings.entertainment?.showDuration ?? true}
                        onChange={(v) => update('entertainment', 'showDuration', v)}
                      />
                      <Toggle
                        label="Show Time Remaining"
                        checked={settings.entertainment?.showTimeRemaining ?? true}
                        onChange={(v) => update('entertainment', 'showTimeRemaining', v)}
                      />
                    </div>
                  </div>
                  <Toggle
                    label="Show Instructions Field"
                    checked={settings.entertainment?.showInstructions ?? true}
                    onChange={(v) => update('entertainment', 'showInstructions', v)}
                  />
                </div>
              </Section>

              {/* Guest Name Styling */}
              <Section title="Guest Name Styling" color="purple" defaultOpen={true}>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-2">Name Size</label>
                    <OptionButtons
                      options={[
                        { value: 'normal', label: 'Normal' },
                        { value: 'large', label: 'Large' },
                        { value: 'xlarge', label: 'XL' },
                      ]}
                      value={settings.entertainment?.nameSize || 'large'}
                      onChange={(v) => update('entertainment', 'nameSize', v)}
                    />
                  </div>
                  <Toggle
                    label="Bold Name"
                    checked={settings.entertainment?.nameBold ?? true}
                    onChange={(v) => update('entertainment', 'nameBold', v)}
                  />
                  <Toggle
                    label="Highlight Time Warnings"
                    checked={settings.entertainment?.highlightWarnings ?? true}
                    onChange={(v) => update('entertainment', 'highlightWarnings', v)}
                    important
                  />
                  <p className="text-xs text-slate-500">
                    {showImpactMode ? 'Uses red ink for time warnings' : 'Uses reverse (white on black) for time warnings'}
                  </p>
                </div>
              </Section>

              {/* Custom Header Text */}
              <Section title="Custom Header Text" defaultOpen={false}>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Waitlist Header</label>
                    <input
                      type="text"
                      value={settings.entertainment?.waitlistHeader || 'WAITLIST'}
                      onChange={(e) => update('entertainment', 'waitlistHeader', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      placeholder="WAITLIST"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Session Start Header</label>
                    <input
                      type="text"
                      value={settings.entertainment?.sessionStartHeader || 'SESSION STARTED'}
                      onChange={(e) => update('entertainment', 'sessionStartHeader', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      placeholder="SESSION STARTED"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Session End Header</label>
                    <input
                      type="text"
                      value={settings.entertainment?.sessionEndHeader || "TIME'S UP!"}
                      onChange={(e) => update('entertainment', 'sessionEndHeader', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      placeholder="TIME'S UP!"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Warning Header</label>
                    <input
                      type="text"
                      value={settings.entertainment?.warningHeader || '5 MIN WARNING'}
                      onChange={(e) => update('entertainment', 'warningHeader', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      placeholder="5 MIN WARNING"
                    />
                  </div>
                </div>
              </Section>

              {/* Labels */}
              <Section title="Field Labels" defaultOpen={false}>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Instructions Label</label>
                    <input
                      type="text"
                      value={settings.entertainment?.instructionsLabel || 'Instructions:'}
                      onChange={(e) => update('entertainment', 'instructionsLabel', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      placeholder="Instructions:"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Return By Label</label>
                    <input
                      type="text"
                      value={settings.entertainment?.returnByLabel || 'Return By:'}
                      onChange={(e) => update('entertainment', 'returnByLabel', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      placeholder="Return By:"
                    />
                  </div>
                </div>
              </Section>
            </>
          )}

          {activeTab === 'receipt' && (
            <>
              {/* Receipt Type Selection */}
              <Section title="Receipt Type" color="cyan" defaultOpen={true}>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-2">Choose Receipt Format</label>
                    <OptionButtons
                      options={[
                        { value: 'simple', label: 'Simple (Totals Only)' },
                        { value: 'itemized', label: 'Itemized (Full Breakdown)' },
                      ]}
                      value={settings.receipt.receiptType || 'itemized'}
                      onChange={(v) => update('receipt', 'receiptType', v)}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    {settings.receipt.receiptType === 'simple'
                      ? 'Simple receipt shows only totals - no individual items listed'
                      : 'Itemized receipt shows each item with optional modifiers and prices'}
                  </p>
                </div>
              </Section>

              {/* Itemized Receipt Options - Only show when itemized is selected */}
              {settings.receipt.receiptType === 'itemized' && (
                <Section title="Itemized Receipt Options" color="purple" defaultOpen={true}>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Toggle
                        label="Show Item Prices"
                        checked={settings.receipt.itemized?.showItemPrices ?? true}
                        onChange={(v) => updateNested('receipt', 'itemized', 'showItemPrices', v)}
                      />
                      <Toggle
                        label="Show Quantity (1x, 2x)"
                        checked={settings.receipt.itemized?.showQuantity ?? true}
                        onChange={(v) => updateNested('receipt', 'itemized', 'showQuantity', v)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Toggle
                        label="Show Modifiers"
                        checked={settings.receipt.itemized?.showModifiers ?? true}
                        onChange={(v) => updateNested('receipt', 'itemized', 'showModifiers', v)}
                      />
                      {settings.receipt.itemized?.showModifiers && (
                        <Toggle
                          label="Show Modifier Prices"
                          checked={settings.receipt.itemized?.showModifierPrices ?? true}
                          onChange={(v) => updateNested('receipt', 'itemized', 'showModifierPrices', v)}
                        />
                      )}
                    </div>
                    {settings.receipt.itemized?.showModifiers && (
                      <Toggle
                        label="Indent Modifiers"
                        checked={settings.receipt.itemized?.indentModifiers ?? true}
                        onChange={(v) => updateNested('receipt', 'itemized', 'indentModifiers', v)}
                      />
                    )}
                    <div className="border-t border-slate-700 pt-3 mt-3">
                      <label className="text-xs text-slate-400 block mb-2">Grouping Options</label>
                      <div className="space-y-2">
                        <Toggle
                          label='Collapse Duplicates ("2x Burger" vs listing twice)'
                          checked={settings.receipt.itemized?.collapseDuplicates ?? false}
                          onChange={(v) => updateNested('receipt', 'itemized', 'collapseDuplicates', v)}
                        />
                        <Toggle
                          label="Group by Category"
                          checked={settings.receipt.itemized?.groupByCategory ?? false}
                          onChange={(v) => updateNested('receipt', 'itemized', 'groupByCategory', v)}
                        />
                        <Toggle
                          label="Group by Seat"
                          checked={settings.receipt.itemized?.groupBySeat ?? false}
                          onChange={(v) => updateNested('receipt', 'itemized', 'groupBySeat', v)}
                        />
                      </div>
                    </div>
                  </div>
                </Section>
              )}

              {/* Totals Section */}
              <Section title="Totals & Payment" defaultOpen={true}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Toggle
                      label="Show Subtotal"
                      checked={settings.receipt.totals?.showSubtotal ?? true}
                      onChange={(v) => updateNested('receipt', 'totals', 'showSubtotal', v)}
                    />
                    <Toggle
                      label="Show Tax"
                      checked={settings.receipt.totals?.showTax ?? true}
                      onChange={(v) => updateNested('receipt', 'totals', 'showTax', v)}
                    />
                  </div>
                  {settings.receipt.totals?.showTax && (
                    <Toggle
                      label="Show Tax Breakdown (each tax type)"
                      checked={settings.receipt.totals?.showTaxBreakdown ?? false}
                      onChange={(v) => updateNested('receipt', 'totals', 'showTaxBreakdown', v)}
                    />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Toggle
                      label="Show Discounts"
                      checked={settings.receipt.totals?.showDiscounts ?? true}
                      onChange={(v) => updateNested('receipt', 'totals', 'showDiscounts', v)}
                    />
                    <Toggle
                      label="Show Service Charge"
                      checked={settings.receipt.totals?.showServiceCharge ?? true}
                      onChange={(v) => updateNested('receipt', 'totals', 'showServiceCharge', v)}
                    />
                  </div>
                  <div className="border-t border-slate-700 pt-3 mt-3">
                    <label className="text-xs text-slate-400 block mb-2">Payment Info</label>
                    <div className="grid grid-cols-2 gap-3">
                      <Toggle
                        label='Show Payment Method ("VISA *1234")'
                        checked={settings.receipt.totals?.showPaymentMethod ?? true}
                        onChange={(v) => updateNested('receipt', 'totals', 'showPaymentMethod', v)}
                      />
                      <Toggle
                        label="Show Change (Cash)"
                        checked={settings.receipt.totals?.showChange ?? true}
                        onChange={(v) => updateNested('receipt', 'totals', 'showChange', v)}
                      />
                    </div>
                  </div>
                </div>
              </Section>

              {/* Footer */}
              <Section title="Footer" defaultOpen={false}>
                <div className="space-y-3">
                  <Toggle label="Show Footer" checked={settings.footer.enabled} onChange={(v) => update('footer', 'enabled', v)} />
                  <Toggle label="Print Time" checked={settings.footer.showTime} onChange={(v) => update('footer', 'showTime', v)} />
                  <Toggle label="Ticket Number" checked={settings.footer.showTicketNumber} onChange={(v) => update('footer', 'showTicketNumber', v)} />
                  <Toggle label="Duplicate Header at End" checked={settings.footer.duplicateHeader} onChange={(v) => update('footer', 'duplicateHeader', v)} />
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Custom Text</label>
                    <input
                      type="text"
                      value={settings.footer.customText}
                      onChange={(e) => update('footer', 'customText', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                    />
                  </div>
                </div>
              </Section>

              {/* Tip Options */}
              <Section title="Tip Section" color="purple" defaultOpen={true}>
                <div className="space-y-3">
                  <Toggle label="Show Tip Section" checked={settings.receipt.tipLine} onChange={(v) => update('receipt', 'tipLine', v)} />
                  {settings.receipt.tipLine && (
                    <>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Tip Calculation</label>
                        <OptionButtons
                          options={[{ value: 'pre-tax', label: 'Pre-Tax' }, { value: 'post-tax', label: 'Post-Tax' }]}
                          value={settings.receipt.tipCalculation}
                          onChange={(v) => update('receipt', 'tipCalculation', v)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Tip Text Size</label>
                        <OptionButtons
                          options={[
                            { value: 'small', label: 'Small' },
                            { value: 'normal', label: 'Normal' },
                            { value: 'large', label: 'Large' },
                          ]}
                          value={settings.receipt.tipSectionStyle?.size || 'normal'}
                          onChange={(v) => updateNested('receipt', 'tipSectionStyle', 'size', v)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Tip Text Weight</label>
                        <OptionButtons
                          options={[
                            { value: 'thin', label: 'Thin' },
                            { value: 'normal', label: 'Normal' },
                            { value: 'bold', label: 'Bold' },
                            { value: 'thick', label: 'Thick' },
                          ]}
                          value={settings.receipt.tipSectionStyle?.weight || 'normal'}
                          onChange={(v) => updateNested('receipt', 'tipSectionStyle', 'weight', v)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Suggested Tips Per Line</label>
                        <OptionButtons
                          options={[
                            { value: 1, label: '1' },
                            { value: 2, label: '2' },
                            { value: 3, label: '3' },
                          ]}
                          value={settings.receipt.tipSectionStyle?.tipsPerLine || 3}
                          onChange={(v) => updateNested('receipt', 'tipSectionStyle', 'tipsPerLine', v)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Tip Section Frame</label>
                        <OptionButtons
                          options={[
                            { value: 'none', label: 'None' },
                            { value: 'box', label: '[ Box ]' },
                            { value: 'doubleLine', label: '═══' },
                            { value: 'dashedBox', label: '- - -' },
                          ]}
                          value={settings.receipt.tipSectionStyle?.frame || 'none'}
                          onChange={(v) => updateNested('receipt', 'tipSectionStyle', 'frame', v)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Tip Input Style</label>
                        <OptionButtons
                          options={[
                            { value: 'line', label: 'Tip: ________' },
                            { value: 'checkbox', label: '[ ] $5.00' },
                            { value: 'blank', label: 'Tip:' },
                          ]}
                          value={settings.receipt.tipSectionStyle?.tipInputStyle || 'line'}
                          onChange={(v) => updateNested('receipt', 'tipSectionStyle', 'tipInputStyle', v)}
                        />
                      </div>
                      <Toggle
                        label="Show Tip + Total Line"
                        checked={settings.receipt.tipSectionStyle?.showTipTotal ?? true}
                        onChange={(v) => updateNested('receipt', 'tipSectionStyle', 'showTipTotal', v)}
                      />
                    </>
                  )}
                </div>
              </Section>

              {/* Signature Options */}
              <Section title="Signature & Copies" color="cyan" defaultOpen={true}>
                <div className="space-y-3">
                  <Toggle
                    label="Show Signature Line"
                    checked={settings.receipt.signature?.enabled ?? true}
                    onChange={(v) => updateNested('receipt', 'signature', 'enabled', v)}
                  />
                  {settings.receipt.signature?.enabled && (
                    <>
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Number of Copies</label>
                        <OptionButtons
                          options={[
                            { value: 1, label: '1 Copy' },
                            { value: 2, label: '2 Copies' },
                          ]}
                          value={settings.receipt.signature?.copies || 1}
                          onChange={(v) => updateNested('receipt', 'signature', 'copies', v)}
                        />
                      </div>
                      <Toggle
                        label="Show Copy Labels"
                        checked={settings.receipt.signature?.showCopyLabel ?? true}
                        onChange={(v) => updateNested('receipt', 'signature', 'showCopyLabel', v)}
                      />
                      {settings.receipt.signature?.showCopyLabel && (
                        <>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Customer Copy Label</label>
                            <input
                              type="text"
                              value={settings.receipt.signature?.customerCopyLabel || 'CUSTOMER COPY'}
                              onChange={(e) => updateNested('receipt', 'signature', 'customerCopyLabel', e.target.value)}
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 block mb-1">Merchant Copy Label</label>
                            <input
                              type="text"
                              value={settings.receipt.signature?.merchantCopyLabel || 'MERCHANT COPY'}
                              onChange={(e) => updateNested('receipt', 'signature', 'merchantCopyLabel', e.target.value)}
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                            />
                          </div>
                        </>
                      )}
                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Signature Line Style</label>
                        <OptionButtons
                          options={[
                            { value: 'solid', label: '___________' },
                            { value: 'dotted', label: '............' },
                            { value: 'x-line', label: 'x__________' },
                          ]}
                          value={settings.receipt.signature?.lineStyle || 'x-line'}
                          onChange={(v) => updateNested('receipt', 'signature', 'lineStyle', v)}
                        />
                      </div>
                    </>
                  )}
                </div>
              </Section>

              {/* Footer Text */}
              <Section title="Footer Text" defaultOpen={false}>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Terms Text</label>
                    <input
                      type="text"
                      value={settings.receipt.termsText}
                      onChange={(e) => update('receipt', 'termsText', e.target.value)}
                      placeholder="Gratuity is optional"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Promo Text</label>
                    <input
                      type="text"
                      value={settings.receipt.promoText}
                      onChange={(e) => update('receipt', 'promoText', e.target.value)}
                      placeholder="Thank you for your business!"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                    />
                  </div>
                </div>
              </Section>

              {/* Reference Printing */}
              <Section title="Reference Printing" defaultOpen={false}>
                <Toggle label="Show Reference Items" checked={settings.reference.enabled} onChange={(v) => update('reference', 'enabled', v)} />
                {settings.reference.enabled && (
                  <div className="space-y-3 mt-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-2">Style</label>
                      <OptionButtons
                        options={[
                          { value: 'inline', label: 'Inline' },
                          { value: 'section', label: 'Section' },
                          { value: 'footer', label: 'Footer' },
                        ]}
                        value={settings.reference.style}
                        onChange={(v) => update('reference', 'style', v)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Prefix</label>
                      <input
                        type="text"
                        value={settings.reference.prefix}
                        onChange={(e) => update('reference', 'prefix', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white"
                      />
                    </div>
                  </div>
                )}
              </Section>

              {/* Pizza Options */}
              {templateType === 'PIZZA_STATION' && (
                <Section title="Pizza Options" color="orange" defaultOpen={true}>
                  <div className="space-y-3">
                    <Toggle label="Large Size Text" checked={settings.pizza.sizeProminent} onChange={(v) => update('pizza', 'sizeProminent', v)} />
                    <Toggle label='Show Inches (14")' checked={settings.pizza.showInches} onChange={(v) => update('pizza', 'showInches', v)} />
                    <Toggle label="Show Crust" checked={settings.pizza.showCrust} onChange={(v) => update('pizza', 'showCrust', v)} />
                    <div>
                      <label className="text-xs text-slate-400 block mb-2">Section Style</label>
                      <OptionButtons
                        options={[
                          { value: 'brackets', label: '[LEFT]' },
                          { value: 'header', label: '-- LEFT --' },
                          { value: 'indent', label: 'LEFT:' },
                        ]}
                        value={settings.pizza.sectionStyle}
                        onChange={(v) => update('pizza', 'sectionStyle', v)}
                      />
                    </div>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 space-y-2">
          {onTestPrint && (
            <button
              onClick={handleTestPrint}
              disabled={isTestPrinting}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium text-sm disabled:opacity-50"
            >
              {isTestPrinting ? 'Printing...' : 'Test Print'}
            </button>
          )}
          <div className="flex gap-2">
            {onCancel && (
              <button onClick={onCancel} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium text-sm">
                Cancel
              </button>
            )}
            {onSave && (
              <button onClick={() => onSave(settings)} className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium text-sm">
                Save Settings
              </button>
            )}
          </div>
        </div>
      </div>

      {/* LIVE PREVIEW */}
      <div className="w-[45%] bg-slate-950 p-6 flex flex-col items-center overflow-y-auto">
        <div className="text-xs text-slate-500 mb-4 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Live Preview • {paperWidth}mm • {showImpactMode ? 'Impact' : 'Thermal'} •{' '}
          <span className={previewMode === 'kitchen' ? 'text-orange-400' : previewMode === 'entertainment' ? 'text-green-400' : 'text-purple-400'}>
            {previewMode === 'kitchen' ? 'Kitchen Ticket' : previewMode === 'entertainment' ? 'Entertainment Ticket' : 'Customer Receipt'}
          </span>
        </div>

        <TicketPreview
          settings={settings}
          globalSettings={global}
          templateType={templateType}
          paperWidth={paperWidth}
          showImpactMode={showImpactMode}
          previewMode={previewMode}
        />
      </div>
    </div>
  )
}



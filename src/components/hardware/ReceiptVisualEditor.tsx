'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'

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
  DEFAULT_HEADER_ELEMENTS,
  DEFAULT_ALERTS,
  DEFAULT_PRINT_TEMPLATE_SETTINGS,
  DEFAULT_GLOBAL_RECEIPT_SETTINGS,
} from '@/types/print'

// Re-export types for consumers
export type { PrintTemplateSettings, ElementConfig, DividerConfig, AlertRule }

// Local reference to defaults for this component
const DEFAULT_SETTINGS = DEFAULT_PRINT_TEMPLATE_SETTINGS

// Preview modes for the live preview
type PreviewMode = 'kitchen' | 'receipt' | 'entertainment'

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
  const [settings, setSettings] = useState<PrintTemplateSettings>(() => {
    const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    if (initialSettings) {
      Object.keys(initialSettings).forEach((key) => {
        if (typeof (initialSettings as any)[key] === 'object' && (initialSettings as any)[key] !== null) {
          if (Array.isArray((initialSettings as any)[key])) {
            merged[key] = (initialSettings as any)[key]
          } else {
            merged[key] = { ...merged[key], ...(initialSettings as any)[key] }
          }
        } else {
          merged[key] = (initialSettings as any)[key]
        }
      })
    }
    return merged
  })

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

  // Undo/Redo
  const [history, setHistory] = useState<PrintTemplateSettings[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isUndoRedo, setIsUndoRedo] = useState(false)

  useEffect(() => {
    if (isUndoRedo) {
      setIsUndoRedo(false)
      return
    }
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(settings)))
      if (newHistory.length > 50) newHistory.shift()
      return newHistory
    })
    setHistoryIndex((prev) => Math.min(prev + 1, 49))
  }, [settings])

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setIsUndoRedo(true)
      setHistoryIndex(historyIndex - 1)
      setSettings(JSON.parse(JSON.stringify(history[historyIndex - 1])))
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setIsUndoRedo(true)
      setHistoryIndex(historyIndex + 1)
      setSettings(JSON.parse(JSON.stringify(history[historyIndex + 1])))
    }
  }, [history, historyIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  // Update helpers
  const updateElement = useCallback((id: string, updates: Partial<ElementConfig>) => {
    setSettings((prev) => ({
      ...prev,
      headerElements: prev.headerElements.map((el) =>
        el.id === id ? { ...el, ...updates } : el
      ),
    }))
  }, [])

  const moveElement = useCallback((fromIndex: number, toIndex: number) => {
    setSettings((prev) => {
      const elements = [...prev.headerElements]
      const [moved] = elements.splice(fromIndex, 1)
      elements.splice(toIndex, 0, moved)
      return { ...prev, headerElements: elements }
    })
  }, [])

  const update = useCallback(<K extends keyof PrintTemplateSettings>(
    section: K,
    key: string,
    value: any
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as any),
        [key]: value,
      },
    }))
  }, [])

  const updateNested = useCallback(<K extends keyof PrintTemplateSettings>(
    section: K,
    subsection: string,
    key: string,
    value: any
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as any),
        [subsection]: {
          ...((prev[section] as any)[subsection] || {}),
          [key]: value,
        },
      },
    }))
  }, [])

  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)
  }, [settings])

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
              onClick={() => setSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))}
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

// Element Editor Component
function ElementEditor({
  element,
  showImpactMode,
  onUpdate,
  onClose,
}: {
  element: ElementConfig
  showImpactMode: boolean
  onUpdate: (updates: Partial<ElementConfig>) => void
  onClose: () => void
}) {
  return (
    <div className="rounded-xl border border-cyan-700 bg-cyan-950/30 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-bold text-cyan-400">{element.label} Settings</span>
        <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-4">
        {/* Alignment */}
        <div>
          <label className="text-xs text-slate-400 block mb-2">Alignment</label>
          <OptionButtons
            options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]}
            value={element.alignment}
            onChange={(v) => onUpdate({ alignment: v })}
          />
        </div>

        {/* Size */}
        <div>
          <label className="text-xs text-slate-400 block mb-2">Size</label>
          <OptionButtons
            options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'xlarge', label: 'XL' }]}
            value={element.size}
            onChange={(v) => onUpdate({ size: v })}
          />
        </div>

        {/* Formatting */}
        <div className="grid grid-cols-2 gap-3">
          <Toggle label="Bold" checked={element.bold} onChange={(v) => onUpdate({ bold: v })} />
          <Toggle label="ALL CAPS" checked={element.caps} onChange={(v) => onUpdate({ caps: v })} />
        </div>

        {/* Special Formatting */}
        <div className="pt-3 border-t border-slate-700">
          <label className="text-xs text-slate-400 block mb-2">Special Formatting</label>
          <div className="grid grid-cols-2 gap-3">
            <Toggle
              label={showImpactMode ? 'Red Print' : 'Reverse Print'}
              checked={showImpactMode ? element.redPrint : element.reversePrint}
              onChange={(v) => onUpdate(showImpactMode ? { redPrint: v } : { reversePrint: v })}
              important
            />
            {!showImpactMode && (
              <Toggle label="Reverse (White on Black)" checked={element.reversePrint} onChange={(v) => onUpdate({ reversePrint: v })} />
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {showImpactMode
              ? 'Red Print uses the red ribbon on TM-U220 impact printers'
              : 'Reverse Print creates white text on black background (great for station names)'}
          </p>
        </div>

        {/* Prefix/Suffix */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Prefix</label>
            <input
              type="text"
              value={element.prefix}
              onChange={(e) => onUpdate({ prefix: e.target.value })}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white"
              placeholder="e.g., 'Order: '"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Suffix</label>
            <input
              type="text"
              value={element.suffix}
              onChange={(e) => onUpdate({ suffix: e.target.value })}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white"
            />
          </div>
        </div>

        {/* Border Below */}
        <div>
          <label className="text-xs text-slate-400 block mb-2">Border Below</label>
          <OptionButtons
            options={[
              { value: 'none', label: 'None' },
              { value: 'dash', label: '----' },
              { value: 'double', label: '════' },
              { value: 'star', label: '****' },
            ]}
            value={element.borderBottom}
            onChange={(v) => onUpdate({ borderBottom: v })}
          />
        </div>
      </div>
    </div>
  )
}

// Ticket Preview Component
function TicketPreview({
  settings,
  globalSettings,
  templateType,
  paperWidth,
  showImpactMode,
  previewMode,
}: {
  settings: PrintTemplateSettings
  globalSettings: GlobalReceiptSettings
  templateType: TemplateType
  paperWidth: 80 | 58
  showImpactMode: boolean
  previewMode: PreviewMode
}) {
  const charWidth = paperWidth === 80 ? 48 : 32
  const pixelWidth = paperWidth === 80 ? 300 : 220

  const [isFlashing, setIsFlashing] = useState(false)
  const prevSettingsRef = useRef(JSON.stringify(settings) + previewMode)

  useEffect(() => {
    const current = JSON.stringify(settings) + previewMode
    if (current !== prevSettingsRef.current) {
      setIsFlashing(true)
      const timer = setTimeout(() => setIsFlashing(false), 150)
      prevSettingsRef.current = current
      return () => clearTimeout(timer)
    }
  }, [settings, previewMode])

  // Helpers
  const getDividerChar = (style: string) => {
    switch (style) {
      case 'double': return '═'
      case 'star': return '*'
      case 'dot': return '·'
      case 'thick': return '█'
      case 'blank': return ' '
      default: return '-'
    }
  }

  const getModPrefix = () => {
    switch (settings.modifiers.prefix) {
      case 'dash': return '- '
      case 'bullet': return '• '
      case 'arrow': return '> '
      case 'asterisk': return '* '
      default: return ''
    }
  }

  const formatPreMod = (preMod: string, name: string) => {
    const pm = settings.modifiers.caps ? preMod.toUpperCase() : preMod
    const n = settings.modifiers.caps ? name.toUpperCase() : name
    switch (settings.preModifiers.style) {
      case 'stars': return `*${pm}* ${n}`
      case 'brackets': return `[${pm}] ${n}`
      case 'parens': return `(${pm}) ${n}`
      case 'caps': return `${pm.toUpperCase()} ${n.toUpperCase()}`
      default: return `${pm} ${n}`
    }
  }

  const formatSeat = (seat: number) => {
    switch (settings.seats.format) {
      case 'Seat 1': return `Seat ${seat}`
      case '#1': return `#${seat}`
      case '(1)': return `(${seat})`
      default: return `S${seat}`
    }
  }

  const getSizeClass = (size: string) => {
    switch (size) {
      case 'xlarge': return 'text-2xl'
      case 'large': return 'text-lg'
      default: return 'text-sm'
    }
  }

  const getAlignClass = (align: string) => {
    switch (align) {
      case 'right': return 'text-right'
      case 'center': return 'text-center'
      default: return 'text-left'
    }
  }

  const Divider = ({ config }: { config: { style: string } }) => (
    <div className="text-slate-400 select-none overflow-hidden whitespace-nowrap text-xs my-1">
      {getDividerChar(config.style).repeat(charWidth)}
    </div>
  )

  // Two-column line helper for receipts
  const TwoCol = ({ left, right, bold = false }: { left: string; right: string; bold?: boolean }) => (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )

  // Sample data values
  const sampleData: Record<string, string> = {
    stationName: previewMode === 'receipt' ? 'RECEIPT' : 'KITCHEN',
    orderNumber: '124',
    orderType: 'DINE IN',
    tableName: '4',
    tabName: 'Smith Party',
    guestCount: '3',
    serverName: 'Sarah',
    checkNumber: '00124',
    timestamp: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString(),
  }

  // Sample receipt items
  const sampleItems = [
    { name: 'Cheeseburger', price: 14.99, qty: 1, mods: [{ name: 'No Onion', price: 0 }, { name: 'Extra Pickles', price: 0.50 }] },
    { name: 'Caesar Salad', price: 12.99, qty: 2, mods: [{ name: 'Dressing on Side', price: 0 }] },
    { name: 'Draft Beer', price: 6.00, qty: 2, mods: [] },
  ]
  const subtotal = 52.97
  const tax = 4.24
  const total = 57.21

  return (
    <div
      className={`bg-[#fdfdf8] shadow-[0_0_40px_rgba(0,0,0,0.5)] text-black font-mono leading-tight transition-all duration-150 ${isFlashing ? 'ring-4 ring-cyan-400/50' : ''}`}
      style={{
        width: `${pixelWidth}px`,
        padding: paperWidth === 80 ? '20px' : '14px',
        fontSize: paperWidth === 80 ? '11px' : '9px',
      }}
    >
      {/* HEADER ELEMENTS */}
      {settings.headerElements
        .filter((el) => el.enabled)
        .map((element) => {
          const value = sampleData[element.id] || ''
          const displayValue = `${element.prefix}${element.caps ? value.toUpperCase() : value}${element.suffix}`
          const isReverse = element.reversePrint && !showImpactMode
          const isRed = element.redPrint && showImpactMode

          return (
            <div key={element.id}>
              <div
                className={`
                  ${getSizeClass(element.size)}
                  ${getAlignClass(element.alignment)}
                  ${element.bold ? 'font-bold' : ''}
                  ${isReverse ? 'bg-black text-white px-2 py-0.5' : ''}
                  ${isRed ? 'text-red-600' : ''}
                `}
              >
                {displayValue}
              </div>
              {element.borderBottom !== 'none' && (
                <div className="text-slate-400 overflow-hidden whitespace-nowrap text-xs">
                  {getDividerChar(element.borderBottom).repeat(charWidth)}
                </div>
              )}
            </div>
          )
        })}

      {/* Header Divider */}
      <Divider config={settings.dividers.afterHeader} />

      {/* === KITCHEN MODE === */}
      {previewMode === 'kitchen' && (
        <>
          {/* ITEMS */}
          <div className={settings.spacing.compact ? 'space-y-0.5' : 'space-y-2'}>
            {/* Category Header */}
            {settings.categories.enabled && (
              <>
                {settings.categories.dividerAbove && <Divider config={settings.dividers.betweenCategories} />}
                <div
                  className={`
                    ${getSizeClass(settings.categories.size)}
                    ${getAlignClass(settings.categories.alignment)}
                    ${settings.categories.style === 'bold' || settings.categories.style === 'banner' ? 'font-bold' : ''}
                    ${settings.categories.style === 'reverse' ? 'bg-black text-white px-2 py-0.5' : ''}
                  `}
                >
                  {settings.categories.style === 'boxed' && '['}
                  {settings.categories.style === 'banner' && '═══ '}
                  {settings.categories.caps ? 'ENTREES' : 'Entrees'}
                  {settings.categories.style === 'boxed' && ']'}
                  {settings.categories.style === 'banner' && ' ═══'}
                </div>
              </>
            )}

            {/* Item 1 */}
            <div>
              <div className={`${getSizeClass(settings.items.size)} ${settings.items.bold ? 'font-bold' : ''}`}>
                {settings.seats.display === 'prefix' && <span className="text-slate-600">{formatSeat(1)}: </span>}
                {settings.items.quantityPosition === 'before' && '1x '}
                {settings.items.caps ? 'CHEESEBURGER' : 'Cheeseburger'}
                {settings.items.quantityPosition === 'after' && ' x1'}
                {settings.seats.display === 'inline' && <span className="text-slate-500"> ({formatSeat(1)})</span>}
              </div>
              <div style={{ paddingLeft: `${settings.modifiers.indent * 4}px` }} className={settings.modifiers.bold ? 'font-bold' : ''}>
                <div className={settings.preModifiers.highlight ? (showImpactMode ? 'text-red-600 font-bold' : 'bg-black text-white px-1') : ''}>
                  {getModPrefix()}{formatPreMod('NO', 'Onion')}
                </div>
                <div>{getModPrefix()}{settings.modifiers.caps ? 'EXTRA PICKLES' : 'Extra Pickles'}</div>
              </div>
            </div>

            {/* Seat Separator */}
            {settings.seats.groupBySeat && settings.seats.seatSeparator !== 'none' && (
              <div className="text-slate-400 text-xs text-center my-1">
                {settings.seats.seatSeparator === 'newSeat'
                  ? settings.seats.newSeatText.replace('{n}', '2')
                  : settings.seats.seatSeparator === 'blank'
                    ? '\u00A0'
                    : getDividerChar(settings.seats.seatSeparator).repeat(charWidth / 2)
                }
              </div>
            )}

            {/* Item 2 with Notes */}
            <div>
              <div className={`${getSizeClass(settings.items.size)} ${settings.items.bold ? 'font-bold' : ''}`}>
                {settings.seats.display === 'prefix' && <span className="text-slate-600">{formatSeat(2)}: </span>}
                {settings.items.quantityPosition === 'before' && '2x '}
                {settings.items.caps ? 'CAESAR SALAD' : 'Caesar Salad'}
              </div>
              <div style={{ paddingLeft: `${settings.modifiers.indent * 4}px` }}>
                <div>{getModPrefix()}{settings.modifiers.caps ? 'DRESSING ON SIDE' : 'Dressing on Side'}</div>
                {settings.notes.enabled && (
                  <div className={`
                    ${settings.notes.style === 'italic' ? 'italic' : ''}
                    ${settings.notes.style === 'reverse' ? 'bg-black text-white px-1' : ''}
                  `}>
                    {settings.notes.style === 'boxed' && '['}
                    {settings.notes.prefix} Nut allergy
                    {settings.notes.style === 'boxed' && ']'}
                  </div>
                )}
              </div>
            </div>

            {/* Resend Indicator */}
            {settings.indicators.resend.enabled && (
              <div className={`text-center font-bold mt-3 ${settings.indicators.resend.reverse ? (showImpactMode ? 'text-red-600' : 'bg-black text-white px-2 py-0.5') : ''}`}>
                {settings.indicators.resend.format}
              </div>
            )}
          </div>
        </>
      )}

      {/* === RECEIPT MODE === */}
      {previewMode === 'receipt' && (
        <>
          {/* ITEMIZED ITEMS - only show when receiptType is 'itemized' */}
          {settings.receipt.receiptType === 'itemized' && (
            <div className="space-y-1 text-xs">
              {sampleItems.map((item, i) => (
                <div key={i}>
                  <TwoCol
                    left={`${settings.receipt.itemized?.showQuantity && item.qty > 1 ? `${item.qty}x ` : ''}${item.name}`}
                    right={settings.receipt.itemized?.showItemPrices ? `$${(item.price * item.qty).toFixed(2)}` : ''}
                    bold={settings.items.bold}
                  />
                  {settings.receipt.itemized?.showModifiers && item.mods.map((mod, j) => (
                    <TwoCol
                      key={j}
                      left={`${settings.receipt.itemized?.indentModifiers ? '  ' : ''}${mod.name}`}
                      right={settings.receipt.itemized?.showModifierPrices && mod.price > 0 ? `+$${mod.price.toFixed(2)}` : ''}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Simple receipt message */}
          {settings.receipt.receiptType === 'simple' && (
            <div className="text-xs text-center text-slate-500 py-2">
              (Simple receipt - no itemization)
            </div>
          )}

          <Divider config={{ style: 'dash' }} />

          {/* TOTALS */}
          <div className="text-xs space-y-0.5">
            {settings.receipt.totals?.showSubtotal && <TwoCol left="Subtotal" right={`$${subtotal.toFixed(2)}`} />}
            {settings.receipt.totals?.showDiscounts && (
              <TwoCol left="Discount" right="-$5.00" />
            )}
            {settings.receipt.totals?.showServiceCharge && (
              <TwoCol left="Service Charge" right="$4.00" />
            )}
            {settings.receipt.totals?.showTax && (
              <>
                <TwoCol left="Tax" right={`$${tax.toFixed(2)}`} />
                {settings.receipt.totals?.showTaxBreakdown && (
                  <>
                    <TwoCol left="  State Tax (6%)" right="$2.54" />
                    <TwoCol left="  Local Tax (2%)" right="$1.70" />
                  </>
                )}
              </>
            )}
            <TwoCol left="TOTAL" right={`$${total.toFixed(2)}`} bold />
          </div>

          {settings.receipt.totals?.showPaymentMethod && (
            <div className="text-xs mt-2">
              <TwoCol left="VISA *4242" right={`$${total.toFixed(2)}`} />
            </div>
          )}

          {settings.receipt.totals?.showChange && (
            <div className="text-xs">
              <TwoCol left="Cash Tendered" right="$60.00" />
              <TwoCol left="Change" right="$2.79" />
            </div>
          )}

          {/* TIP SECTION */}
          {settings.receipt.tipLine && (
            <>
              <Divider config={{ style: 'dash' }} />
              <div className={`
                text-xs mt-2
                ${settings.receipt.tipSectionStyle?.frame === 'box' ? 'border border-black p-2' : ''}
                ${settings.receipt.tipSectionStyle?.frame === 'dashedBox' ? 'border border-dashed border-black p-2' : ''}
              `}>
                {settings.receipt.tipSectionStyle?.frame === 'doubleLine' && (
                  <div className="text-center text-slate-400 mb-1">{'═'.repeat(charWidth - 4)}</div>
                )}

                {/* Suggested Tips */}
                <div className={`text-center mb-2 ${settings.receipt.tipSectionStyle?.weight === 'bold' || settings.receipt.tipSectionStyle?.weight === 'thick' ? 'font-bold' : ''}`}>
                  <div className="text-slate-500 mb-1">Suggested Gratuity</div>
                  <div className="flex justify-center gap-3">
                    {settings.receipt.suggestedTips.slice(0, settings.receipt.tipSectionStyle?.tipsPerLine || 3).map((pct) => (
                      <span key={pct}>{pct}%=${(total * pct / 100).toFixed(2)}</span>
                    ))}
                  </div>
                </div>

                {/* Tip Line */}
                <div className="mt-2">
                  {settings.receipt.tipSectionStyle?.tipInputStyle === 'checkbox' ? (
                    <div className="flex justify-around">
                      <span>[ ] ${(total * 0.18).toFixed(2)}</span>
                      <span>[ ] ${(total * 0.20).toFixed(2)}</span>
                      <span>[ ] Other</span>
                    </div>
                  ) : settings.receipt.tipSectionStyle?.tipInputStyle === 'blank' ? (
                    <TwoCol left="Tip:" right="" />
                  ) : (
                    <TwoCol left="Tip:" right="__________" />
                  )}
                </div>

                {settings.receipt.tipSectionStyle?.showTipTotal && (
                  <div className="mt-2">
                    <TwoCol left="Total:" right="__________" bold />
                  </div>
                )}

                {settings.receipt.tipSectionStyle?.frame === 'doubleLine' && (
                  <div className="text-center text-slate-400 mt-1">{'═'.repeat(charWidth - 4)}</div>
                )}
              </div>
            </>
          )}

          {/* SIGNATURE */}
          {settings.receipt.signature?.enabled && (
            <div className="mt-4 text-xs">
              <div className="mb-2">
                {settings.receipt.signature?.lineStyle === 'x-line' && 'x'}
                {settings.receipt.signature?.lineStyle === 'dotted' ? '.'.repeat(35) : '_'.repeat(35)}
              </div>
              <div className="text-center text-slate-500">Signature</div>
              {settings.receipt.signature?.showCopyLabel && (
                <div className="text-center font-bold mt-2">
                  {settings.receipt.signature?.customerCopyLabel || 'CUSTOMER COPY'}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* === ENTERTAINMENT MODE === */}
      {previewMode === 'entertainment' && (
        <>
          {/* Sample entertainment ticket - Session Start */}
          <div className={`text-center mb-2 ${settings.entertainment?.highlightWarnings && !showImpactMode ? 'bg-black text-white px-2 py-1' : settings.entertainment?.highlightWarnings && showImpactMode ? 'text-red-600' : ''}`}>
            <div className="text-lg font-bold">
              {settings.entertainment?.sessionStartHeader || 'SESSION STARTED'}
            </div>
          </div>

          <Divider config={{ style: 'double' }} />

          {/* Guest Name */}
          {settings.entertainment?.showGuestName && (
            <div className={`
              text-center my-2
              ${getSizeClass(settings.entertainment?.nameSize || 'large')}
              ${settings.entertainment?.nameBold ? 'font-bold' : ''}
            `}>
              Johnson Party
            </div>
          )}

          {/* Party Size */}
          {settings.entertainment?.showPartySize && (
            <div className="text-xs text-center">
              Party of 4
            </div>
          )}

          <Divider config={{ style: 'dash' }} />

          {/* Table/Lane Assignment */}
          {settings.entertainment?.showTableAssignment && (
            <div className="text-sm font-bold text-center my-2">
              Pool Table 3
            </div>
          )}

          {/* Time Information */}
          <div className="text-xs space-y-1 my-3">
            {settings.entertainment?.showStartTime && (
              <TwoCol left="Start Time:" right="7:30 PM" />
            )}
            {settings.entertainment?.showEndTime && (
              <TwoCol left={settings.entertainment?.returnByLabel || 'Return By:'} right="8:30 PM" />
            )}
            {settings.entertainment?.showDuration && (
              <TwoCol left="Duration:" right="60 minutes" />
            )}
            {settings.entertainment?.showTimeRemaining && (
              <TwoCol left="Time Remaining:" right="58 min" />
            )}
          </div>

          {/* Price */}
          {settings.entertainment?.showPrice && (
            <>
              <Divider config={{ style: 'dash' }} />
              <div className="text-sm font-bold text-center my-2">
                $15.00 / hour
              </div>
            </>
          )}

          {/* Instructions */}
          {settings.entertainment?.showInstructions && (
            <>
              <Divider config={{ style: 'dash' }} />
              <div className="text-xs mt-2">
                <div className="font-bold">{settings.entertainment?.instructionsLabel || 'Instructions:'}</div>
                <div className="italic mt-1">Birthday party - please bring cake at 8pm</div>
              </div>
            </>
          )}

          {/* Sample Warning Ticket Preview */}
          <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-300">
            <div className="text-[10px] text-slate-500 text-center mb-2">--- Warning Ticket Preview ---</div>
            <div className={`text-center ${settings.entertainment?.highlightWarnings && !showImpactMode ? 'bg-black text-white px-2 py-1' : settings.entertainment?.highlightWarnings && showImpactMode ? 'text-red-600 font-bold' : ''}`}>
              <div className="text-lg font-bold">
                {settings.entertainment?.warningHeader || '5 MIN WARNING'}
              </div>
            </div>
            {settings.entertainment?.showGuestName && (
              <div className={`text-center mt-1 ${settings.entertainment?.nameBold ? 'font-bold' : ''}`}>
                Johnson Party
              </div>
            )}
            {settings.entertainment?.showTableAssignment && (
              <div className="text-xs text-center">Pool Table 3</div>
            )}
            {settings.entertainment?.showTimeRemaining && (
              <div className="text-sm text-center font-bold mt-1">5 minutes left!</div>
            )}
          </div>
        </>
      )}

      {/* Footer Divider */}
      <Divider config={settings.dividers.beforeFooter} />

      {/* Duplicate Header */}
      {settings.footer.duplicateHeader && (
        <div className="text-center text-sm mt-1 pt-1 border-t border-dashed border-slate-300">
          <div className="font-bold">#124</div>
          <div>Table 4 • Sarah</div>
        </div>
      )}

      {/* FOOTER */}
      {settings.footer.enabled && (
        <div className="text-xs text-slate-500 text-center mt-2">
          {settings.footer.showTime && <div>{new Date().toLocaleString()}</div>}
          {settings.footer.showTicketNumber && <div>Ticket #00124</div>}
          {settings.footer.customText && <div>{settings.footer.customText}</div>}
          {settings.receipt.termsText && <div className="italic mt-1">{settings.receipt.termsText}</div>}
          {settings.receipt.promoText && <div className="mt-1">{settings.receipt.promoText}</div>}
        </div>
      )}
    </div>
  )
}

// Collapsible Section
function Section({
  title,
  color = 'slate',
  children,
  defaultOpen = true,
}: {
  title: string
  color?: 'slate' | 'red' | 'orange' | 'cyan' | 'purple' | 'green'
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const colorClasses: Record<string, string> = {
    slate: 'border-slate-700 bg-slate-800/40',
    red: 'border-red-900/50 bg-red-950/30',
    orange: 'border-orange-900/50 bg-orange-950/30',
    cyan: 'border-cyan-900/50 bg-cyan-950/30',
    purple: 'border-purple-900/50 bg-purple-950/30',
    green: 'border-green-900/50 bg-green-950/30',
  }

  const headerColors: Record<string, string> = {
    slate: 'text-slate-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
  }

  return (
    <div className={`rounded-xl border ${colorClasses[color]} overflow-hidden`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
      >
        <span className={`text-xs font-black uppercase tracking-widest ${headerColors[color]}`}>{title}</span>
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && <div className="p-4 pt-2 space-y-3 border-t border-slate-700/50">{children}</div>}
    </div>
  )
}

// Divider Selector
function DividerSelector({
  label,
  value,
  onChange,
}: {
  label: string
  value: { style: string; fullWidth: boolean }
  onChange: (value: { style: string; fullWidth: boolean }) => void
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-2">{label}</label>
      <OptionButtons
        options={[
          { value: 'dash', label: '----' },
          { value: 'double', label: '════' },
          { value: 'star', label: '****' },
          { value: 'dot', label: '····' },
          { value: 'blank', label: 'None' },
        ]}
        value={value.style}
        onChange={(v) => onChange({ ...value, style: v })}
      />
    </div>
  )
}

// Option Buttons
function OptionButtons({
  options,
  value,
  onChange,
}: {
  options: { value: any; label: string }[]
  value: any
  onChange: (value: any) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-cyan-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Toggle
function Toggle({
  label,
  checked,
  onChange,
  important = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  important?: boolean
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className={`text-sm ${important ? 'text-amber-400 font-medium' : 'text-slate-300'}`}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-cyan-600' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  )
}

'use client'

import type { ElementConfig } from '@/types/print'
import { OptionButtons, Toggle } from './printEditorHelpers'

export interface ElementEditorProps {
  element: ElementConfig
  showImpactMode: boolean
  onUpdate: (updates: Partial<ElementConfig>) => void
  onClose: () => void
}

export function ElementEditor({
  element,
  showImpactMode,
  onUpdate,
  onClose,
}: ElementEditorProps) {
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

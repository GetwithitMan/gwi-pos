'use client'

import { Modal } from '@/components/ui/modal'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'

/** Quick-name presets for 1-tap naming */
const QUICK_NAMES = [
  { label: 'Seat 1', value: 'Seat 1' },
  { label: 'Seat 2', value: 'Seat 2' },
  { label: 'Seat 3', value: 'Seat 3' },
  { label: 'Seat 4', value: 'Seat 4' },
  { label: 'Seat 5', value: 'Seat 5' },
  { label: 'Seat 6', value: 'Seat 6' },
  { label: 'VIP', value: 'VIP' },
  { label: 'Patio', value: 'Patio' },
] as const

interface NewTabModalProps {
  isOpen: boolean
  onClose: () => void
  tabName: string
  onTabNameChange: (name: string) => void
  /** Called to create the tab. Optional overrideName for quick-name buttons. */
  onSubmit: (overrideName?: string) => void
  isCreating: boolean
  requireName: boolean
}

export function NewTabModal({ isOpen, onClose, tabName, onTabNameChange, onSubmit, isCreating, requireName }: NewTabModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      <div className="-m-5 bg-slate-800 border border-white/10 rounded-2xl p-6 max-h-[95vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-2">Tab Name</h2>
        <p className="text-sm text-slate-400 mb-3">
          Tap a quick name or type one below {requireName && <span className="text-red-400">*</span>}
        </p>

        {/* Quick-name buttons — 1-tap naming */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {QUICK_NAMES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => onSubmit(value)}
              disabled={isCreating}
              className="py-3 px-2 bg-violet-600 hover:bg-violet-500 active:bg-violet-400 rounded-lg text-white font-semibold text-sm transition-colors disabled:opacity-50 touch-manipulation"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 border-t border-white/10" />
          <span className="text-xs text-slate-500 uppercase tracking-wider">or type a name</span>
          <div className="flex-1 border-t border-white/10" />
        </div>

        {/* Input display */}
        <div className="w-full px-4 py-3 bg-slate-700 border border-white/10 rounded-lg text-white min-h-[48px] mb-3 text-lg">
          {tabName || <span className="text-slate-400">e.g. John, Table 5, etc.</span>}
        </div>

        {/* On-screen keyboard */}
        <OnScreenKeyboard
          value={tabName}
          onChange={onTabNameChange}
          onSubmit={() => onSubmit()}
          theme="dark"
          submitLabel="Start Tab"
          className="mb-3"
        />

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit()}
            disabled={isCreating}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-semibold transition-colors disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Start Tab'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

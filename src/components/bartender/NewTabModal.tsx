'use client'

import { Modal } from '@/components/ui/modal'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'

interface NewTabModalProps {
  isOpen: boolean
  onClose: () => void
  tabName: string
  onTabNameChange: (name: string) => void
  onSubmit: () => void
  isCreating: boolean
  requireName: boolean
}

export function NewTabModal({ isOpen, onClose, tabName, onTabNameChange, onSubmit, isCreating, requireName }: NewTabModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      <div className="-m-5 bg-slate-800 border border-white/10 rounded-2xl p-6 max-h-[95vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-2">Tab Name</h2>
        <p className="text-sm text-slate-400 mb-3">
          Enter a name for this tab {requireName && <span className="text-red-400">*</span>}
        </p>

        {/* Input display */}
        <div className="w-full px-4 py-3 bg-slate-700 border border-white/10 rounded-lg text-white min-h-[48px] mb-3 text-lg">
          {tabName || <span className="text-slate-400">e.g. John, Table 5, etc.</span>}
        </div>

        {/* On-screen keyboard */}
        <OnScreenKeyboard
          value={tabName}
          onChange={onTabNameChange}
          onSubmit={onSubmit}
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
            onClick={onSubmit}
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

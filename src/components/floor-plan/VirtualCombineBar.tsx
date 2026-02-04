'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { XMarkIcon, LinkIcon } from '@heroicons/react/24/outline'
import { useFloorPlanStore, type FloorPlanTable } from './use-floor-plan'

interface VirtualCombineBarProps {
  tables: FloorPlanTable[]
  onConfirm: () => void
  onCancel: () => void
  isConfirming?: boolean
}

export function VirtualCombineBar({
  tables,
  onConfirm,
  onCancel,
  isConfirming = false,
}: VirtualCombineBarProps) {
  const {
    virtualCombineMode,
    virtualCombineSelectedIds,
    virtualCombinePrimaryId,
    setVirtualCombinePrimary,
  } = useFloorPlanStore()

  if (!virtualCombineMode) return null

  const selectedTables = tables.filter(t => virtualCombineSelectedIds.has(t.id))
  const primaryTable = tables.find(t => t.id === virtualCombinePrimaryId)
  const canConfirm = virtualCombineSelectedIds.size >= 2 && !isConfirming

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="flex flex-col items-center gap-3">
          {/* Selected tables display */}
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/90 backdrop-blur-sm rounded-lg border border-slate-600/50">
            <LinkIcon className="w-4 h-4 text-cyan-400" />
            <span className="text-sm text-slate-300">
              {selectedTables.map((t, i) => (
                <span key={t.id}>
                  <button
                    onClick={() => setVirtualCombinePrimary(t.id)}
                    className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                      t.id === virtualCombinePrimaryId
                        ? 'bg-cyan-500 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                    title={t.id === virtualCombinePrimaryId ? 'Primary table' : 'Click to make primary'}
                  >
                    {t.abbreviation || t.name}
                    {t.id === virtualCombinePrimaryId && ' (Primary)'}
                  </button>
                  {i < selectedTables.length - 1 && <span className="mx-1 text-slate-500">+</span>}
                </span>
              ))}
            </span>
          </div>

          {/* Main action bar */}
          <div className="flex items-center gap-4 px-6 py-3 bg-slate-900/95 backdrop-blur-md rounded-full shadow-xl border border-slate-700/50">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-white font-medium">
                {virtualCombineSelectedIds.size} table{virtualCombineSelectedIds.size !== 1 ? 's' : ''} selected
              </span>
            </div>

            <div className="w-px h-6 bg-slate-600" />

            <span className="text-sm text-slate-400">
              Tap tables to add/remove
            </span>

            <div className="w-px h-6 bg-slate-600" />

            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
              Cancel
            </button>

            <button
              onClick={onConfirm}
              disabled={!canConfirm}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                canConfirm
                  ? 'bg-cyan-500 text-white hover:bg-cyan-400 shadow-lg shadow-cyan-500/25'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
            >
              <LinkIcon className="w-4 h-4" />
              {isConfirming ? 'Creating...' : 'Create Virtual Group'}
            </button>
          </div>

          {/* Help text */}
          {virtualCombineSelectedIds.size < 2 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-slate-400"
            >
              Select at least 2 tables to create a virtual group
            </motion.p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

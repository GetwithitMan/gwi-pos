'use client'

import { motion } from 'framer-motion'

interface ModeSelectorProps {
  value: 'bar' | 'food' | 'entertainment'
  onChange: (mode: 'bar' | 'food' | 'entertainment') => void
}

const MODES = [
  { key: 'bar' as const, label: 'BAR', icon: '🍸', activeColor: 'bg-blue-600', activeShadow: 'shadow-blue-500/50', activeRing: 'ring-blue-400/50' },
  { key: 'food' as const, label: 'FOOD', icon: '🍔', activeColor: 'bg-orange-500', activeShadow: 'shadow-orange-500/50', activeRing: 'ring-orange-400/50' },
  { key: 'entertainment' as const, label: 'ENT', icon: '🎱', activeColor: 'bg-purple-600', activeShadow: 'shadow-purple-500/50', activeRing: 'ring-purple-400/50' },
]

export default function ModeSelector({ value, onChange }: ModeSelectorProps) {
  return (
    <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-1 flex gap-1">
      {MODES.map((mode) => {
        const isActive = value === mode.key
        return (
          <motion.button
            key={mode.key}
            onClick={() => onChange(mode.key)}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className={`min-h-[44px] px-5 rounded-lg font-bold text-sm transition-all duration-200 ${
              isActive
                ? `${mode.activeColor} text-white shadow-lg ${mode.activeShadow} scale-105 ring-2 ${mode.activeRing}`
                : 'bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {mode.icon} {mode.label}
          </motion.button>
        )
      })}
    </div>
  )
}

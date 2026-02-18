'use client'

import { motion } from 'framer-motion'

interface ModeToggleProps {
  currentMode: 'bar' | 'food'
  onModeChange: (mode: 'bar' | 'food') => void
  disabled?: boolean
}

export function ModeToggle({ currentMode, onModeChange, disabled = false }: ModeToggleProps) {
  return (
    <div className="relative flex bg-white/40 backdrop-blur-lg rounded-2xl p-1.5 select-none border border-white/30 shadow-lg shadow-black/5">
      {/* Animated background slider with gradient */}
      <motion.div
        className={`absolute top-1.5 bottom-1.5 rounded-xl ${
          currentMode === 'bar'
            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/30'
            : 'bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/30'
        }`}
        initial={false}
        animate={{
          left: currentMode === 'bar' ? '6px' : '50%',
          right: currentMode === 'bar' ? '50%' : '6px',
        }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 35,
        }}
      />

      {/* Bar Button */}
      <motion.button
        type="button"
        onClick={() => !disabled && onModeChange('bar')}
        disabled={disabled}
        className={`relative z-10 flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 ${
          currentMode === 'bar'
            ? 'text-white drop-shadow-md'
            : 'text-gray-600 hover:text-gray-900'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        whileHover={!disabled && currentMode !== 'bar' ? { scale: 1.02 } : {}}
        whileTap={!disabled ? { scale: 0.98 } : {}}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        BAR
      </motion.button>

      {/* Food Button */}
      <motion.button
        type="button"
        onClick={() => !disabled && onModeChange('food')}
        disabled={disabled}
        className={`relative z-10 flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 ${
          currentMode === 'food'
            ? 'text-white drop-shadow-md'
            : 'text-gray-600 hover:text-gray-900'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        whileHover={!disabled && currentMode !== 'food' ? { scale: 1.02 } : {}}
        whileTap={!disabled ? { scale: 0.98 } : {}}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        FOOD
      </motion.button>
    </div>
  )
}

// Mini version for mobile/compact layouts
export function ModeToggleMini({ currentMode, onModeChange, disabled = false }: ModeToggleProps) {
  return (
    <div className="flex">
      <button
        type="button"
        onClick={() => !disabled && onModeChange('bar')}
        disabled={disabled}
        className={`px-3 py-2 text-sm font-bold rounded-l-md border transition-colors min-h-[44px] ${
          currentMode === 'bar'
            ? 'bg-blue-500 text-white border-blue-500'
            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        BAR
      </button>
      <button
        type="button"
        onClick={() => !disabled && onModeChange('food')}
        disabled={disabled}
        className={`px-3 py-2 text-sm font-bold rounded-r-md border-t border-r border-b transition-colors min-h-[44px] ${
          currentMode === 'food'
            ? 'bg-orange-500 text-white border-orange-500'
            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        FOOD
      </button>
    </div>
  )
}

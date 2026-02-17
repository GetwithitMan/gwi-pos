'use client'

import { useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  QWERTY_ROWS,
  SYMBOL_ROWS,
  NUMERIC_ROWS,
  PHONE_ROWS,
  type KeyDef,
} from './keyboard-layouts'

interface OnScreenKeyboardProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  mode?: 'qwerty' | 'numeric' | 'phone'
  theme?: 'dark' | 'light'
  maxLength?: number
  submitLabel?: string
  className?: string
}

export function OnScreenKeyboard({
  value,
  onChange,
  onSubmit,
  mode = 'qwerty',
  theme = 'dark',
  maxLength,
  submitLabel = 'Done',
  className = '',
}: OnScreenKeyboardProps) {
  const [isShifted, setIsShifted] = useState(true) // Start shifted for first letter capitalization
  const [isCapsLock, setIsCapsLock] = useState(false)
  const [showSymbols, setShowSymbols] = useState(false)
  const lastShiftTapRef = useRef(0)

  const isDark = theme === 'dark'

  // Theme classes
  const containerCls = isDark
    ? 'bg-slate-800/95 border border-white/10 rounded-xl'
    : 'bg-gray-100 border border-gray-200 rounded-xl'

  const keyCls = isDark
    ? 'bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white border border-white/5'
    : 'bg-white hover:bg-gray-50 active:bg-gray-200 text-gray-900 border border-gray-200 shadow-sm'

  const specialKeyCls = isDark
    ? 'bg-slate-600 hover:bg-slate-500 active:bg-slate-400 text-slate-200 border border-white/5'
    : 'bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-600 border border-gray-300'

  const enterKeyCls = isDark
    ? 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-400 text-white border border-indigo-500/30'
    : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white border border-blue-400/30'

  const shiftActiveCls = isDark
    ? 'bg-indigo-600 text-white border-indigo-500/30'
    : 'bg-blue-500 text-white border-blue-400/30'

  const handleKeyPress = useCallback((key: KeyDef) => {
    switch (key.type) {
      case 'char': {
        if (maxLength && value.length >= maxLength) return
        const char = key.type === 'char' && (isShifted || isCapsLock) && key.shiftLabel
          ? key.shiftLabel
          : key.label
        onChange(value + char)
        // Auto-unshift after typing (unless caps lock)
        if (isShifted && !isCapsLock) {
          setIsShifted(false)
        }
        break
      }
      case 'backspace':
        onChange(value.slice(0, -1))
        break
      case 'space':
        if (maxLength && value.length >= maxLength) return
        onChange(value + ' ')
        break
      case 'enter':
        onSubmit?.()
        break
      case 'shift': {
        const now = Date.now()
        if (now - lastShiftTapRef.current < 400) {
          // Double tap = caps lock
          setIsCapsLock(!isCapsLock)
          setIsShifted(true)
        } else {
          if (isCapsLock) {
            setIsCapsLock(false)
            setIsShifted(false)
          } else {
            setIsShifted(!isShifted)
          }
        }
        lastShiftTapRef.current = now
        break
      }
      case 'mode-toggle':
        setShowSymbols(!showSymbols)
        break
    }
  }, [value, onChange, onSubmit, isShifted, isCapsLock, showSymbols, maxLength])

  // Pick the right layout
  let rows: KeyDef[][]
  if (mode === 'numeric') {
    rows = NUMERIC_ROWS
  } else if (mode === 'phone') {
    rows = PHONE_ROWS
  } else {
    rows = showSymbols ? SYMBOL_ROWS : QWERTY_ROWS
  }

  const isNumericMode = mode === 'numeric' || mode === 'phone'

  const getKeyClassName = (key: KeyDef) => {
    if (key.type === 'enter') return enterKeyCls
    if (key.type === 'shift') {
      return (isShifted || isCapsLock) ? shiftActiveCls : specialKeyCls
    }
    if (key.type === 'backspace' || key.type === 'mode-toggle') return specialKeyCls
    return keyCls
  }

  const getKeyLabel = (key: KeyDef) => {
    if (key.type === 'enter') return submitLabel
    if (key.type === 'char' && key.shiftLabel && (isShifted || isCapsLock)) {
      return key.shiftLabel
    }
    if (key.type === 'shift' && isCapsLock) return '⇪'
    return key.label
  }

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className={`p-2 ${containerCls} ${className}`}
    >
      <div className={`flex flex-col ${isNumericMode ? 'gap-2' : 'gap-1.5'}`}>
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className={`flex gap-1.5 ${
              // Center the middle rows for QWERTY (row 1 has 9 keys)
              !isNumericMode && rowIdx === 1 ? 'px-[5%]' : ''
            }`}
          >
            {row.map((key, keyIdx) => (
              <motion.button
                key={`${rowIdx}-${keyIdx}`}
                type="button"
                whileTap={{ scale: 0.93 }}
                onClick={() => handleKeyPress(key)}
                className={`
                  ${getKeyClassName(key)}
                  ${isNumericMode ? 'min-h-[64px] text-2xl' : 'min-h-[52px] text-lg'}
                  rounded-lg font-medium select-none transition-colors
                  flex items-center justify-center
                  ${key.type === 'space' ? 'text-sm text-opacity-50' : ''}
                `}
                style={{ flex: key.flex || 1 }}
              >
                {key.type === 'backspace' ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
                    />
                  </svg>
                ) : key.type === 'space' ? (
                  <span className={isDark ? 'text-slate-500' : 'text-gray-400'}>space</span>
                ) : (
                  getKeyLabel(key)
                )}
              </motion.button>
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

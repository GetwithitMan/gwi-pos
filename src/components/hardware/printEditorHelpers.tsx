'use client'

import { useState } from 'react'

// Collapsible Section
export function Section({
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
export function DividerSelector({
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
export function OptionButtons({
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
export function Toggle({
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

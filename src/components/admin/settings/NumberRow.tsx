export function NumberRow({
  label,
  description,
  value,
  onChange,
  prefix,
  suffix,
  min,
  max,
  step,
}: {
  label: string
  description: string
  value: number
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-700">{label}</div>
        <div className="text-xs text-gray-400">{description}</div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {prefix && <span className="text-gray-500 text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="w-24 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label={label}
        />
        {suffix && <span className="text-gray-500 text-sm">{suffix}</span>}
      </div>
    </div>
  )
}

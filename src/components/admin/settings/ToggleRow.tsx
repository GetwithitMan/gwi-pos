import { ToggleSwitch } from './ToggleSwitch'

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  border,
  disabled,
  disabledNote,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  border?: boolean
  disabled?: boolean
  disabledNote?: string
}) {
  return (
    <div className={`flex items-center justify-between py-3 ${border ? 'border-t border-gray-100' : ''} ${disabled ? 'opacity-60' : ''}`}>
      <div>
        <div className="text-sm text-gray-700">{label}</div>
        <div className="text-xs text-gray-400">{description}</div>
        {disabled && disabledNote && (
          <div className="text-xs text-amber-600 mt-0.5">{disabledNote}</div>
        )}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

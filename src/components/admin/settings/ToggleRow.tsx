import { ToggleSwitch } from './ToggleSwitch'

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  border,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  border?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-3 ${border ? 'border-t border-gray-100' : ''}`}>
      <div>
        <div className="text-sm text-gray-700">{label}</div>
        <div className="text-xs text-gray-400">{description}</div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  )
}

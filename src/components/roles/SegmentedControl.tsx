'use client'
// Generic segmented control — 2-5 equally-spaced buttons in a pill container.
// Used for Role Type (FOH/BOH/ADMIN) and Access Level (Staff/Manager/Owner-Admin).

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; color?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: SegmentedControlProps<T>) {
  const sizeClasses = size === 'sm' ? 'text-xs py-1 px-2' : 'text-sm py-1.5 px-3'

  return (
    <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-0.5">
      {options.map((opt) => {
        const isActive = opt.value === value

        let activeColorClasses = 'bg-white shadow-sm font-medium text-gray-900'
        if (isActive && opt.color === 'blue') {
          activeColorClasses = 'bg-white shadow-sm font-medium text-blue-700'
        } else if (isActive && opt.color === 'green') {
          activeColorClasses = 'bg-white shadow-sm font-medium text-green-700'
        } else if (isActive && opt.color === 'purple') {
          activeColorClasses = 'bg-white shadow-sm font-medium text-purple-700'
        }

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-md text-center cursor-pointer transition-all duration-150 ${sizeClasses} ${
              isActive
                ? activeColorClasses
                : 'text-gray-900 hover:text-gray-900'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

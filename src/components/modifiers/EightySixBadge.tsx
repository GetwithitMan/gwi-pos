'use client'

interface EightySixBadgeProps {
  size?: 'sm' | 'md'
  className?: string
}

export function EightySixBadge({ size = 'sm', className = '' }: EightySixBadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'text-[9px] px-1 py-0.5'
    : 'text-xs px-1.5 py-0.5'

  return (
    <span
      className={`absolute -top-1 -right-1 bg-red-500/80 text-white font-bold rounded-full ${sizeClasses} ${className}`}
      style={{
        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }}
    >
      86
    </span>
  )
}

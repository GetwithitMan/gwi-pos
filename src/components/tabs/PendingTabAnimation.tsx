'use client'

interface PendingTabAnimationProps {
  variant: 'shimmer' | 'pulse' | 'spinner'
  status: 'pending_auth' | 'approved' | 'declined'
  cardType?: string
  cardLast4?: string
  cardholderName?: string
}

/**
 * Animated overlay for tabs with pending card authorization.
 * Three animation variants, selected by bartender in personalization settings.
 * Shows different states: pending (animating), approved (green check), declined (red X).
 */
export function PendingTabAnimation({
  variant,
  status,
  cardType,
  cardLast4,
  cardholderName,
}: PendingTabAnimationProps) {
  if (status === 'approved') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium animate-fade-in">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <span>Approved</span>
      </div>
    )
  }

  if (status === 'declined') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium animate-fade-in">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span>Declined</span>
      </div>
    )
  }

  // Pending state — show chosen animation variant
  if (variant === 'shimmer') {
    return (
      <div className="relative overflow-hidden rounded-lg">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
        <div className="flex items-center gap-1.5 text-xs text-blue-500">
          <CardIcon />
          <span className="opacity-70">
            {cardholderName || `${cardType || 'Card'} ...${cardLast4 || '****'}`}
          </span>
        </div>
      </div>
    )
  }

  if (variant === 'pulse') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-500">
        <div className="animate-pulse">
          <CardIcon />
        </div>
        <span className="animate-pulse">Authorizing...</span>
      </div>
    )
  }

  // spinner variant
  return (
    <div className="flex items-center gap-1.5 text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded">
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>Authorizing...</span>
    </div>
  )
}

function CardIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  )
}

'use client'

/**
 * OrderStatusTracker — Visual progress bar for online order status.
 *
 * Steps: Received -> Preparing -> Ready -> Complete
 * Maps order statuses to steps, shows active/completed/pending states.
 */

interface OrderStatusTrackerProps {
  status: string
  estimatedReadyTime: string | null
}

const STEPS = [
  { key: 'received', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'complete', label: 'Complete' },
] as const

function mapStatusToStepIndex(status: string): number {
  switch (status) {
    case 'received':
      return 0
    case 'open':
    case 'in_progress':
    case 'sent':
      return 1
    case 'completed':
      return 3
    case 'voided':
    case 'canceled':
      return -1 // error state
    default:
      return 0
  }
}

function formatEstimatedTime(iso: string): string {
  const date = new Date(iso)
  const now = Date.now()
  const diffMs = date.getTime() - now

  if (diffMs <= 0) return 'Any moment now'

  const minutes = Math.ceil(diffMs / 60000)
  if (minutes <= 1) return '~1 min'
  if (minutes < 60) return `~${minutes} min`

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) return `~${hours} hr`
  return `~${hours} hr ${mins} min`
}

export function OrderStatusTracker({ status, estimatedReadyTime }: OrderStatusTrackerProps) {
  const activeIndex = mapStatusToStepIndex(status)
  const isError = activeIndex === -1
  const isComplete = activeIndex >= STEPS.length - 1

  // Error state (voided/canceled)
  if (isError) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-5">
        <div className="flex items-center gap-3 justify-center">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <span className="text-red-700 font-semibold text-base">
            {status === 'voided' ? 'Order Voided' : 'Order Canceled'}
          </span>
        </div>
        <p className="text-red-600 text-sm text-center mt-2">
          Please contact the restaurant if you have questions.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Progress bar */}
      <div className="flex items-start justify-between relative px-2">
        {/* Background connector line */}
        <div className="absolute top-4 left-8 right-8 h-0.5 bg-gray-200" />
        {/* Active connector line */}
        <div
          className="absolute top-4 left-8 h-0.5 transition-all duration-700 ease-out"
          style={{
            width: isComplete
              ? 'calc(100% - 64px)'
              : `calc(${(activeIndex / (STEPS.length - 1)) * 100}% - ${activeIndex === 0 ? 0 : 32}px)`,
            backgroundColor: 'var(--site-primary, #2563eb)',
          }}
        />

        {STEPS.map((step, i) => {
          const isStepComplete = i < activeIndex || isComplete
          const isCurrent = i === activeIndex && !isComplete
          const isPending = i > activeIndex && !isComplete

          return (
            <div key={step.key} className="flex flex-col items-center relative z-10" style={{ flex: 1 }}>
              {/* Circle indicator */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isStepComplete
                    ? 'shadow-sm'
                    : isCurrent
                    ? 'ring-4 shadow-sm'
                    : 'bg-gray-100 border-2 border-gray-300'
                }`}
                style={{
                  ...(isStepComplete ? { backgroundColor: 'var(--site-primary, #2563eb)' } : {}),
                  ...(isCurrent
                    ? {
                        backgroundColor: 'var(--site-primary, #2563eb)',
                        ringColor: 'var(--site-primary-light, rgba(37, 99, 235, 0.2))',
                      }
                    : {}),
                }}
              >
                {isStepComplete && (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isCurrent && (
                  <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse" />
                )}
              </div>

              {/* Label */}
              <span
                className={`text-xs mt-2 text-center leading-tight font-medium ${
                  isStepComplete || isCurrent ? 'text-gray-900' : 'text-gray-400'
                }`}
                style={{ maxWidth: '72px' }}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Estimated time below active step (only while in progress) */}
      {estimatedReadyTime && !isComplete && (
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-500">Estimated ready</p>
          <p className="text-lg font-bold text-gray-900">
            {formatEstimatedTime(estimatedReadyTime)}
          </p>
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * OrderStatusTracker — Visual progress bar for online order status.
 *
 * Steps: Received -> Preparing -> Complete
 * Maps order statuses to steps, shows active/completed/pending states.
 */

interface OrderStatusTrackerProps {
  status: string
  estimatedReadyTime: string | null
  orderType?: string
}

const PICKUP_STEPS = [
  { key: 'received', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'complete', label: 'Ready' },
] as const

const DELIVERY_STEPS = [
  { key: 'received', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'dispatched', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
] as const

function mapPickupStatusToStep(status: string): number {
  switch (status) {
    case 'received':
    case 'pending':
    case 'confirmed':
      return 0
    case 'open':
    case 'in_progress':
    case 'sent':
    case 'preparing':
      return 1
    case 'completed':
    case 'ready':
      return 2
    case 'voided':
    case 'canceled':
      return -1
    default:
      return 0
  }
}

function mapDeliveryStatusToStep(status: string): number {
  switch (status) {
    case 'received':
    case 'pending':
    case 'confirmed':
      return 0
    case 'open':
    case 'in_progress':
    case 'sent':
    case 'preparing':
      return 1
    case 'dispatched':
    case 'en_route':
      return 2
    case 'delivered':
    case 'completed':
      return 3
    case 'voided':
    case 'canceled':
      return -1
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

export function OrderStatusTracker({ status, estimatedReadyTime, orderType }: OrderStatusTrackerProps) {
  const isDelivery = orderType === 'delivery'
  const STEPS = isDelivery ? DELIVERY_STEPS : PICKUP_STEPS
  const activeIndex = isDelivery ? mapDeliveryStatusToStep(status) : mapPickupStatusToStep(status)
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
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-surface)' }}>
      {/* Progress bar */}
      <div className="flex items-start justify-between relative px-2">
        {/* Background connector line */}
        <div className="absolute top-4 left-8 right-8 h-0.5" style={{ backgroundColor: 'var(--site-border)' }} />
        {/* Active connector line */}
        <div
          className="absolute top-4 left-8 h-0.5 transition-all duration-700 ease-out"
          style={{
            width: isComplete
              ? 'calc(100% - 64px)'
              : `calc(${(activeIndex / (STEPS.length - 1)) * 100}% - ${activeIndex === 0 ? 0 : 32}px)`,
            backgroundColor: 'var(--site-brand)',
          }}
        />

        {STEPS.map((step, i) => {
          const isStepComplete = i < activeIndex || isComplete
          const isCurrent = i === activeIndex && !isComplete

          return (
            <div key={step.key} className="flex flex-col items-center relative z-10" style={{ flex: 1 }}>
              {/* Circle indicator */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isStepComplete
                    ? 'shadow-sm'
                    : isCurrent
                    ? 'shadow-sm'
                    : 'border-2'
                }`}
                style={{
                  ...(isStepComplete ? { backgroundColor: 'var(--site-brand)' } : {}),
                  ...(isCurrent
                    ? {
                        backgroundColor: 'var(--site-brand)',
                        boxShadow: '0 0 0 4px var(--site-primary-light)',
                      }
                    : {}),
                  ...(!isStepComplete && !isCurrent
                    ? { backgroundColor: 'var(--site-bg-secondary)', borderColor: 'var(--site-border)' }
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
                className="text-xs mt-2 text-center leading-tight font-medium"
                style={{
                  maxWidth: '72px',
                  color: isStepComplete || isCurrent ? 'var(--site-text)' : 'var(--site-text-muted)',
                }}
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
          <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>Estimated ready</p>
          <p className="text-lg font-bold" style={{ color: 'var(--site-text)' }}>
            {formatEstimatedTime(estimatedReadyTime)}
          </p>
        </div>
      )}
    </div>
  )
}

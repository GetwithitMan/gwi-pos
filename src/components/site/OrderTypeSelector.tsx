'use client'

/**
 * OrderTypeSelector — Pickup / Delivery toggle for checkout.
 *
 * Phase C: Pickup only. Delivery shown as "Coming soon" when not enabled.
 */

interface OrderTypeSelectorProps {
  value: 'pickup' | 'delivery' | 'dine_in'
  onChange: (type: 'pickup' | 'delivery' | 'dine_in') => void
  venueAddress: string | null
  prepTime: number // minutes
  canPlaceDeliveryOrder: boolean
  isDineIn?: boolean // QR table context present
}

export function OrderTypeSelector({
  value,
  onChange,
  venueAddress,
  prepTime,
  canPlaceDeliveryOrder,
  isDineIn,
}: OrderTypeSelectorProps) {
  // If QR dine-in mode, show locked dine-in indicator
  if (isDineIn) {
    return (
      <div
        className="rounded-xl p-4 border"
        style={{
          borderColor: 'var(--site-brand)',
          backgroundColor: 'rgba(var(--site-brand-rgb), 0.05)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-full"
            style={{ backgroundColor: 'var(--site-brand)', color: 'var(--site-brand-text)' }}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--site-text)' }}>
              Dine-In Order
            </p>
            <p className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
              Your order will be brought to your table
            </p>
          </div>
        </div>
      </div>
    )
  }

  const options: Array<{
    type: 'pickup' | 'delivery'
    label: string
    icon: React.ReactNode
    detail: string
    enabled: boolean
  }> = [
    {
      type: 'pickup',
      label: 'Pickup',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      ),
      detail: prepTime > 0 ? `Ready in ~${prepTime} min` : 'Ready for pickup',
      enabled: true,
    },
    {
      type: 'delivery',
      label: 'Delivery',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0H6.375c-.621 0-1.125-.504-1.125-1.125V14.25m0 0V5.625m0 8.625h7.5M3.375 5.625h16.5" />
        </svg>
      ),
      detail: canPlaceDeliveryOrder ? 'Delivered to your door' : 'Coming soon',
      enabled: canPlaceDeliveryOrder,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isSelected = value === opt.type
          return (
            <button
              key={opt.type}
              onClick={() => opt.enabled && onChange(opt.type)}
              disabled={!opt.enabled}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                !opt.enabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
              }`}
              style={{
                borderColor: isSelected ? 'var(--site-brand)' : 'var(--site-border)',
                backgroundColor: isSelected ? 'rgba(var(--site-brand-rgb), 0.05)' : 'transparent',
                color: isSelected ? 'var(--site-brand)' : 'var(--site-text)',
              }}
            >
              {opt.icon}
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
                {opt.detail}
              </span>
            </button>
          )
        })}
      </div>

      {/* Venue address for pickup */}
      {value === 'pickup' && venueAddress && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs"
          style={{
            backgroundColor: 'var(--site-surface)',
            color: 'var(--site-text-muted)',
          }}
        >
          <svg className="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
          <span>{venueAddress}</span>
        </div>
      )}
    </div>
  )
}

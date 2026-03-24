import { Suspense } from 'react'
import { OrderStatusClient } from './client'

export default function OrderStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-8 h-8 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--site-brand)', borderTopColor: 'transparent' }}
            />
            <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
              Loading order status...
            </p>
          </div>
        </div>
      }
    >
      <OrderStatusClient />
    </Suspense>
  )
}

'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { FloorPlanHomeV2 } from '@/components/floor-plan'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import type { MenuItem, PizzaOrderConfig } from '@/types'

/**
 * Test page for Floor Plan V2.
 * Route: /floor-plan-v2
 *
 * Features:
 * - Clean store-based architecture
 * - Multi-select tables (shift/ctrl + click)
 * - Virtual group toolbar (Link Tables, Add/Remove/Dissolve)
 * - Order panel with menu selection
 * - Server-side geometry (no math in React)
 */
export default function FloorPlanV2Page() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/floor-plan-v2')
    }
  }, [isAuthenticated, router])

  // Payment modal handler
  const handleOpenPayment = useCallback((orderId: string) => {
    // TODO: Integrate with actual PaymentModal
    alert(`Payment modal would open for order: ${orderId}`)
    console.log('Open payment for order:', orderId)
  }, [])

  // Modifier modal handler
  const handleOpenModifiers = useCallback((
    item: MenuItem,
    onComplete: (modifiers: { id: string; name: string; price: number }[]) => void
  ) => {
    // TODO: Integrate with actual ModifierModal
    console.log('Open modifiers for item:', item.name)

    // For testing, simulate selecting a modifier after a short delay
    const confirmAdd = window.confirm(
      `Add "${item.name}" with modifiers?\n\n(In production, this opens the modifier selection modal)`
    )

    if (confirmAdd) {
      // Simulate adding item with no modifiers for now
      onComplete([])
    }
  }, [])

  // Timed rental handler
  const handleOpenTimedRental = useCallback((
    item: MenuItem,
    onComplete: (price: number, blockMinutes: number) => void
  ) => {
    // TODO: Integrate with actual TimedRentalModal
    console.log('Open timed rental for item:', item.name)

    const confirmAdd = window.confirm(
      `Start timer for "${item.name}"?\n\nDefault: 60 minutes at $${item.price}\n\n(In production, this opens duration/rate selection)`
    )

    if (confirmAdd) {
      // Default 60 minutes at item price
      onComplete(item.price, 60)
    }
  }, [])

  // Pizza builder handler
  const handleOpenPizzaBuilder = useCallback((
    item: MenuItem,
    onComplete: (config: PizzaOrderConfig) => void
  ) => {
    // TODO: Integrate with actual PizzaBuilder
    console.log('Open pizza builder for item:', item.name)
    alert(`Pizza builder would open for: ${item.name}`)
  }, [])

  if (!isAuthenticated || !employee?.location?.id) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-4 border-b border-slate-700">
        <AdminPageHeader
          title="Floor Plan V2 (Test)"
          subtitle={`${employee.location.name} - Testing new architecture`}
        />
        <div className="mt-2 text-sm text-slate-400">
          <span className="inline-block px-2 py-1 bg-cyan-900/50 text-cyan-300 rounded mr-2">
            Click
          </span>
          Open order panel
          <span className="inline-block px-2 py-1 bg-cyan-900/50 text-cyan-300 rounded mx-2 ml-4">
            Shift+Click
          </span>
          Multi-select for linking
        </div>
      </div>

      <div className="h-[calc(100vh-120px)]">
        <FloorPlanHomeV2
          locationId={employee.location.id}
          employeeId={employee.id}
          mode="admin"
          onOpenPayment={handleOpenPayment}
          onOpenModifiers={handleOpenModifiers}
          onOpenTimedRental={handleOpenTimedRental}
          onOpenPizzaBuilder={handleOpenPizzaBuilder}
        />
      </div>
    </div>
  )
}

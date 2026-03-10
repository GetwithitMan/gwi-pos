'use client'

import { useContext } from 'react'
import { ManagerPinContext } from '@/components/providers/ManagerPinProvider'
import type { ManagerPinContextValue } from '@/components/providers/ManagerPinProvider'

/**
 * Hook for requesting manager PIN elevation.
 *
 * Must be used within a <ManagerPinProvider>.
 *
 * Usage:
 *   const { requireManagerPin } = useManagerPin()
 *
 *   const handleVoid = async () => {
 *     const result = await requireManagerPin('void_order', 'Authorize void of Order #1234')
 *     if (!result.authorized) return
 *     // proceed with void, result.employeeId is the approving manager
 *   }
 */
export function useManagerPin(): ManagerPinContextValue {
  const context = useContext(ManagerPinContext)

  if (!context) {
    throw new Error(
      'useManagerPin must be used within a <ManagerPinProvider>. ' +
        'Ensure ManagerPinProvider wraps your component tree (usually in the root layout).'
    )
  }

  return context
}

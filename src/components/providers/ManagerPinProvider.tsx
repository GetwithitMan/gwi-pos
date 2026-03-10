'use client'

import { createContext, useCallback, useRef, useState } from 'react'
import { ManagerPinElevationModal } from '@/components/ui/manager-pin-modal'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ManagerPinResult {
  authorized: boolean
  employeeId?: string
  employeeName?: string
}

export interface ManagerPinContextValue {
  /**
   * Opens the Manager PIN modal and returns a promise that resolves
   * when the manager authorizes or the modal is dismissed.
   *
   * @param action - Permission action key (e.g., 'void_order')
   * @param actionLabel - Human-readable description shown in the modal
   *                      (e.g., 'Authorize void of Order #1234')
   */
  requireManagerPin: (
    action: string,
    actionLabel: string
  ) => Promise<ManagerPinResult>
}

export const ManagerPinContext = createContext<ManagerPinContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

interface PendingRequest {
  action: string
  actionLabel: string
  resolve: (result: ManagerPinResult) => void
}

export function ManagerPinProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const pendingRef = useRef<PendingRequest | null>(null)

  const requireManagerPin = useCallback(
    (action: string, actionLabel: string): Promise<ManagerPinResult> => {
      return new Promise<ManagerPinResult>((resolve) => {
        // If a request is already in flight, reject it silently
        if (pendingRef.current) {
          pendingRef.current.resolve({ authorized: false })
        }

        pendingRef.current = { action, actionLabel, resolve }
        setIsOpen(true)
      })
    },
    []
  )

  const handleAuthorized = useCallback(
    (employeeId: string, employeeName: string) => {
      if (pendingRef.current) {
        pendingRef.current.resolve({
          authorized: true,
          employeeId,
          employeeName,
        })
        pendingRef.current = null
      }
      setIsOpen(false)
    },
    []
  )

  const handleClose = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve({ authorized: false })
      pendingRef.current = null
    }
    setIsOpen(false)
  }, [])

  return (
    <ManagerPinContext.Provider value={{ requireManagerPin }}>
      {children}
      <ManagerPinElevationModal
        isOpen={isOpen}
        onClose={handleClose}
        onAuthorized={handleAuthorized}
        action={pendingRef.current?.action ?? ''}
        actionLabel={pendingRef.current?.actionLabel ?? ''}
      />
    </ManagerPinContext.Provider>
  )
}

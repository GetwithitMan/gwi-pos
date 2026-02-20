'use client'

import { useRef, useCallback, useState } from 'react'
import { toast } from '@/stores/toast-store'

/**
 * Reusable action lock hook — prevents double-tap on critical buttons.
 *
 * Uses a ref for synchronous guard (prevents multi-tap before React re-renders)
 * plus state for UI updates (disabling buttons).
 *
 * Usage:
 *   const [isLocked, lockAndExecute] = useActionLock('pay-order')
 *
 *   <button disabled={isLocked} onClick={() => lockAndExecute(async () => { ... })}>
 *     {isLocked ? 'Processing...' : 'Pay'}
 *   </button>
 */
export function useActionLock(
  key: string,
  options?: { timeoutMs?: number; toastMessage?: string }
): [/** isLocked */ boolean, /** lockAndExecute */ (fn: () => Promise<void>) => void] {
  const lockedRef = useRef(false)
  const [isLocked, setIsLocked] = useState(false)

  const lockAndExecute = useCallback((fn: () => Promise<void>) => {
    // Ref guard: catches rapid taps before React re-renders
    if (lockedRef.current) {
      toast.warning(options?.toastMessage || 'Action in progress')
      return
    }

    lockedRef.current = true
    setIsLocked(true)

    const timeout = options?.timeoutMs ?? 10000
    const timer = setTimeout(() => {
      lockedRef.current = false
      setIsLocked(false)
    }, timeout)

    fn()
      .catch((err) => {
        console.error(`[useActionLock:${key}]`, err)
      })
      .finally(() => {
        clearTimeout(timer)
        lockedRef.current = false
        setIsLocked(false)
      })
  }, [key, options?.timeoutMs, options?.toastMessage])

  return [isLocked, lockAndExecute]
}

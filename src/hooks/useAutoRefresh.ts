'use client'

import { useEffect, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { clientLog } from '@/lib/client-logger'

/**
 * Listens for system:update-required and auto-refreshes when the client is idle.
 * Active payment/order flows defer the refresh until completion.
 *
 * @param isActive - true if the user is in an active payment or order flow
 */
export function useAutoRefresh(isActive: boolean = false) {
  const pendingRefresh = useRef(false)

  useEffect(() => {
    const socket = getSharedSocket()

    const onUpdateRequired = (data: { version: string }) => {
      clientLog.info('[AutoRefresh] Server updated to', data.version)

      if (!isActive) {
        // Idle — refresh immediately (small delay for UX)
        clientLog.info('[AutoRefresh] Client idle — refreshing in 2s')
        setTimeout(() => window.location.reload(), 2000)
      } else {
        // Active flow — defer until isActive becomes false
        clientLog.info('[AutoRefresh] Active flow detected — deferring refresh')
        pendingRefresh.current = true
      }
    }

    socket.on('system:update-required', onUpdateRequired)

    return () => {
      socket.off('system:update-required', onUpdateRequired)
      releaseSharedSocket()
    }
  }, []) // Only bind once

  // When active flow completes, check if refresh is pending
  useEffect(() => {
    if (!isActive && pendingRefresh.current) {
      clientLog.info('[AutoRefresh] Active flow ended — executing deferred refresh')
      pendingRefresh.current = false
      setTimeout(() => window.location.reload(), 1000)
    }
  }, [isActive])
}

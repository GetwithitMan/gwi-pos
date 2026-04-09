'use client'

import { useEffect } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import { toast } from '@/stores/toast-store'

/**
 * Listens for 'tab:manager-alert' socket events and shows them as toasts.
 * Mounted in the root layout so every POS terminal receives the alert.
 *
 * Emitted by: socket-server.ts relay of MOBILE_EVENTS.TAB_ALERT_MANAGER
 * Triggered when: A phone employee taps "Alert Manager" on a tab
 */
export function ManagerAlertListener() {
  useEffect(() => {
    const socket = getSharedSocket()

    const onManagerAlert = (data: {
      orderId: string
      employeeId: string
      locationId?: string
    }) => {
      toast.warning(
        `Manager attention requested (Order ${data.orderId?.slice(-6) || 'unknown'})`,
        8000
      )
    }

    socket.on(SOCKET_EVENTS.TAB_MANAGER_ALERT, onManagerAlert)

    return () => {
      socket.off(SOCKET_EVENTS.TAB_MANAGER_ALERT, onManagerAlert)
      releaseSharedSocket()
    }
  }, [])

  return null
}

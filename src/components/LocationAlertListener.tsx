'use client'

import { useEffect } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { toast } from '@/stores/toast-store'

/**
 * Listens for 'location:alert' socket events and shows them as toasts.
 * Mounted in the root layout so every POS/KDS/admin page gets alerts.
 *
 * Emitted by: dispatchLocationAlert() in socket-dispatch.ts
 * Called from: health-check route (critical system failures)
 */
export function LocationAlertListener() {
  useEffect(() => {
    const socket = getSharedSocket()

    const onAlert = (data: {
      type: 'info' | 'warning' | 'error' | 'success'
      title: string
      message: string
      dismissable?: boolean
      duration?: number
    }) => {
      const msg = data.title ? `${data.title}: ${data.message}` : data.message
      toast[data.type](msg, data.duration)
    }

    socket.on('location:alert', onAlert)

    return () => {
      socket.off('location:alert', onAlert)
      releaseSharedSocket()
    }
  }, [])

  return null
}

'use client'

import { useEffect } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { SOCKET_EVENTS } from '@/lib/socket-events'

/**
 * Listens for 'system:reload' socket events and reloads the page.
 * Mounted in the root layout so every POS/KDS/admin page gets it.
 */
export function SystemReloadListener() {
  useEffect(() => {
    const socket = getSharedSocket()

    const onReload = () => {
      window.location.reload()
    }

    socket.on(SOCKET_EVENTS.SYSTEM_RELOAD, onReload)

    return () => {
      socket.off(SOCKET_EVENTS.SYSTEM_RELOAD, onReload)
      releaseSharedSocket()
    }
  }, [])

  return null
}

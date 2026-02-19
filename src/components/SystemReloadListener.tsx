'use client'

import { useEffect } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

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

    socket.on('system:reload', onReload)

    return () => {
      socket.off('system:reload', onReload)
      releaseSharedSocket()
    }
  }, [])

  return null
}

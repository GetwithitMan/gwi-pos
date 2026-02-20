'use client'

import { useEffect, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'

/**
 * Emits order:editing when this terminal opens an order,
 * and order:editing-released when it navigates away / unmounts.
 *
 * Also emits on socket reconnect so other terminals stay aware.
 */
export function useOrderEditing(orderId: string | null, locationId: string | null) {
  const emittedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!orderId || !locationId) return

    const socket = getSharedSocket()
    const terminalId = getTerminalId()
    const terminalName = terminalId // Use terminal ID as name; could be enriched later

    const emitEditing = () => {
      socket.emit('order:editing', { orderId, terminalId, terminalName, locationId })
    }

    emitEditing()
    emittedRef.current = orderId

    // Re-announce on reconnect
    socket.on('connect', emitEditing)

    return () => {
      socket.off('connect', emitEditing)
      socket.emit('order:editing-released', { orderId, terminalId, locationId })
      emittedRef.current = null
      releaseSharedSocket()
    }
  }, [orderId, locationId])
}

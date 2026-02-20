'use client'

import { useEffect, useState, useCallback } from 'react'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'

interface EditingInfo {
  orderId: string
  terminalId: string
  terminalName: string
}

/**
 * Shows a banner when another terminal is editing the same order.
 * Listens for `order:editing` and `order:editing-released` socket events.
 */
export function ConflictBanner({ orderId }: { orderId: string }) {
  const [editingTerminals, setEditingTerminals] = useState<Map<string, string>>(new Map())
  const myTerminalId = getTerminalId()

  const handleEditing = useCallback((data: EditingInfo) => {
    if (data.orderId !== orderId) return
    if (data.terminalId === myTerminalId) return
    setEditingTerminals(prev => {
      const next = new Map(prev)
      next.set(data.terminalId, data.terminalName)
      return next
    })
  }, [orderId, myTerminalId])

  const handleEditingReleased = useCallback((data: { orderId: string; terminalId: string }) => {
    if (data.orderId !== orderId) return
    setEditingTerminals(prev => {
      const next = new Map(prev)
      next.delete(data.terminalId)
      return next
    })
  }, [orderId])

  useEffect(() => {
    const socket = getSharedSocket()
    socket.on('order:editing', handleEditing)
    socket.on('order:editing-released', handleEditingReleased)
    return () => {
      socket.off('order:editing', handleEditing)
      socket.off('order:editing-released', handleEditingReleased)
      releaseSharedSocket()
    }
  }, [handleEditing, handleEditingReleased])

  if (editingTerminals.size === 0) return null

  const names = Array.from(editingTerminals.values())
  const label = names.length === 1
    ? `Also open on ${names[0]}`
    : `Also open on ${names.length} other terminals`

  return (
    <div className="bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs px-3 py-1.5 rounded-md flex items-center gap-2">
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <span>{label}. Changes may conflict.</span>
    </div>
  )
}

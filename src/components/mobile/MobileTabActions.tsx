'use client'

import { useState, useEffect, useCallback } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { MOBILE_EVENTS } from '@/types/multi-surface'
import type { TabClosedEvent, TabStatusUpdateEvent } from '@/types/multi-surface'

interface MobileTabActionsProps {
  tabId: string
  employeeId: string
  onTabClosed?: (data: TabClosedEvent) => void
  onStatusUpdate?: (data: TabStatusUpdateEvent) => void
}

export default function MobileTabActions({ tabId, employeeId, onTabClosed, onStatusUpdate }: MobileTabActionsProps) {
  const [actionState, setActionState] = useState<'idle' | 'confirming' | 'processing'>('idle')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  // Wire socket listeners for tab responses from terminal
  useEffect(() => {
    const socket = getSharedSocket()

    const onClosed = (data: TabClosedEvent) => {
      if (data.orderId !== tabId) return
      setActionState('idle')
      setPendingAction(null)
      if (data.success) {
        setResultMessage('Tab closed successfully')
      } else {
        setResultMessage(data.error || 'Failed to close tab')
      }
      setTimeout(() => setResultMessage(null), 3000)
      onTabClosed?.(data)
    }

    const onStatusChange = (data: TabStatusUpdateEvent) => {
      if (data.orderId !== tabId) return
      onStatusUpdate?.(data)
    }

    socket.on(MOBILE_EVENTS.TAB_CLOSED, onClosed)
    socket.on(MOBILE_EVENTS.TAB_STATUS_UPDATE, onStatusChange)

    return () => {
      socket.off(MOBILE_EVENTS.TAB_CLOSED, onClosed)
      socket.off(MOBILE_EVENTS.TAB_STATUS_UPDATE, onStatusChange)
      releaseSharedSocket()
    }
  }, [tabId, onTabClosed, onStatusUpdate])

  const handleAction = (action: string) => {
    setPendingAction(action)
    setActionState('confirming')
  }

  const emitToSocket = useCallback((event: string, data: unknown) => {
    const socket = getSharedSocket()
    socket.emit(event, data)
    releaseSharedSocket()
  }, [])

  const confirmAction = async () => {
    if (!pendingAction) return
    setActionState('processing')

    try {
      switch (pendingAction) {
        case 'close_device_tip':
          emitToSocket(MOBILE_EVENTS.TAB_CLOSE_REQUEST, {
            orderId: tabId,
            tipMode: 'device',
            employeeId,
          })
          break
        case 'close_receipt_tip':
          emitToSocket(MOBILE_EVENTS.TAB_CLOSE_REQUEST, {
            orderId: tabId,
            tipMode: 'receipt',
            employeeId,
          })
          break
        case 'transfer':
          emitToSocket(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, {
            orderId: tabId,
            employeeId,
          })
          break
        case 'alert_manager':
          emitToSocket(MOBILE_EVENTS.TAB_ALERT_MANAGER, {
            orderId: tabId,
            employeeId,
          })
          // Alert is fire-and-forget, reset immediately
          setTimeout(() => {
            setActionState('idle')
            setPendingAction(null)
          }, 1000)
          return
      }
    } catch {
      setActionState('idle')
      setPendingAction(null)
      setResultMessage('Action failed')
      setTimeout(() => setResultMessage(null), 3000)
    }
  }

  const cancelAction = () => {
    setActionState('idle')
    setPendingAction(null)
  }

  if (resultMessage) {
    return (
      <div className="p-4 border-t border-white/10 flex items-center justify-center">
        <span className="text-white/60 text-sm">{resultMessage}</span>
      </div>
    )
  }

  if (actionState === 'processing') {
    return (
      <div className="p-4 border-t border-white/10 flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-white/60">Processing...</span>
      </div>
    )
  }

  if (actionState === 'confirming') {
    const actionLabels: Record<string, string> = {
      close_device_tip: 'Close Tab (Device Tip)',
      close_receipt_tip: 'Close Tab (Receipt Tip)',
      transfer: 'Transfer Tab',
      alert_manager: 'Alert Manager',
    }

    return (
      <div className="p-4 border-t border-white/10 space-y-3">
        <p className="text-white/60 text-sm text-center">
          Confirm: {actionLabels[pendingAction || '']}?
        </p>
        <div className="flex gap-3">
          <button
            onClick={cancelAction}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white/60 font-medium hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmAction}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border-t border-white/10">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => handleAction('close_device_tip')}
          className="py-3 rounded-xl bg-emerald-500/20 text-emerald-400 font-medium text-sm hover:bg-emerald-500/30 transition-colors"
        >
          Close (Device Tip)
        </button>
        <button
          onClick={() => handleAction('close_receipt_tip')}
          className="py-3 rounded-xl bg-blue-500/20 text-blue-400 font-medium text-sm hover:bg-blue-500/30 transition-colors"
        >
          Close (Receipt)
        </button>
        <button
          onClick={() => handleAction('transfer')}
          className="py-3 rounded-xl bg-white/10 text-white/60 font-medium text-sm hover:bg-white/20 transition-colors"
        >
          Transfer Tab
        </button>
        <button
          onClick={() => handleAction('alert_manager')}
          className="py-3 rounded-xl bg-amber-500/10 text-amber-400 font-medium text-sm hover:bg-amber-500/20 transition-colors"
        >
          Alert Manager
        </button>
      </div>
    </div>
  )
}

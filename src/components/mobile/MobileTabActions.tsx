'use client'

import { useState } from 'react'
import { MOBILE_EVENTS } from '@/types/multi-surface'

interface MobileTabActionsProps {
  tabId: string
  employeeId: string
}

export default function MobileTabActions({ tabId, employeeId }: MobileTabActionsProps) {
  const [actionState, setActionState] = useState<'idle' | 'confirming' | 'processing'>('idle')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const handleAction = (action: string) => {
    setPendingAction(action)
    setActionState('confirming')
  }

  const confirmAction = async () => {
    if (!pendingAction) return
    setActionState('processing')

    // These will emit socket events to the terminal
    // For now, log the intent
    console.log(`[Mobile] Action: ${pendingAction} Tab=${tabId} Employee=${employeeId}`)
    console.log(`[Mobile] Would emit: ${MOBILE_EVENTS.TAB_CLOSE_REQUEST}`)

    // Simulate socket event
    try {
      switch (pendingAction) {
        case 'close_device_tip':
          // Emit tab:close-request with tipMode=device to terminal
          // Terminal activates reader for capture with tip prompt
          break
        case 'close_receipt_tip':
          // Emit tab:close-request with tipMode=receipt to terminal
          // Terminal captures without tip, prints receipt
          break
        case 'transfer':
          // Emit tab:transfer-request
          break
        case 'alert_manager':
          // Emit tab:alert-manager
          break
      }
    } catch {
      // Error handling
    }

    // Reset after brief delay
    setTimeout(() => {
      setActionState('idle')
      setPendingAction(null)
    }, 2000)
  }

  const cancelAction = () => {
    setActionState('idle')
    setPendingAction(null)
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

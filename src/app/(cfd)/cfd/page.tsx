'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import CFDIdleScreen from '@/components/cfd/CFDIdleScreen'
import CFDOrderDisplay from '@/components/cfd/CFDOrderDisplay'
import CFDTipScreen from '@/components/cfd/CFDTipScreen'
import CFDSignatureScreen from '@/components/cfd/CFDSignatureScreen'
import CFDApprovedScreen from '@/components/cfd/CFDApprovedScreen'
import type {
  CFDScreenState,
  CFDShowOrderEvent,
  CFDTipPromptEvent,
  CFDSignatureRequestEvent,
  CFDApprovedEvent,
  CFDDeclinedEvent,
} from '@/types/multi-surface'
import { CFD_EVENTS } from '@/types/multi-surface'

export default function CFDPage() {
  const searchParams = useSearchParams()
  const terminalId = searchParams.get('terminalId')

  const [screenState, setScreenState] = useState<CFDScreenState>('idle')
  const [orderData, setOrderData] = useState<CFDShowOrderEvent | null>(null)
  const [tipData, setTipData] = useState<CFDTipPromptEvent | null>(null)
  const [signatureData, setSignatureData] = useState<CFDSignatureRequestEvent | null>(null)
  const [approvedData, setApprovedData] = useState<CFDApprovedEvent | null>(null)
  const [declineReason, setDeclineReason] = useState<string>('')
  const [socket, setSocket] = useState<WebSocket | null>(null)

  // Connect to socket room for this terminal
  useEffect(() => {
    if (!terminalId) return

    // Socket.io connection will be wired when socket infrastructure is in place
    // For now, this page renders all screen states for development/preview
    console.log(`[CFD] Connecting to terminal: ${terminalId}`)

    return () => {
      socket?.close()
    }
  }, [terminalId, socket])

  // Handle incoming events (will be wired to Socket.io)
  const handleSocketEvent = useCallback((event: string, data: unknown) => {
    switch (event) {
      case CFD_EVENTS.SHOW_ORDER:
        setOrderData(data as CFDShowOrderEvent)
        setScreenState('order')
        break
      case CFD_EVENTS.PAYMENT_STARTED:
        setScreenState('payment')
        break
      case CFD_EVENTS.TIP_PROMPT:
        setTipData(data as CFDTipPromptEvent)
        setScreenState('tip')
        break
      case CFD_EVENTS.SIGNATURE_REQUEST:
        setSignatureData(data as CFDSignatureRequestEvent)
        setScreenState('signature')
        break
      case CFD_EVENTS.PROCESSING:
        setScreenState('processing')
        break
      case CFD_EVENTS.APPROVED:
        setApprovedData(data as CFDApprovedEvent)
        setScreenState('approved')
        break
      case CFD_EVENTS.DECLINED:
        setDeclineReason((data as CFDDeclinedEvent).reason)
        setScreenState('declined')
        break
      case CFD_EVENTS.IDLE:
        setScreenState('idle')
        break
    }
  }, [])

  // Send event back to POS terminal
  const emitEvent = useCallback((event: string, data: unknown) => {
    // Will be wired to Socket.io
    console.log(`[CFD] Emit: ${event}`, data)
  }, [])

  const handleTipSelected = (amount: number, isPercent: boolean) => {
    emitEvent(CFD_EVENTS.TIP_SELECTED, { amount, isPercent })
    setScreenState('processing')
  }

  const handleSignatureDone = (signatureBase64: string) => {
    emitEvent(CFD_EVENTS.SIGNATURE_DONE, { signatureData: signatureBase64 })
    setScreenState('processing')
  }

  const handleReceiptChoice = (method: 'email' | 'text' | 'print' | 'none', contact?: string) => {
    emitEvent(CFD_EVENTS.RECEIPT_CHOICE, { method, contact })
    setScreenState('idle')
  }

  // Auto-return to idle after approved/declined screens
  useEffect(() => {
    if (screenState === 'approved' || screenState === 'declined') {
      const timer = setTimeout(() => setScreenState('idle'), 10000)
      return () => clearTimeout(timer)
    }
  }, [screenState])

  // Render current screen
  switch (screenState) {
    case 'idle':
      return <CFDIdleScreen />

    case 'order':
      return <CFDOrderDisplay data={orderData} />

    case 'payment':
    case 'processing':
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-6">
          <div className="w-20 h-20 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-2xl text-white/80">
            {screenState === 'payment' ? 'Please tap or insert card' : 'Processing payment...'}
          </p>
        </div>
      )

    case 'tip':
      return (
        <CFDTipScreen
          data={tipData}
          onTipSelected={handleTipSelected}
        />
      )

    case 'signature':
      return (
        <CFDSignatureScreen
          data={signatureData}
          onSignatureDone={handleSignatureDone}
        />
      )

    case 'approved':
      return (
        <CFDApprovedScreen
          data={approvedData}
          onReceiptChoice={handleReceiptChoice}
        />
      )

    case 'declined':
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-6">
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-2xl text-red-400">Card Declined</p>
          <p className="text-lg text-white/50">{declineReason || 'Please try another card'}</p>
        </div>
      )

    default:
      return <CFDIdleScreen />
  }
}

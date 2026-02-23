'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import CFDIdleScreen from '@/components/cfd/CFDIdleScreen'
import CFDOrderDisplay from '@/components/cfd/CFDOrderDisplay'
import CFDTipScreen from '@/components/cfd/CFDTipScreen'
import CFDSignatureScreen from '@/components/cfd/CFDSignatureScreen'
import CFDApprovedScreen from '@/components/cfd/CFDApprovedScreen'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
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
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <CFDContent />
    </Suspense>
  )
}

function CFDContent() {
  const searchParams = useSearchParams()
  const terminalId = searchParams.get('terminalId')

  const [screenState, setScreenState] = useState<CFDScreenState>('idle')
  const [orderData, setOrderData] = useState<CFDShowOrderEvent | null>(null)
  const [tipData, setTipData] = useState<CFDTipPromptEvent | null>(null)
  const [signatureData, setSignatureData] = useState<CFDSignatureRequestEvent | null>(null)
  const [approvedData, setApprovedData] = useState<CFDApprovedEvent | null>(null)
  const [declineReason, setDeclineReason] = useState<string>('')
  const [disconnected, setDisconnected] = useState(false)
  const socketRef = useRef<ReturnType<typeof getSharedSocket> | null>(null)

  // Connect to socket and wire CFD events
  useEffect(() => {
    if (!terminalId) return

    const socket = getSharedSocket()
    socketRef.current = socket

    // Join CFD room for this terminal
    if (socket.connected) {
      socket.emit('join', `cfd:${terminalId}`)
    }
    const onConnect = () => {
      socket.emit('join', `cfd:${terminalId}`)
      setDisconnected(false)
    }
    const onDisconnect = () => {
      setDisconnected(true)
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    // POS → CFD event handlers
    const onShowOrder = (data: CFDShowOrderEvent) => {
      setOrderData(data)
      setScreenState('order')
    }
    const onPaymentStarted = () => setScreenState('payment')
    const onTipPrompt = (data: CFDTipPromptEvent) => {
      setTipData(data)
      setScreenState('tip')
    }
    const onSignatureRequest = (data: CFDSignatureRequestEvent) => {
      setSignatureData(data)
      setScreenState('signature')
    }
    const onProcessing = () => setScreenState('processing')
    const onApproved = (data: CFDApprovedEvent) => {
      setApprovedData(data)
      setScreenState('approved')
    }
    const onDeclined = (data: CFDDeclinedEvent) => {
      setDeclineReason(data.reason)
      setScreenState('declined')
    }
    const onIdle = () => setScreenState('idle')

    socket.on(CFD_EVENTS.SHOW_ORDER, onShowOrder)
    socket.on(CFD_EVENTS.PAYMENT_STARTED, onPaymentStarted)
    socket.on(CFD_EVENTS.TIP_PROMPT, onTipPrompt)
    socket.on(CFD_EVENTS.SIGNATURE_REQUEST, onSignatureRequest)
    socket.on(CFD_EVENTS.PROCESSING, onProcessing)
    socket.on(CFD_EVENTS.APPROVED, onApproved)
    socket.on(CFD_EVENTS.DECLINED, onDeclined)
    socket.on(CFD_EVENTS.IDLE, onIdle)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off(CFD_EVENTS.SHOW_ORDER, onShowOrder)
      socket.off(CFD_EVENTS.PAYMENT_STARTED, onPaymentStarted)
      socket.off(CFD_EVENTS.TIP_PROMPT, onTipPrompt)
      socket.off(CFD_EVENTS.SIGNATURE_REQUEST, onSignatureRequest)
      socket.off(CFD_EVENTS.PROCESSING, onProcessing)
      socket.off(CFD_EVENTS.APPROVED, onApproved)
      socket.off(CFD_EVENTS.DECLINED, onDeclined)
      socket.off(CFD_EVENTS.IDLE, onIdle)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [terminalId])

  // Send event back to POS terminal
  const emitEvent = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data)
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

  // Disconnect overlay — shown when socket drops during an active screen
  // Note: POS-side timeout handles the case where CFD disconnects mid-tip-selection
  // so the POS doesn't hang forever waiting for a tip response.
  const disconnectOverlay = disconnected && screenState !== 'idle' && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-2xl text-yellow-400">Connection Lost</p>
        <p className="text-white/50 text-lg mt-2">Reconnecting...</p>
      </div>
    </div>
  )

  // Render current screen with disconnect overlay
  const renderScreen = () => {
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

  return (
    <>
      {disconnectOverlay}
      {renderScreen()}
    </>
  )
}

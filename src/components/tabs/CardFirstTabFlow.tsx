'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'

interface CardFirstTabFlowProps {
  orderId: string | null   // null while the order shell is being created in background
  readerId: string
  employeeId: string
  onComplete: (result: TabOpenResult) => void
  onCancel: () => void
}

interface TabOpenResult {
  approved: boolean
  tabStatus: string
  cardholderName?: string
  cardType?: string
  cardLast4?: string
  authAmount?: number
  recordNo?: string
  orderCardId?: string
  existingTab?: {
    orderId: string
    tabName: string
    tabNumber: number
    authAmount: number
    brand: string
    last4: string
  }
  error?: { code: string; message: string; isRetryable: boolean }
}

/**
 * Card-First Tab Open Flow component.
 *
 * Flow:
 * 1. Auto-starts on mount — fires CollectCardData + EMVPreAuth
 * 2. On success: tab auto-populates with cardholder name
 * 3. On decline: alerts bartender, allows retry with different card
 */
export function CardFirstTabFlow({
  orderId,
  readerId,
  employeeId,
  onComplete,
  onCancel,
}: CardFirstTabFlowProps) {
  const [status, setStatus] = useState<'preparing' | 'reading' | 'authorizing' | 'done' | 'error' | 'existing_tab_found'>(
    orderId ? 'reading' : 'preparing'
  )
  const [cardInfo, setCardInfo] = useState<{ name?: string; type?: string; last4?: string }>({})
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [existingTabInfo, setExistingTabInfo] = useState<TabOpenResult['existingTab'] | null>(null)
  const startedRef = useRef(false)

  const startFlow = useCallback(async () => {
    if (!orderId) return   // shouldn't happen but guard against stale closure
    setStatus('reading')
    setErrorMessage('')

    try {
      const response = await fetch(`/api/orders/${orderId}/open-tab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readerId, employeeId }),
      })

      const result = await response.json()

      if (!response.ok) {
        setStatus('error')
        setErrorMessage(result.error || 'Failed to open tab')
        toast.error(result.error || 'Failed to open tab')
        return
      }

      const data = result.data as TabOpenResult

      // Existing tab found — show re-entry UI
      if (data.tabStatus === 'existing_tab_found' && data.existingTab) {
        setExistingTabInfo(data.existingTab)
        setStatus('existing_tab_found')
        return
      }

      setCardInfo({
        name: data.cardholderName,
        type: data.cardType,
        last4: data.cardLast4,
      })

      if (data.approved) {
        setStatus('done')
        onComplete(data)
      } else {
        setStatus('error')
        const msg = data.error?.message || 'Card declined'
        setErrorMessage(msg)
        toast.error(msg)
      }
    } catch (err) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : 'Connection error'
      setErrorMessage(msg)
      toast.error(msg)
    }
  }, [orderId, readerId, employeeId, onComplete])

  const handleDifferentCard = useCallback(() => {
    startedRef.current = false
    setExistingTabInfo(null)
    startFlow()
  }, [startFlow])

  // Auto-start once orderId is available (handles both instant-mount and deferred cases)
  useEffect(() => {
    if (!orderId) return          // still waiting for shell creation
    if (startedRef.current) return  // already started
    startedRef.current = true
    startFlow()
  }, [orderId, startFlow])

  return (
    <div className="flex flex-col items-center gap-4 p-6">{/* intentional — no 'ready' state, auto-starts */}

      {status === 'preparing' && (
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-slate-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white">Preparing Tab…</h3>
          <p className="text-sm text-gray-500 mt-1">Setting up card reader</p>
          <Button variant="ghost" className="mt-3" onClick={onCancel}>Cancel</Button>
        </div>
      )}

      {status === 'reading' && (
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Authorizing Card...</h3>
          <p className="text-sm text-gray-500 mt-1">
            Processing pre-authorization hold
          </p>
          <Button variant="ghost" className="mt-3" onClick={onCancel}>Cancel</Button>
        </div>
      )}

      {status === 'authorizing' && (
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-yellow-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-yellow-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Authorizing...</h3>
          {cardInfo.name && (
            <p className="text-sm text-gray-600 mt-1 font-medium">{cardInfo.name}</p>
          )}
          <p className="text-sm text-gray-500 mt-1">
            {cardInfo.type && cardInfo.last4 ? `${cardInfo.type} ...${cardInfo.last4}` : 'Processing card'}
          </p>
        </div>
      )}

      {status === 'done' && (
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-green-700">Tab Opened</h3>
          {cardInfo.name && (
            <p className="text-sm font-medium mt-1">{cardInfo.name}</p>
          )}
          {cardInfo.type && cardInfo.last4 && (
            <p className="text-xs text-gray-500">{cardInfo.type} ...{cardInfo.last4}</p>
          )}
        </div>
      )}

      {status === 'error' && (
        <>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-red-700">Card Declined</h3>
            <p className="text-sm text-gray-500 mt-1">{errorMessage}</p>
            {cardInfo.type && cardInfo.last4 && (
              <p className="text-xs text-gray-400 mt-1">{cardInfo.type} ...{cardInfo.last4}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={startFlow}>
              Try Another Card
            </Button>
          </div>
        </>
      )}

      {status === 'existing_tab_found' && existingTabInfo && (
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-blue-950 border border-blue-700 flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white">Tab Already Open</h3>
          <p className="text-sm text-gray-400 mt-1">This card has an existing tab</p>
          <div className="mt-3 px-3 py-2.5 rounded-xl text-left"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.35)' }}>
            <p className="text-blue-200 font-semibold">{existingTabInfo.tabName}</p>
            <p className="text-blue-300 text-sm font-mono">
              {existingTabInfo.brand} &bull;&bull;&bull;&bull; {existingTabInfo.last4}
              {' · $'}{existingTabInfo.authAmount.toFixed(0)} hold
            </p>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleDifferentCard}
              className="flex-1 py-3 rounded-xl text-gray-300 font-semibold"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              Different Card
            </button>
            <button
              onClick={() => onComplete({ approved: false, tabStatus: 'existing_tab_found', existingTab: existingTabInfo })}
              className="flex-1 py-3 rounded-xl text-white font-semibold"
              style={{ background: 'rgba(59,130,246,0.8)' }}
            >
              Open Tab
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

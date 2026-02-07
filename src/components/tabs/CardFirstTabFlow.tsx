'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'

interface CardFirstTabFlowProps {
  orderId: string
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
  error?: { code: string; message: string; isRetryable: boolean }
}

/**
 * Card-First Tab Open Flow component.
 *
 * Flow:
 * 1. UI shows "Please tap or insert card" instruction
 * 2. CollectCardData fires → reads cardholder name from chip
 * 3. EMVPreAuth fires for configurable hold amount
 * 4. On success: tab auto-populates with cardholder name
 * 5. On decline: alerts bartender, allows retry with different card
 */
export function CardFirstTabFlow({
  orderId,
  readerId,
  employeeId,
  onComplete,
  onCancel,
}: CardFirstTabFlowProps) {
  const [status, setStatus] = useState<'ready' | 'reading' | 'authorizing' | 'done' | 'error'>('ready')
  const [cardInfo, setCardInfo] = useState<{ name?: string; type?: string; last4?: string }>({})
  const [errorMessage, setErrorMessage] = useState<string>('')

  const startFlow = useCallback(async () => {
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

      setCardInfo({
        name: data.cardholderName,
        type: data.cardType,
        last4: data.cardLast4,
      })

      if (data.approved) {
        setStatus('done')
        toast.success(`Tab opened for ${data.cardholderName || `Card ...${data.cardLast4}`}`)
        onComplete(data)
      } else {
        setStatus('error')
        const msg = data.error?.message || 'Card declined'
        setErrorMessage(msg)
        toast.error(msg)
        onComplete(data)
      }
    } catch (err) {
      setStatus('error')
      const msg = err instanceof Error ? err.message : 'Connection error'
      setErrorMessage(msg)
      toast.error(msg)
    }
  }, [orderId, readerId, employeeId, onComplete])

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      {/* Status display */}
      {status === 'ready' && (
        <>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold">Open Tab with Card</h3>
            <p className="text-sm text-gray-500 mt-1">
              Customer taps or inserts card to start tab
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={startFlow}>
              Activate Reader
            </Button>
          </div>
        </>
      )}

      {status === 'reading' && (
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Waiting for Card...</h3>
          <p className="text-sm text-gray-500 mt-1">
            Please tap or insert card on the reader
          </p>
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
    </div>
  )
}

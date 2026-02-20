'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TablePayment from '@/components/pay-at-table/TablePayment'
import SplitSelector from '@/components/pay-at-table/SplitSelector'
import TipScreen from '@/components/pay-at-table/TipScreen'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { PAT_EVENTS } from '@/types/multi-surface'
import type { PayAtTableResultEvent } from '@/types/multi-surface'

type PayState = 'loading' | 'summary' | 'split' | 'tip' | 'processing' | 'done' | 'error'

interface OrderSummary {
  id: string
  orderNumber: number
  items: Array<{
    name: string
    quantity: number
    price: number
    modifiers?: string[]
  }>
  subtotal: number
  tax: number
  total: number
  tabName?: string
}

export default function PayAtTablePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <PayAtTableContent />
    </Suspense>
  )
}

function PayAtTableContent() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get('orderId')
  const readerId = searchParams.get('readerId')
  const employeeId = searchParams.get('employeeId')

  const [state, setState] = useState<PayState>('loading')
  const [order, setOrder] = useState<OrderSummary | null>(null)
  const [splitCount, setSplitCount] = useState(1)
  const [currentSplit, setCurrentSplit] = useState(0)
  const [tipAmount, setTipAmount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const socketRef = useRef<ReturnType<typeof getSharedSocket> | null>(null)
  const accumulatedTipRef = useRef(0)

  // Wire socket for real-time payment sync with POS terminal
  useEffect(() => {
    if (!orderId) return

    const socket = getSharedSocket()
    socketRef.current = socket

    const onPayResult = (data: PayAtTableResultEvent) => {
      if (data.orderId !== orderId) return

      if (data.success) {
        // If more splits to process
        if (currentSplit + 1 < splitCount) {
          accumulatedTipRef.current += tipAmount
          setCurrentSplit(prev => prev + 1)
          setTipAmount(0)
          setState('tip')
        } else {
          const finalTip = accumulatedTipRef.current + tipAmount
          // Notify POS terminals that payment is complete (fire-and-forget)
          if (orderId && employeeId) {
            fetch(`/api/orders/${orderId}/pat-complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                employeeId,
                totalPaid: (order?.total ?? 0) + finalTip,
                tipAmount: finalTip,
              }),
            }).catch(console.error)
          }
          setState('done')
        }
      } else {
        setError(data.error || 'Payment declined')
        setState('error')
      }
    }

    socket.on(PAT_EVENTS.PAY_RESULT, onPayResult)

    return () => {
      socket.off(PAT_EVENTS.PAY_RESULT, onPayResult)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [orderId, currentSplit, splitCount, tipAmount, order, employeeId])

  // Load order on mount
  useEffect(() => {
    if (!orderId) {
      setError('No order ID provided')
      setState('error')
      return
    }

    fetch(`/api/orders/${orderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error)
          setState('error')
          return
        }

        setOrder({
          id: data.id || orderId,
          orderNumber: data.orderNumber,
          items: (data.items || []).map((item: { name: string; quantity: number; price: number; modifiers?: Array<{ name: string }> }) => ({
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price),
            modifiers: item.modifiers?.map((m: { name: string }) => m.name),
          })),
          subtotal: Number(data.subtotal),
          tax: Number(data.taxTotal),
          total: Number(data.total),
          tabName: data.tabName,
        })
        setState('summary')
      })
      .catch(() => {
        setError('Failed to load order')
        setState('error')
      })
  }, [orderId])

  const handleSplitSelected = (count: number) => {
    setSplitCount(count)
    setCurrentSplit(0)
    accumulatedTipRef.current = 0
    setState('tip')
  }

  const handleTipSelected = (amount: number) => {
    setTipAmount(amount)
    processPayment(amount)
  }

  const processPayment = async (tip: number) => {
    if (!orderId || !readerId || !employeeId || !order) return

    setState('processing')

    // Notify POS terminal that pay-at-table payment is in progress
    socketRef.current?.emit(PAT_EVENTS.PAY_REQUEST, {
      orderId,
      readerId,
      tipMode: tip > 0 ? 'device' : 'screen',
      employeeId,
    })

    try {
      const splitAmount = splitCount > 1
        ? Math.round((order.total / splitCount) * 100) / 100
        : order.total

      const res = await fetch(`/api/datacap/sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: '', // Will be resolved from reader
          readerId,
          invoiceNo: `${orderId}-${currentSplit + 1}`,
          amount: splitAmount + tip,
          tipAmount: tip,
          tipMode: 'included',
          employeeId,
        }),
      })

      const json = await res.json()

      if (!res.ok || !json.data?.approved) {
        setError(json.data?.error?.message || 'Payment declined')
        setState('error')
        return
      }

      // Accumulate tip across all splits
      accumulatedTipRef.current += tip

      // If more splits to process
      if (currentSplit + 1 < splitCount) {
        setCurrentSplit(prev => prev + 1)
        setTipAmount(0)
        setState('tip')
      } else {
        // Notify POS terminals that payment is complete (fire-and-forget)
        fetch(`/api/orders/${orderId}/pat-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId,
            totalPaid: order.total + accumulatedTipRef.current,
            tipAmount: accumulatedTipRef.current,
          }),
        }).catch(console.error)

        setState('done')
      }
    } catch {
      setError('Payment processing failed')
      setState('error')
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="w-12 h-12 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 p-8 gap-4">
        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <p className="text-red-400 text-lg">{error}</p>
        <button
          onClick={() => setState('summary')}
          className="px-6 py-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (state === 'done') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 p-8 gap-4">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl text-white">Payment Complete</h2>
        <p className="text-white/50">
          {splitCount > 1 ? `All ${splitCount} payments processed` : 'Thank you!'}
        </p>
      </div>
    )
  }

  if (state === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 gap-4">
        <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-white/60 text-lg">Processing payment...</p>
        {splitCount > 1 && (
          <p className="text-white/40">Payment {currentSplit + 1} of {splitCount}</p>
        )}
      </div>
    )
  }

  if (state === 'split') {
    return (
      <SplitSelector
        total={order?.total || 0}
        onSplitSelected={handleSplitSelected}
        onCancel={() => setState('summary')}
      />
    )
  }

  if (state === 'tip') {
    const splitAmount = splitCount > 1
      ? Math.round(((order?.total || 0) / splitCount) * 100) / 100
      : order?.total || 0

    return (
      <TipScreen
        amount={splitAmount}
        splitLabel={splitCount > 1 ? `Payment ${currentSplit + 1} of ${splitCount}` : undefined}
        onTipSelected={handleTipSelected}
      />
    )
  }

  // Summary state (default)
  return (
    <TablePayment
      order={order}
      onPay={() => setState('tip')}
      onSplit={() => setState('split')}
    />
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface ApprovalData {
  id: string
  serverName: string
  managerName: string
  itemName: string
  amount: number
  voidReason: string
  voidType: string
  orderNumber: number
  tableName: string | null
  requestedAt: string
  expiresAt: string
}

type PageState = 'loading' | 'pending' | 'approved' | 'rejected' | 'expired' | 'error' | 'already_processed'

export default function ApproveVoidPage() {
  const params = useParams()
  const token = params.token as string

  const [state, setState] = useState<PageState>('loading')
  const [approval, setApproval] = useState<ApprovalData | null>(null)
  const [approvalCode, setApprovalCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [copied, setCopied] = useState(false)

  // Fetch approval data on mount
  useEffect(() => {
    fetchApprovalData()
  }, [token])

  // Countdown timer
  useEffect(() => {
    if (!approval || state !== 'pending') return

    const expiresAt = new Date(approval.expiresAt)

    const interval = setInterval(() => {
      const now = new Date()
      const diff = expiresAt.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeLeft('Expired')
        setState('expired')
        clearInterval(interval)
      } else {
        const minutes = Math.floor(diff / 60000)
        const seconds = Math.floor((diff % 60000) / 1000)
        setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [approval, state])

  const fetchApprovalData = async () => {
    try {
      const response = await fetch(`/api/voids/remote-approval/${token}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to load approval request')
        setState('error')
        return
      }

      if (!data.data.valid) {
        if (data.data.expired) {
          setState('expired')
        } else if (data.data.status === 'approved') {
          // Already approved - show the code if available
          if (data.data.approvalCode) {
            setApprovalCode(data.data.approvalCode)
          }
          setState('already_processed')
          setError('This request has already been approved')
        } else if (data.data.status === 'rejected') {
          setState('already_processed')
          setError('This request has been rejected')
        } else if (data.data.status === 'used') {
          setState('already_processed')
          setError('This approval code has already been used')
        } else {
          setError(data.data.message || 'Invalid request')
          setState('error')
        }
        return
      }

      setApproval(data.data.approval)
      setState('pending')
    } catch (err) {
      setError('Failed to load approval request')
      setState('error')
    }
  }

  const handleApprove = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/voids/remote-approval/${token}/approve`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve')
      }

      setApprovalCode(data.data.approvalCode)
      setState('approved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/voids/remote-approval/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject')
      }

      setState('rejected')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setIsProcessing(false)
    }
  }

  const copyCode = () => {
    if (approvalCode) {
      navigator.clipboard.writeText(approvalCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <div className="mx-auto max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">GWI POS</h1>
          <p className="text-gray-400">Void Approval Request</p>
        </div>

        {/* Loading State */}
        {state === 'loading' && (
          <div className="rounded-xl bg-slate-800 p-8 text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="mt-4 text-gray-400">Loading...</p>
          </div>
        )}

        {/* Error State */}
        {(state === 'error' || state === 'already_processed') && (
          <div className="rounded-xl bg-slate-800 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-600/20">
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-lg text-red-400">{error}</p>
            {approvalCode && (
              <div className="mt-4">
                <p className="text-gray-400 text-sm">Approval code (if still valid):</p>
                <p className="text-2xl font-mono text-green-400">{approvalCode}</p>
              </div>
            )}
          </div>
        )}

        {/* Expired State */}
        {state === 'expired' && (
          <div className="rounded-xl bg-slate-800 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-600/20">
              <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-lg text-amber-400">This request has expired</p>
            <p className="mt-2 text-gray-400">The server will need to submit a new request.</p>
          </div>
        )}

        {/* Pending State - Show Approval Details */}
        {state === 'pending' && approval && (
          <div className="space-y-4">
            {/* Request Details Card */}
            <div className="rounded-xl bg-slate-800 p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full bg-amber-600/20 px-3 py-1 text-sm text-amber-400">
                  Pending Approval
                </span>
                <span className="text-lg font-mono text-amber-400">{timeLeft}</span>
              </div>

              <div className="space-y-3">
                <div>
                  <span className="text-sm text-gray-400">Server</span>
                  <p className="text-lg text-white">{approval.serverName}</p>
                </div>

                <div>
                  <span className="text-sm text-gray-400">Item</span>
                  <p className="text-lg text-white">{approval.itemName}</p>
                </div>

                <div>
                  <span className="text-sm text-gray-400">Amount</span>
                  <p className="text-2xl font-bold text-amber-400">
                    ${approval.amount.toFixed(2)}
                  </p>
                </div>

                <div>
                  <span className="text-sm text-gray-400">Reason</span>
                  <p className="text-white">{approval.voidReason}</p>
                </div>

                <div className="flex gap-4">
                  <div>
                    <span className="text-sm text-gray-400">Order</span>
                    <p className="text-white">#{approval.orderNumber}</p>
                  </div>
                  {approval.tableName && (
                    <div>
                      <span className="text-sm text-gray-400">Table</span>
                      <p className="text-white">{approval.tableName}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="rounded-xl bg-red-900/30 p-4 text-center text-red-300">
                {error}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={handleApprove}
                disabled={isProcessing}
                className="w-full rounded-xl bg-green-600 py-5 text-xl font-bold text-white transition active:bg-green-700 disabled:opacity-50"
              >
                {isProcessing ? 'Processing...' : 'APPROVE'}
              </button>

              <button
                onClick={handleReject}
                disabled={isProcessing}
                className="w-full rounded-xl bg-red-600 py-5 text-xl font-bold text-white transition active:bg-red-700 disabled:opacity-50"
              >
                {isProcessing ? 'Processing...' : 'REJECT'}
              </button>
            </div>
          </div>
        )}

        {/* Approved State - Show Code */}
        {state === 'approved' && approvalCode && (
          <div className="rounded-xl bg-slate-800 p-8 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-600">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-green-400">Approved!</h2>

            <div className="my-6">
              <p className="text-gray-400">Give this code to {approval?.serverName}:</p>
              <button
                onClick={copyCode}
                className="mt-2 rounded-lg bg-slate-700 px-8 py-4 transition hover:bg-slate-600 active:bg-slate-500"
              >
                <span className="text-4xl font-mono font-bold tracking-widest text-white">
                  {approvalCode}
                </span>
              </button>
              <p className="mt-2 text-sm text-gray-400">
                {copied ? 'Copied!' : 'Tap to copy'}
              </p>
            </div>

            <div className="rounded-lg bg-amber-900/30 p-3">
              <p className="text-amber-400">
                <strong>Valid for 5 minutes</strong>
              </p>
            </div>
          </div>
        )}

        {/* Rejected State */}
        {state === 'rejected' && (
          <div className="rounded-xl bg-slate-800 p-8 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-red-600">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-red-400">Rejected</h2>
            <p className="mt-2 text-gray-400">
              The void request has been rejected.<br />
              {approval?.serverName} has been notified.
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-gray-500">
          Secure void approval system
        </p>
      </div>
    </div>
  )
}

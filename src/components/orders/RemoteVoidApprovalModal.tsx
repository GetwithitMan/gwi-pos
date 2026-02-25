'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { useSocket } from '@/hooks/useSocket'

interface Manager {
  id: string
  name: string
  phoneMasked: string
  roleName: string
}

interface RemoteVoidApprovalModalProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
  orderId: string
  orderItemId?: string
  itemName: string
  amount: number
  voidType: 'item' | 'order' | 'comp'
  employeeId: string
  terminalId?: string
  onSuccess: (approvalData: {
    approvalId: string
    managerId: string
    managerName: string
  }) => void
}

type ModalState = 'select_manager' | 'enter_reason' | 'pending' | 'enter_code' | 'success' | 'error'

export function RemoteVoidApprovalModal({
  isOpen,
  onClose,
  locationId,
  orderId,
  orderItemId,
  itemName,
  amount,
  voidType,
  employeeId,
  terminalId,
  onSuccess,
}: RemoteVoidApprovalModalProps) {
  const [state, setState] = useState<ModalState>('select_manager')
  const [managers, setManagers] = useState<Manager[]>([])
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null)
  const [reason, setReason] = useState('')
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const [approvalCode, setApprovalCode] = useState('')
  const [enteredCode, setEnteredCode] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [timeLeft, setTimeLeft] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Fetch managers on mount
  useEffect(() => {
    if (isOpen) {
      fetchManagers()
    }
  }, [isOpen, locationId])

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return

    const interval = setInterval(() => {
      const now = new Date()
      const diff = expiresAt.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeLeft('Expired')
        if (state === 'pending') {
          setState('error')
          setError('Request expired. Please try again.')
        }
        clearInterval(interval)
      } else {
        const minutes = Math.floor(diff / 60000)
        const seconds = Math.floor((diff % 60000) / 1000)
        setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [expiresAt, state])

  const { socket, isConnected } = useSocket()

  // Helper to check approval status via API (used for fallback + initial check)
  const checkApprovalStatus = useCallback(async () => {
    if (state !== 'pending' || !approvalId) return
    try {
      const response = await fetch(`/api/voids/remote-approval/${approvalId}/status`)
      const data = await response.json()

      if (data.data?.status === 'approved' && data.data?.approvalCode) {
        setApprovalCode(data.data.approvalCode)
        setEnteredCode(data.data.approvalCode)
        setState('enter_code')
      } else if (data.data?.status === 'rejected') {
        setState('error')
        setError(`Request rejected by ${data.data.managerName}`)
      } else if (data.data?.status === 'expired') {
        setState('error')
        setError('Request expired')
      }
    } catch (err) {
      console.error('Status check error:', err)
    }
  }, [state, approvalId])

  // Socket-driven updates for void approval
  useEffect(() => {
    if (state !== 'pending' || !approvalId || !socket || !isConnected) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onApprovalUpdate = (data: any) => {
      if (data.approvalId !== approvalId) return

      if (data.type === 'approved' && data.approvalCode) {
        setApprovalCode(data.approvalCode)
        setEnteredCode(data.approvalCode)
        setState('enter_code')
      } else if (data.type === 'rejected') {
        setState('error')
        setError(`Request rejected by ${data.managerName}`)
      } else if (data.type === 'expired') {
        setState('error')
        setError('Request expired')
      }
    }

    socket.on('void:approval-update', onApprovalUpdate)
    return () => { socket.off('void:approval-update', onApprovalUpdate) }
  }, [state, approvalId, socket, isConnected])

  // 20s disconnected-only fallback polling
  useEffect(() => {
    if (state !== 'pending' || !approvalId || isConnected) return

    const fallback = setInterval(() => checkApprovalStatus(), 20000)
    return () => clearInterval(fallback)
  }, [state, approvalId, isConnected, checkApprovalStatus])

  // visibilitychange for instant check on tab switch
  useEffect(() => {
    if (state !== 'pending' || !approvalId) return

    const handler = () => {
      if (document.visibilityState === 'visible') checkApprovalStatus()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [state, approvalId, checkApprovalStatus])

  const fetchManagers = async () => {
    try {
      const response = await fetch(`/api/voids/remote-approval/managers?locationId=${locationId}`)
      const data = await response.json()
      if (data.data?.managers) {
        setManagers(data.data.managers)
      }
    } catch (err) {
      console.error('Failed to fetch managers:', err)
      setError('Failed to load managers')
    }
  }

  const handleRequestApproval = async () => {
    if (!selectedManager || !reason.trim()) {
      setError('Please select a manager and enter a reason')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/voids/remote-approval/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          orderId,
          orderItemId,
          voidType,
          managerId: selectedManager.id,
          voidReason: reason,
          amount,
          itemName,
          requestedById: employeeId,
          terminalId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send request')
      }

      setApprovalId(data.data.approvalId)
      setExpiresAt(new Date(data.data.expiresAt))
      setState('pending')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request')
    } finally {
      setIsLoading(false)
    }
  }

  const handleValidateCode = async () => {
    if (enteredCode.length !== 6) {
      setError('Please enter the 6-digit code')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/voids/remote-approval/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderItemId,
          code: enteredCode,
          employeeId,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.data?.valid) {
        throw new Error(data.error || 'Invalid code')
      }

      setState('success')
      onSuccess({
        approvalId: data.data.approvalId,
        managerId: data.data.managerId,
        managerName: data.data.managerName,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = () => {
    setState('select_manager')
    setSelectedManager(null)
    setReason('')
    setApprovalId(null)
    setApprovalCode('')
    setEnteredCode('')
    setExpiresAt(null)
    setError(null)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <div className="rounded-lg bg-slate-800 p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Remote Manager Approval</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <span className="sr-only">Close</span>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Item Info */}
        <div className="mb-4 rounded bg-slate-700 p-3">
          <div className="text-sm text-gray-400">
            {voidType === 'comp' ? 'Comp' : 'Void'} Request
          </div>
          <div className="text-lg font-semibold text-white">{itemName}</div>
          <div className="text-amber-400">{formatCurrency(amount)}</div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 rounded bg-red-900/50 p-3 text-red-200">
            {error}
          </div>
        )}

        {/* State: Select Manager */}
        {state === 'select_manager' && (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-gray-400">Select Manager</label>
              {managers.length === 0 ? (
                <div className="text-yellow-400">
                  No managers with phone numbers found
                </div>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {managers.map((manager) => (
                    <button
                      key={manager.id}
                      onClick={() => setSelectedManager(manager)}
                      className={`w-full rounded p-3 text-left transition ${
                        selectedManager?.id === manager.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-gray-200 hover:bg-slate-600'
                      }`}
                    >
                      <div className="font-medium">{manager.name}</div>
                      <div className="text-sm opacity-75">
                        {manager.roleName} • {manager.phoneMasked}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={() => selectedManager && setState('enter_reason')}
                disabled={!selectedManager}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* State: Enter Reason */}
        {state === 'enter_reason' && (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-gray-400">
                Reason for {voidType === 'comp' ? 'comp' : 'void'}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter reason..."
                className="w-full rounded bg-slate-700 p-3 text-white placeholder-gray-500"
                rows={3}
                autoFocus
              />
            </div>

            <div className="rounded bg-slate-700 p-3">
              <div className="text-sm text-gray-400">Sending request to:</div>
              <div className="font-medium text-white">{selectedManager?.name}</div>
              <div className="text-sm text-gray-400">{selectedManager?.phoneMasked}</div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setState('select_manager')}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleRequestApproval}
                disabled={!reason.trim() || isLoading}
              >
                {isLoading ? 'Sending...' : 'Send Request'}
              </Button>
            </div>
          </div>
        )}

        {/* State: Pending */}
        {state === 'pending' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-blue-600 flex items-center justify-center">
              <svg className="h-8 w-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>

            <div>
              <div className="text-lg font-semibold text-white">Waiting for Approval</div>
              <div className="text-gray-400">SMS sent to {selectedManager?.name}</div>
            </div>

            <div className="rounded bg-slate-700 p-4">
              <div className="text-sm text-gray-400">Time remaining</div>
              <div className="text-2xl font-bold text-amber-400">{timeLeft}</div>
            </div>

            <div className="text-sm text-gray-400">
              Manager can reply YES to approve or tap the link in the SMS
            </div>

            <Button
              variant="outline"
              onClick={handleReset}
              className="w-full"
            >
              Cancel Request
            </Button>
          </div>
        )}

        {/* State: Enter Code */}
        {state === 'enter_code' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-green-600 flex items-center justify-center">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-lg font-semibold text-green-400">Approved!</div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-gray-400">
                Enter 6-digit approval code
              </label>
              <input
                type="text"
                value={enteredCode}
                onChange={(e) => setEnteredCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full rounded bg-slate-700 p-4 text-center text-2xl font-mono tracking-widest text-white"
                maxLength={6}
                autoFocus
              />
            </div>

            {approvalCode && (
              <div className="rounded bg-green-900/30 p-3 text-center">
                <div className="text-sm text-gray-400">Code auto-filled:</div>
                <div className="text-xl font-mono text-green-400">{approvalCode}</div>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleReset}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleValidateCode}
                disabled={enteredCode.length !== 6 || isLoading}
              >
                {isLoading ? 'Validating...' : 'Complete Void'}
              </Button>
            </div>
          </div>
        )}

        {/* State: Success */}
        {state === 'success' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-green-600 flex items-center justify-center">
              <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-lg font-semibold text-green-400">
              Void Approved!
            </div>
            <Button onClick={onClose} className="w-full">
              Close
            </Button>
          </div>
        )}

        {/* State: Error (allows retry) */}
        {state === 'error' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-red-600 flex items-center justify-center">
              <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="text-lg font-semibold text-red-400">
              Request Failed
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleReset}
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface ManualTipTransferModalProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
  employeeId: string
  currentBalanceDollars: number
  onTransferComplete?: () => void
}

export function ManualTipTransferModal({
  isOpen,
  onClose,
  locationId,
  employeeId,
  currentBalanceDollars,
  onTransferComplete,
}: ManualTipTransferModalProps) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingEmployees, setLoadingEmployees] = useState(false)

  // On open: fetch active employees (exclude self)
  useEffect(() => {
    if (!isOpen) return
    setLoadingEmployees(true)
    fetch(`/api/employees?locationId=${locationId}`, {
      headers: { 'x-employee-id': employeeId },
    })
      .then(res => res.json())
      .then(raw => {
        const data = raw.data ?? raw
        const list = (data.employees || [])
          .filter((e: EmployeeOption) => e.id !== employeeId)
        setEmployees(list)
      })
      .catch(() => toast.error('Failed to load employees'))
      .finally(() => setLoadingEmployees(false))
  }, [isOpen, locationId, employeeId])

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setSelectedEmployeeId('')
      setAmount('')
      setMemo('')
    }
  }, [isOpen])

  const parsedAmount = parseFloat(amount)
  const isValid =
    selectedEmployeeId !== '' &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= currentBalanceDollars

  const handleTransfer = async () => {
    if (!isValid || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/tips/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-employee-id': employeeId,
        },
        body: JSON.stringify({
          locationId,
          fromEmployeeId: employeeId,
          toEmployeeId: selectedEmployeeId,
          amount: parsedAmount,
          memo: memo.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Transfer failed')
        return
      }

      const recipient = employees.find(e => e.id === selectedEmployeeId)
      const recipientName = recipient?.displayName || `${recipient?.firstName} ${recipient?.lastName}`
      toast.success(`$${parsedAmount.toFixed(2)} transferred to ${recipientName}`)
      onTransferComplete?.()
      onClose()
    } catch {
      toast.error('Transfer failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transfer Tips" size="md" variant="default">

        {/* Balance */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <p className="text-white/40 text-xs uppercase tracking-wide">Your Balance</p>
          <p className="text-white text-2xl font-bold">
            ${currentBalanceDollars.toFixed(2)}
          </p>
        </div>

        {/* Recipient */}
        <div className="mb-4">
          <label className="text-white/60 text-sm block mb-2">Send To</label>
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            aria-label="Select recipient employee"
            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="" className="bg-slate-900">
              Select employee...
            </option>
            {employees.map(e => (
              <option key={e.id} value={e.id} className="bg-slate-900">
                {e.displayName || `${e.firstName} ${e.lastName}`}
              </option>
            ))}
          </select>
          {loadingEmployees && (
            <p className="text-white/30 text-xs mt-1">Loading employees...</p>
          )}
        </div>

        {/* Amount */}
        <div className="mb-4">
          <label className="text-white/60 text-sm block mb-2">Amount</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={Math.min(currentBalanceDollars, 9999.99)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (['e','E','+','-'].includes(e.key)) e.preventDefault() }}
              placeholder="0.00"
              aria-label="Transfer amount in dollars"
              className="w-full bg-white/5 border border-white/10 text-white rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <p className="text-white/30 text-xs mt-1">
            Max: ${currentBalanceDollars.toFixed(2)}
          </p>
          {!isNaN(parsedAmount) && parsedAmount > currentBalanceDollars && (
            <p className="text-red-400 text-xs mt-1">Exceeds available balance</p>
          )}
        </div>

        {/* Memo */}
        <div className="mb-6">
          <label className="text-white/60 text-sm block mb-2">Memo (optional)</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Reason for transfer..."
            maxLength={200}
            aria-label="Transfer memo"
            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl font-semibold text-sm transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={!isValid || loading}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-white/5 disabled:text-white/20 text-white rounded-xl font-semibold text-sm transition-all"
          >
            {loading ? 'Sending...' : 'Send Transfer'}
          </button>
        </div>
    </Modal>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

interface PaidInOutRecord {
  id: string
  type: 'paid_in' | 'paid_out'
  amount: number
  reason: string
  reference: string | null
  employeeName: string
  approverName: string | null
  drawerName: string
  createdAt: string
}

interface Summary {
  totalPaidIn: number
  totalPaidOut: number
  net: number
  count: number
}

interface Drawer {
  id: string
  name: string
  isAvailable: boolean
  claimedBy: { shiftId: string; employeeId: string; employeeName: string } | null
}

export default function DrawersPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/drawers' })

  const [drawers, setDrawers] = useState<Drawer[]>([])
  const [records, setRecords] = useState<PaidInOutRecord[]>([])
  const [summary, setSummary] = useState<Summary>({ totalPaidIn: 0, totalPaidOut: 0, net: 0, count: 0 })
  const [loading, setLoading] = useState(true)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState<'paid_in' | 'paid_out'>('paid_in')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [selectedDrawerId, setSelectedDrawerId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchDrawers = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/drawers?locationId=${locationId}`)
      const json = await res.json()
      if (json.data?.drawers) {
        setDrawers(json.data.drawers)
        if (json.data.drawers.length > 0 && !selectedDrawerId) {
          setSelectedDrawerId(json.data.drawers[0].id)
        }
      }
    } catch (e) {
      console.error('Failed to fetch drawers:', e)
    }
  }, [locationId, selectedDrawerId])

  const fetchRecords = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(
        `/api/paid-in-out?locationId=${locationId}&requestingEmployeeId=${employee.id}`
      )
      const json = await res.json()
      if (json.data) {
        setRecords(json.data.records)
        setSummary(json.data.summary)
      }
    } catch (e) {
      console.error('Failed to fetch paid in/out:', e)
    } finally {
      setLoading(false)
    }
  }, [locationId, employee?.id])

  useEffect(() => {
    fetchDrawers()
    fetchRecords()
  }, [fetchDrawers, fetchRecords])

  // Listen for real-time updates
  useEffect(() => {
    const socket = getSharedSocket()
    const handler = () => {
      fetchRecords()
    }
    socket.on('drawer:paid_in_out', handler)
    return () => {
      socket.off('drawer:paid_in_out', handler)
      releaseSharedSocket()
    }
  }, [fetchRecords])

  const openModal = (type: 'paid_in' | 'paid_out') => {
    setModalType(type)
    setAmount('')
    setReason('')
    setReference('')
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!amount || Number(amount) <= 0 || !reason.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/paid-in-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          type: modalType,
          amount: Number(amount),
          reason: reason.trim(),
          reference: reference.trim() || undefined,
          drawerId: selectedDrawerId || undefined,
          employeeId: employee?.id,
        }),
      })
      if (res.ok) {
        setShowModal(false)
        fetchRecords()
      } else {
        const json = await res.json()
        alert(json.error || 'Failed to create record')
      }
    } catch (e) {
      console.error('Failed to submit:', e)
      alert('Failed to create record')
    } finally {
      setSubmitting(false)
    }
  }

  if (!hydrated) return null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Cash Drawers — Paid In / Paid Out</h1>

      {/* Drawer selector */}
      {drawers.length > 1 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Drawer</label>
          <select
            value={selectedDrawerId}
            onChange={(e) => setSelectedDrawerId(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
          >
            {drawers.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} {d.claimedBy ? `(${d.claimedBy.employeeName})` : '(Available)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
          <div className="text-sm text-green-400">Paid In</div>
          <div className="text-2xl font-bold text-green-300">${summary.totalPaidIn.toFixed(2)}</div>
        </div>
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
          <div className="text-sm text-red-400">Paid Out</div>
          <div className="text-2xl font-bold text-red-300">${summary.totalPaidOut.toFixed(2)}</div>
        </div>
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
          <div className="text-sm text-gray-400">Net</div>
          <div className={`text-2xl font-bold ${summary.net >= 0 ? 'text-green-300' : 'text-red-300'}`}>
            ${summary.net.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => openModal('paid_in')}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium min-h-[48px]"
        >
          + Paid In
        </button>
        <button
          onClick={() => openModal('paid_out')}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium min-h-[48px]"
        >
          - Paid Out
        </button>
      </div>

      {/* Records table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-700 text-gray-300">
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-left">Reason</th>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Drawer</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No paid in/out records for today
                </td>
              </tr>
            ) : (
              records.map(r => (
                <tr key={r.id} className="border-t border-gray-700 hover:bg-gray-700/50">
                  <td className="px-4 py-3 text-gray-300">
                    {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      r.type === 'paid_in'
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-red-900/50 text-red-300'
                    }`}>
                      {r.type === 'paid_in' ? 'IN' : 'OUT'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${
                    r.type === 'paid_in' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    ${r.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {r.reason}
                    {r.reference && <span className="text-gray-500 ml-1">({r.reference})</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{r.employeeName}</td>
                  <td className="px-4 py-3 text-gray-400">{r.drawerName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">
              {modalType === 'paid_in' ? 'Paid In' : 'Paid Out'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-lg"
                  placeholder="0.00"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                >
                  <option value="">Select a reason...</option>
                  {modalType === 'paid_in' ? (
                    <>
                      <option value="Starting bank">Starting bank</option>
                      <option value="Change from bank">Change from bank</option>
                      <option value="Bank deposit return">Bank deposit return</option>
                      <option value="Other">Other</option>
                    </>
                  ) : (
                    <>
                      <option value="Safe drop">Safe drop</option>
                      <option value="Bank deposit">Bank deposit</option>
                      <option value="Petty cash">Petty cash</option>
                      <option value="Vendor payment">Vendor payment</option>
                      <option value="Other">Other</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Reference (optional)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                  placeholder="Check #, vendor name, etc."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg min-h-[48px]"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !amount || Number(amount) <= 0 || !reason}
                className={`flex-1 px-4 py-3 text-white rounded-lg font-medium min-h-[48px] ${
                  modalType === 'paid_in'
                    ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-900'
                    : 'bg-red-600 hover:bg-red-700 disabled:bg-red-900'
                } disabled:opacity-50`}
              >
                {submitting ? 'Saving...' : modalType === 'paid_in' ? 'Record Paid In' : 'Record Paid Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

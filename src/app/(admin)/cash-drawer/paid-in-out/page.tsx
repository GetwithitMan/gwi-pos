'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'

interface PaidInOutRecord {
  id: string
  type: 'paid_in' | 'paid_out'
  amount: number
  reason: string
  reference: string | null
  employeeId: string
  employeeName: string
  approvedBy: string | null
  approverName: string | null
  drawerId: string
  drawerName: string
  createdAt: string
}

interface Summary {
  totalPaidIn: number
  totalPaidOut: number
  net: number
  count: number
}

interface CreateFormData {
  type: 'paid_in' | 'paid_out'
  amount: string
  reason: string
  reference: string
}

const TYPE_STYLES = {
  paid_in: 'bg-green-50 text-green-700 border-green-200',
  paid_out: 'bg-red-50 text-red-700 border-red-200',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function PaidInOutPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/cash-drawer/paid-in-out' })

  const [records, setRecords] = useState<PaidInOutRecord[]>([])
  const [summary, setSummary] = useState<Summary>({ totalPaidIn: 0, totalPaidOut: 0, net: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<CreateFormData>({
    type: 'paid_in',
    amount: '',
    reason: '',
    reference: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(
        `/api/paid-in-out?locationId=${locationId}&requestingEmployeeId=${employee.id}`
      )
      if (res.ok) {
        const json = await res.json()
        setRecords(json.data.records)
        setSummary(json.data.summary)
      }
    } catch (e) {
      console.error('Failed to fetch paid in/out records:', e)
    } finally {
      setLoading(false)
    }
  }, [locationId, employee?.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locationId || !employee?.id) return

    const amountNum = parseFloat(formData.amount)
    if (!amountNum || amountNum <= 0) {
      setError('Amount must be greater than $0')
      return
    }
    if (!formData.reason.trim()) {
      setError('Reason is required')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/paid-in-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee.id,
          type: formData.type,
          amount: amountNum,
          reason: formData.reason.trim(),
          reference: formData.reference.trim() || null,
        }),
      })

      if (res.ok) {
        setShowForm(false)
        setFormData({ type: 'paid_in', amount: '', reason: '', reference: '' })
        await fetchData()
      } else {
        const json = await res.json()
        setError(json.error || 'Failed to create record')
      }
    } catch (e) {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  if (!hydrated) return null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paid In / Out</h1>
          <p className="text-sm text-gray-900 mt-0.5">Today&apos;s cash drawer adjustments</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { setFormData(d => ({ ...d, type: 'paid_out' })); setShowForm(true) }}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium min-h-[44px] transition-colors"
          >
            Paid Out
          </button>
          <button
            onClick={() => { setFormData(d => ({ ...d, type: 'paid_in' })); setShowForm(true) }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium min-h-[44px] transition-colors"
          >
            Paid In
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-900 uppercase tracking-wider">Total In</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(summary.totalPaidIn)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-900 uppercase tracking-wider">Total Out</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(summary.totalPaidOut)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-900 uppercase tracking-wider">Net</p>
          <p className={`text-2xl font-bold mt-1 ${summary.net >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
            {formatCurrency(summary.net)}
          </p>
        </div>
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {formData.type === 'paid_in' ? 'Paid In' : 'Paid Out'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Type toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Type</label>
                <div className="flex rounded-lg overflow-hidden border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setFormData(d => ({ ...d, type: 'paid_in' }))}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      formData.type === 'paid_in'
                        ? 'bg-green-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Paid In
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(d => ({ ...d, type: 'paid_out' }))}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      formData.type === 'paid_out'
                        ? 'bg-red-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Paid Out
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Amount <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-900 font-medium">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.amount}
                    onChange={e => setFormData(d => ({ ...d, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    required
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.reason}
                  onChange={e => setFormData(d => ({ ...d, reason: e.target.value }))}
                  placeholder="e.g. Vendor payment, cash drop, change fund"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>

              {/* Reference (optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Reference <span className="text-gray-900 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formData.reference}
                  onChange={e => setFormData(d => ({ ...d, reference: e.target.value }))}
                  placeholder="Invoice number, etc."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setError(null) }}
                  className="flex-1 py-2 border border-gray-200 text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`flex-1 py-2 text-white rounded-lg text-sm font-medium min-h-[44px] transition-colors disabled:opacity-50 ${
                    formData.type === 'paid_in'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {submitting ? 'Saving...' : `Record ${formData.type === 'paid_in' ? 'Paid In' : 'Paid Out'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Records table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Today&apos;s Activity</h2>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-900">Loading...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-900">No transactions today</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-900 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-3">Time</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Drawer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {records.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-600 tabular-nums">{formatTime(r.createdAt)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${TYPE_STYLES[r.type]}`}>
                        {r.type === 'paid_in' ? 'Paid In' : 'Paid Out'}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold tabular-nums ${
                      r.type === 'paid_in' ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {r.type === 'paid_out' ? '-' : ''}{formatCurrency(r.amount)}
                    </td>
                    <td className="px-5 py-3 text-gray-900">
                      {r.reason}
                      {r.reference && (
                        <span className="ml-2 text-xs text-gray-900">({r.reference})</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{r.employeeName}</td>
                    <td className="px-5 py-3 text-gray-900 text-xs">{r.drawerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface ChargebackCase {
  id: string
  orderId: string | null
  paymentId: string | null
  cardLast4: string
  cardBrand: string | null
  amount: number
  chargebackDate: string
  reason: string | null
  reasonCode: string | null
  responseDeadline: string | null
  status: 'open' | 'responded' | 'won' | 'lost'
  notes: string | null
  respondedAt: string | null
  resolvedAt: string | null
  createdAt: string
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'responded', label: 'Responded', color: 'bg-blue-100 text-blue-800' },
  { value: 'won', label: 'Won', color: 'bg-green-100 text-green-800' },
  { value: 'lost', label: 'Lost', color: 'bg-red-100 text-red-800' },
] as const

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(s => s.value === status)
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${opt?.color || 'bg-gray-100 text-gray-800'}`}>
      {opt?.label || status}
    </span>
  )
}

export default function ChargebacksPage() {
  useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const [cases, setCases] = useState<ChargebackCase[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<string>('')
  const [editNotes, setEditNotes] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const locationId = employee?.location?.id

  const fetchCases = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      if (filterStatus) params.set('status', filterStatus)
      const res = await fetch(`/api/chargebacks?${params}`)
      const json = await res.json()
      setCases(json.data || [])
    } catch (err) {
      console.error('Failed to fetch chargebacks:', err)
    } finally {
      setLoading(false)
    }
  }, [locationId, filterStatus])

  useEffect(() => {
    fetchCases()
  }, [fetchCases])

  function startEditing(c: ChargebackCase) {
    setEditingId(c.id)
    setEditStatus(c.status)
    setEditNotes(c.notes || '')
  }

  function cancelEditing() {
    setEditingId(null)
    setEditStatus('')
    setEditNotes('')
  }

  async function saveCase(id: string) {
    if (!employee) return
    setSaving(true)
    try {
      const res = await fetch(`/api/chargebacks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-employee-id': employee.id,
        },
        body: JSON.stringify({ status: editStatus, notes: editNotes }),
      })
      if (res.ok) {
        const json = await res.json()
        setCases(prev => prev.map(c => c.id === id ? json.data : c))
        cancelEditing()
      }
    } catch (err) {
      console.error('Failed to update chargeback:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!employee) return null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminPageHeader
        title="Chargebacks"
        subtitle="Track and manage chargeback cases"
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
          { label: 'Chargebacks', href: '/reports/chargebacks' },
        ]}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm font-medium text-gray-900">Status:</label>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="text-sm text-gray-900">{cases.length} case{cases.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Cases table */}
      {loading ? (
        <div className="text-center py-12 text-gray-900">Loading...</div>
      ) : cases.length === 0 ? (
        <div className="text-center py-12 text-gray-900">No chargeback cases found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Card</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-900 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Deadline</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Notes</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-900 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {cases.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {new Date(c.chargebackDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {c.cardBrand ? `${c.cardBrand} ` : ''}****{c.cardLast4}
                  </td>
                  <td className="px-4 py-3 text-sm text-right whitespace-nowrap font-medium">
                    {formatCurrency(c.amount)}
                  </td>
                  <td className="px-4 py-3 text-sm max-w-[200px] truncate" title={c.reason || undefined}>
                    {c.reasonCode ? `[${c.reasonCode}] ` : ''}{c.reason || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {c.responseDeadline ? (
                      <span className={new Date(c.responseDeadline) < new Date() ? 'text-red-600 font-medium' : ''}>
                        {new Date(c.responseDeadline).toLocaleDateString()}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {editingId === c.id ? (
                      <select
                        value={editStatus}
                        onChange={e => setEditStatus(e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        {STATUS_OPTIONS.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={c.status} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm max-w-[200px]">
                    {editingId === c.id ? (
                      <textarea
                        value={editNotes}
                        onChange={e => setEditNotes(e.target.value)}
                        rows={2}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        placeholder="Add notes..."
                      />
                    ) : (
                      <span className="truncate block" title={c.notes || undefined}>{c.notes || '-'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {editingId === c.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveCase(c.id)}
                          disabled={saving}
                          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="px-2 py-1 bg-gray-200 text-gray-900 text-xs rounded hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(c)}
                        className="px-2 py-1 bg-gray-100 text-gray-900 text-xs rounded hover:bg-gray-200"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

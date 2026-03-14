'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

interface SwapRequestEmployee {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

interface ShiftRequest {
  id: string
  type: 'swap' | 'cover' | 'drop'
  status: string
  reason: string | null
  notes: string | null
  managerNote: string | null
  createdAt: string
  shift: {
    id: string
    date: string
    startTime: string
    endTime: string
    status: string
    schedule?: {
      id: string
      weekStart: string
      status: string
    }
  }
  requestedByEmployee: SwapRequestEmployee
  requestedToEmployee: SwapRequestEmployee | null
  approvedByEmployee: SwapRequestEmployee | null
}

function empName(emp: SwapRequestEmployee): string {
  return emp.displayName || `${emp.firstName} ${emp.lastName}`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(':')
  const hour = parseInt(hourStr, 10)
  const minute = minuteStr || '00'
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${minute} ${period}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    accepted: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-gray-100 text-gray-500',
  }
  const labels: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Awaiting Approval',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    swap: 'bg-purple-100 text-purple-800',
    cover: 'bg-blue-100 text-blue-800',
    drop: 'bg-red-100 text-red-800',
  }
  const labels: Record<string, string> = {
    swap: 'Swap',
    cover: 'Cover',
    drop: 'Drop',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[type] ?? type}
    </span>
  )
}

export default function ShiftRequestsPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/scheduling/requests' })
  const employee = useAuthStore(s => s.employee)

  const [requests, setRequests] = useState<ShiftRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [typeFilter, setTypeFilter] = useState<string>('')

  // Manager note modal state
  const [noteModalRequest, setNoteModalRequest] = useState<ShiftRequest | null>(null)
  const [noteModalAction, setNoteModalAction] = useState<'approve' | 'reject'>('approve')
  const [managerNote, setManagerNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const loadRequests = useCallback(async () => {
    if (!employee?.location?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId: employee.location.id })
      if (statusFilter && statusFilter !== 'all' && statusFilter !== 'active') {
        params.set('status', statusFilter)
      }
      if (typeFilter) {
        params.set('type', typeFilter)
      }

      const res = await fetch(`/api/shift-requests?${params}`)
      if (res.ok) {
        const data = await res.json()
        let fetched = data.data.requests as ShiftRequest[]
        // For 'active' filter, show pending + accepted
        if (statusFilter === 'active') {
          fetched = fetched.filter(r => r.status === 'pending' || r.status === 'accepted')
        }
        setRequests(fetched)
      }
    } catch (err) {
      console.error('Failed to load shift requests:', err)
    } finally {
      setLoading(false)
    }
  }, [employee?.location?.id, statusFilter, typeFilter])

  useEffect(() => {
    if (employee?.location?.id) {
      loadRequests()
    }
  }, [employee?.location?.id, loadRequests])

  const handleAction = async (req: ShiftRequest, action: 'approve' | 'reject') => {
    setNoteModalRequest(req)
    setNoteModalAction(action)
    setManagerNote('')
  }

  const executeAction = async () => {
    if (!noteModalRequest || !employee?.location?.id || !employee?.id) return
    setActionLoading(true)
    const req = noteModalRequest

    try {
      // For approve on pending non-drop requests, accept first
      if (noteModalAction === 'approve' && req.status === 'pending' && req.type !== 'drop') {
        const acceptRes = await fetch(
          `/api/shift-swap-requests/${req.id}/accept`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId: employee.location.id }),
          }
        )
        if (!acceptRes.ok) {
          const err = await acceptRes.json()
          toast.error(err.error || 'Failed to process request')
          setActionLoading(false)
          return
        }
      }

      const endpoint = noteModalAction === 'approve'
        ? `/api/shift-swap-requests/${req.id}/approve`
        : `/api/shift-swap-requests/${req.id}/reject`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          approvedByEmployeeId: employee.id,
          managerNote: managerNote || undefined,
          reason: managerNote || undefined,
        }),
      })

      if (res.ok) {
        toast.success(noteModalAction === 'approve' ? 'Request approved' : 'Request rejected')
        setNoteModalRequest(null)
        loadRequests()
      } else {
        const err = await res.json()
        toast.error(err.error || `Failed to ${noteModalAction} request`)
      }
    } catch {
      toast.error(`Failed to ${noteModalAction} request`)
    } finally {
      setActionLoading(false)
    }
  }

  if (!hydrated) return null

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'accepted').length

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Shift Requests"
      />

      <div className="max-w-5xl mx-auto mt-6">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
            >
              <option value="active">Action Needed ({pendingCount})</option>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Type:</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-sm"
            >
              <option value="">All Types</option>
              <option value="swap">Swap</option>
              <option value="cover">Cover</option>
              <option value="drop">Drop</option>
            </select>
          </div>
          <Button variant="outline" onClick={loadRequests} className="ml-auto">
            Refresh
          </Button>
        </div>

        {/* Request List */}
        <Card>
          <CardHeader>
            <CardTitle>
              {statusFilter === 'active' ? 'Action Needed' : statusFilter === 'all' ? 'All Requests' : `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Requests`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
            ) : requests.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                No shift requests found.
              </div>
            ) : (
              <div className="divide-y">
                {requests.map(req => {
                  const isActionable = req.status === 'pending' || req.status === 'accepted'
                  const requestType = req.type || 'swap'

                  return (
                    <div key={req.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4">
                        {/* Left */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <TypeBadge type={requestType} />
                            <StatusBadge status={req.status} />
                            <span className="text-xs text-gray-400">
                              {new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* Shift info */}
                          <div className="text-sm font-medium text-gray-900">
                            {formatDate(req.shift.date)} &middot; {formatTime(req.shift.startTime)} – {formatTime(req.shift.endTime)}
                          </div>

                          {/* Who */}
                          <div className="text-sm text-gray-600 mt-0.5">
                            {requestType === 'drop' ? (
                              <span>{empName(req.requestedByEmployee)} wants to drop this shift</span>
                            ) : requestType === 'cover' ? (
                              <span>
                                {empName(req.requestedByEmployee)} needs cover
                                {req.requestedToEmployee ? ` — ${empName(req.requestedToEmployee)} volunteered` : ' — open'}
                              </span>
                            ) : (
                              <span>
                                {empName(req.requestedByEmployee)} wants to swap with{' '}
                                {req.requestedToEmployee ? empName(req.requestedToEmployee) : 'anyone'}
                              </span>
                            )}
                          </div>

                          {/* Reason */}
                          {req.reason && (
                            <p className="text-xs text-gray-600 mt-1">
                              <span className="font-medium">Reason:</span> {req.reason}
                            </p>
                          )}

                          {/* Notes */}
                          {req.notes && (
                            <p className="text-xs text-gray-500 mt-0.5">{req.notes}</p>
                          )}

                          {/* Manager note */}
                          {req.managerNote && (
                            <p className="text-xs text-blue-600 mt-0.5">
                              <span className="font-medium">Manager note:</span> {req.managerNote}
                            </p>
                          )}

                          {/* Approved by */}
                          {req.approvedByEmployee && req.status === 'approved' && (
                            <p className="text-xs text-green-600 mt-0.5">
                              Approved by {empName(req.approvedByEmployee)}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        {isActionable && (
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => handleAction(req, 'approve')}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleAction(req, 'reject')}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Manager Note Modal */}
      {noteModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              {noteModalAction === 'approve' ? 'Approve' : 'Reject'} Request
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {noteModalAction === 'approve'
                ? noteModalRequest.type === 'drop'
                  ? 'This will mark the shift as called off.'
                  : noteModalRequest.type === 'cover'
                    ? 'This will reassign the shift to the covering employee.'
                    : 'This will swap the shift assignment.'
                : 'This will deny the employee\'s request.'
              }
            </p>

            {/* Request summary */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm mb-4">
              <div className="flex items-center gap-2 mb-1">
                <TypeBadge type={noteModalRequest.type || 'swap'} />
                <span className="font-medium">{formatDate(noteModalRequest.shift.date)}</span>
              </div>
              <p className="text-gray-600">
                {empName(noteModalRequest.requestedByEmployee)}
                {noteModalRequest.requestedToEmployee && ` → ${empName(noteModalRequest.requestedToEmployee)}`}
              </p>
              {noteModalRequest.reason && (
                <p className="text-xs text-gray-500 mt-1">Reason: {noteModalRequest.reason}</p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Manager Note (optional)
              </label>
              <textarea
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
                placeholder="Add a note for the employee..."
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setNoteModalRequest(null)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                variant={noteModalAction === 'approve' ? 'primary' : 'danger'}
                onClick={executeAction}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : noteModalAction === 'approve' ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'

// ============================================================================
// TYPES
// ============================================================================

interface AuditEntry {
  id: string
  timestamp: string
  action: string
  entityType: string
  entityId: string | null
  employeeId: string | null
  employeeName: string | null
  details: Record<string, unknown> | null
}

interface AuditResponse {
  entries: AuditEntry[]
  total: number
  limit: number
  offset: number
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PAGE_SIZE = 50

const ACTION_TYPES = [
  'login',
  'logout',
  'login_failed',
  'order_created',
  'order_sent',
  'order_closed',
  'item_voided',
  'item_comped',
  'payment_processed',
  'payment_refunded',
  'manager_override',
  'discount_applied',
  'cash_drawer_opened',
  'shift_started',
  'shift_ended',
  'menu_updated',
  'settings_changed',
]

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-green-50 text-green-700',
  logout: 'bg-gray-100 text-gray-600',
  login_failed: 'bg-red-50 text-red-700',
  order_created: 'bg-blue-50 text-blue-700',
  order_sent: 'bg-blue-50 text-blue-700',
  order_closed: 'bg-blue-50 text-blue-700',
  item_voided: 'bg-red-50 text-red-700',
  item_comped: 'bg-amber-50 text-amber-700',
  payment_processed: 'bg-green-50 text-green-700',
  payment_refunded: 'bg-red-50 text-red-700',
  manager_override: 'bg-amber-50 text-amber-700',
  discount_applied: 'bg-amber-50 text-amber-700',
  cash_drawer_opened: 'bg-purple-50 text-purple-700',
  shift_started: 'bg-green-50 text-green-700',
  shift_ended: 'bg-gray-100 text-gray-600',
  menu_updated: 'bg-indigo-50 text-indigo-700',
  settings_changed: 'bg-indigo-50 text-indigo-700',
}

// ============================================================================
// HELPERS
// ============================================================================

function getDefaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0]
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    // If it looks like a dollar amount (has decimals or key hints at currency)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function AuditLogBrowserPage() {
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/audit' })

  // Filter state
  const [startDate, setStartDate] = useState(getDefaultStartDate)
  const [endDate, setEndDate] = useState(getDefaultEndDate)
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [actionType, setActionType] = useState('')

  // Data state
  const [data, setData] = useState<AuditResponse | null>(null)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const locationId = currentEmployee?.location?.id

  // ------------------------------------------
  // Permission check
  // ------------------------------------------
  const permissions = currentEmployee?.permissions ?? []
  const hasAccess =
    permissions.includes('manager.shift_review') ||
    permissions.includes('admin.full') ||
    permissions.includes('*')

  // ------------------------------------------
  // Fetch employees for filter dropdown
  // ------------------------------------------
  useEffect(() => {
    if (!locationId) return
    fetch(`/api/employees?locationId=${locationId}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (json?.data) {
          setEmployees(
            (json.data as EmployeeOption[]).sort((a, b) =>
              (a.displayName || a.firstName).localeCompare(b.displayName || b.firstName)
            )
          )
        }
      })
      .catch(() => {})
  }, [locationId])

  // ------------------------------------------
  // Fetch audit log
  // ------------------------------------------
  const fetchAuditLog = useCallback(async (page: number) => {
    if (!locationId || !currentEmployee?.id) return

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        employeeId: currentEmployee.id,
        locationId,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      })

      if (startDate) params.set('startDate', new Date(startDate).toISOString())
      if (endDate) {
        // End of day for the end date
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        params.set('endDate', end.toISOString())
      }
      if (actionType) params.set('actionType', actionType)
      if (filterEmployeeId) params.set('filterEmployeeId', filterEmployeeId)

      const res = await fetch(`/api/audit/activity?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(err.error || 'Failed to fetch audit log')
        return
      }

      const json = await res.json()
      setData(json.data)
    } catch {
      setError('Failed to fetch audit log')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, currentEmployee?.id, startDate, endDate, actionType, filterEmployeeId])

  // Initial load
  useEffect(() => {
    if (locationId && currentEmployee?.id && hasAccess) {
      fetchAuditLog(0)
    }
  }, [locationId, currentEmployee?.id, hasAccess]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------
  // Handlers
  // ------------------------------------------
  const handleSearch = () => {
    setCurrentPage(0)
    setExpandedRowId(null)
    fetchAuditLog(0)
  }

  const handleReset = () => {
    setStartDate(getDefaultStartDate())
    setEndDate(getDefaultEndDate())
    setFilterEmployeeId('')
    setActionType('')
    setCurrentPage(0)
    setExpandedRowId(null)
    // Fetch with defaults after state updates
    setTimeout(() => fetchAuditLog(0), 0)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    setExpandedRowId(null)
    fetchAuditLog(page)
  }

  const handleExportCsv = () => {
    if (!data?.entries.length) return

    const headers = ['Timestamp', 'Employee', 'Action', 'Entity Type', 'Entity ID', 'Details']
    const rows = data.entries.map(entry => [
      escapeCsvField(new Date(entry.timestamp).toLocaleString()),
      escapeCsvField(entry.employeeName || '—'),
      escapeCsvField(entry.action),
      escapeCsvField(entry.entityType || '—'),
      escapeCsvField(entry.entityId || '—'),
      escapeCsvField(entry.details ? JSON.stringify(entry.details) : ''),
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${startDate}-to-${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ------------------------------------------
  // Derived
  // ------------------------------------------
  const entries = data?.entries ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const showingFrom = total === 0 ? 0 : currentPage * PAGE_SIZE + 1
  const showingTo = Math.min((currentPage + 1) * PAGE_SIZE, total)

  // ------------------------------------------
  // Render
  // ------------------------------------------
  if (!hydrated || !currentEmployee) return null

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader title="Audit Log" />
        <div className="text-center py-20 text-gray-500">
          You do not have permission to view this page.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Audit Log"
        subtitle={currentEmployee?.location?.name}
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!entries.length}
          >
            Export CSV
          </Button>
        }
      />

      <div className="max-w-7xl mx-auto">
        {/* ================================================================ */}
        {/* FILTER BAR */}
        {/* ================================================================ */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            {/* Start Date */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Employee Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Employee</label>
              <select
                value={filterEmployeeId}
                onChange={e => setFilterEmployeeId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[180px]"
              >
                <option value="">All Employees</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Action Type Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Action Type</label>
              <select
                value={actionType}
                onChange={e => setActionType(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[180px]"
              >
                <option value="">All Actions</option>
                {ACTION_TYPES.map(type => (
                  <option key={type} value={type}>
                    {formatActionLabel(type)}
                  </option>
                ))}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <Button onClick={handleSearch} size="sm">
                Apply
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                Reset
              </Button>
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* RESULTS TABLE */}
        {/* ================================================================ */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200">
          {/* Table header with pagination info */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {total > 0
                  ? `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()} entries`
                  : 'No entries found'}
              </p>
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="px-5 py-4 bg-red-50 border-b border-red-100 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Loading state */}
          {isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading audit log...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No audit entries found for the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-3">Timestamp</th>
                    <th className="px-5 py-3">Employee</th>
                    <th className="px-5 py-3">Action</th>
                    <th className="px-5 py-3">Entity Type</th>
                    <th className="px-5 py-3">Entity ID</th>
                    <th className="px-5 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {entries.map(entry => {
                    const isExpanded = expandedRowId === entry.id
                    const colorClass = ACTION_COLORS[entry.action] || 'bg-gray-100 text-gray-600'
                    const details = entry.details
                    const detailKeys = details ? Object.keys(details) : []
                    const hasDetails = detailKeys.length > 0

                    return (
                      <tr
                        key={entry.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors align-top"
                        onClick={() => setExpandedRowId(isExpanded ? null : entry.id)}
                      >
                        <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                          {formatTimestamp(entry.timestamp)}
                        </td>
                        <td className="px-5 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {entry.employeeName || '—'}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
                            {formatActionLabel(entry.action)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-600 capitalize">
                          {entry.entityType || '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-500 font-mono text-xs">
                          {entry.entityId
                            ? entry.entityId.length > 12
                              ? `${entry.entityId.slice(0, 12)}...`
                              : entry.entityId
                            : '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-500">
                          {!hasDetails ? (
                            <span className="text-gray-300">—</span>
                          ) : isExpanded ? (
                            <div className="space-y-1" onClick={e => e.stopPropagation()}>
                              {detailKeys.map(key => (
                                <div key={key} className="flex gap-2 text-xs">
                                  <span className="font-medium text-gray-600 min-w-[80px]">
                                    {key}:
                                  </span>
                                  <span className="text-gray-800 break-all">
                                    {formatDetailValue(details![key])}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-blue-600 hover:text-blue-800">
                              {detailKeys.length} field{detailKeys.length !== 1 ? 's' : ''} — click to expand
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Page {currentPage + 1} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => handlePageChange(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

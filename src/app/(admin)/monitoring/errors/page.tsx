'use client'

/**
 * Error List Page
 *
 * Searchable, filterable table of all error logs.
 * Click an error to view full details and resolution workflow.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ErrorLog {
  id: string
  severity: string
  errorType: string
  category: string
  message: string
  status: string
  occurrenceCount: number
  groupId: string | null
  location: { id: string; name: string }
  employee: { id: string; name: string } | null
  path: string
  action: string | null
  orderId: string | null
  tableId: string | null
  paymentId: string | null
  firstOccurred: string
  lastOccurred: string
  resolvedAt: string | null
  createdAt: string
  alertSent: boolean
}

export default function ErrorListPage() {
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  // Filters
  const [severity, setSeverity] = useState<string>('')
  const [errorType, setErrorType] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState<string>('')

  // Pagination
  const [page, setPage] = useState(1)
  const limit = 25

  useEffect(() => {
    loadErrors()
  }, [severity, errorType, status, search, page])

  async function loadErrors() {
    try {
      setLoading(true)
      const locationId = localStorage.getItem('locationId')
      if (!locationId) return

      const params = new URLSearchParams({
        locationId,
        limit: limit.toString(),
        offset: ((page - 1) * limit).toString(),
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })

      if (severity) params.set('severity', severity)
      if (errorType) params.set('errorType', errorType)
      if (status) params.set('status', status)
      if (search) params.set('search', search)

      const response = await fetch(`/api/monitoring/errors?${params}`)
      const data = await response.json()

      if (data.success) {
        setErrors(data.errors)
        setTotal(data.pagination.total)
      }
    } catch (error) {
      console.error('Failed to load errors:', error)
    } finally {
      setLoading(false)
    }
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-500'
      case 'HIGH': return 'bg-orange-500'
      case 'MEDIUM': return 'bg-yellow-500'
      case 'LOW': return 'bg-blue-500'
      default: return 'bg-gray-500'
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'RESOLVED': return 'text-green-400'
      case 'INVESTIGATING': return 'text-yellow-400'
      case 'IGNORED': return 'text-gray-400'
      default: return 'text-red-400'
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link href="/monitoring" className="text-gray-300 hover:text-white text-sm mb-2 inline-block">
              ← Back to Dashboard
            </Link>
            <h1 className="text-4xl font-bold text-white">Error Logs</h1>
            <p className="text-gray-300 mt-1">{total} total errors</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

            {/* Search */}
            <div className="md:col-span-2">
              <label className="block text-sm text-gray-300 mb-2">Search</label>
              <input
                type="text"
                placeholder="Search message, category, action..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Severity Filter */}
            <div>
              <label className="block text-sm text-gray-300 mb-2">Severity</label>
              <select
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value)
                  setPage(1)
                }}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm text-gray-300 mb-2">Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="NEW">New</option>
                <option value="INVESTIGATING">Investigating</option>
                <option value="RESOLVED">Resolved</option>
                <option value="IGNORED">Ignored</option>
              </select>
            </div>

          </div>

          {/* Active Filters Display */}
          {(severity || errorType || status || search) && (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-300">Active filters:</span>
              {severity && (
                <span className="bg-white/10 px-3 py-1 rounded-full text-sm text-white flex items-center gap-2">
                  Severity: {severity}
                  <button onClick={() => setSeverity('')} className="text-gray-300 hover:text-white">×</button>
                </span>
              )}
              {status && (
                <span className="bg-white/10 px-3 py-1 rounded-full text-sm text-white flex items-center gap-2">
                  Status: {status}
                  <button onClick={() => setStatus('')} className="text-gray-300 hover:text-white">×</button>
                </span>
              )}
              {search && (
                <span className="bg-white/10 px-3 py-1 rounded-full text-sm text-white flex items-center gap-2">
                  Search: {search}
                  <button onClick={() => setSearch('')} className="text-gray-300 hover:text-white">×</button>
                </span>
              )}
              <button
                onClick={() => {
                  setSeverity('')
                  setErrorType('')
                  setStatus('')
                  setSearch('')
                }}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Error Table */}
        {loading ? (
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-12 border border-white/20 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
            <p className="text-gray-300 mt-4">Loading errors...</p>
          </div>
        ) : errors.length === 0 ? (
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-12 border border-white/20 text-center">
            <p className="text-gray-300 text-lg">No errors found</p>
            <p className="text-gray-400 text-sm mt-2">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/5">
                    <tr className="border-b border-white/10">
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Severity</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Type</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Message</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Count</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Last Occurred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((error) => (
                      <tr
                        key={error.id}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition"
                        onClick={() => window.open(`/monitoring/errors/${error.id}`, '_blank')}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${getSeverityColor(error.severity)}`}></div>
                            <span className="text-white text-sm font-medium">{error.severity}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-gray-300 text-sm">{error.errorType}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-white text-sm font-medium line-clamp-1">{error.message}</p>
                            {error.action && (
                              <p className="text-gray-400 text-xs mt-1 line-clamp-1">{error.action}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-medium ${getStatusColor(error.status)}`}>
                            {error.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-white text-sm">{error.occurrenceCount}x</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-gray-300 text-sm">
                            {new Date(error.lastOccurred).toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <p className="text-gray-300 text-sm">
                  Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, total)} of {total} errors
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition"
                  >
                    Previous
                  </button>
                  <span className="text-gray-300 text-sm">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

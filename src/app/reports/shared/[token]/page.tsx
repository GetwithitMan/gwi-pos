'use client'

import { useState, useEffect, use } from 'react'

interface SharedReportData {
  reportType: string
  parameters: {
    startDate?: string
    endDate?: string
    [key: string]: unknown
  }
  generatedData: {
    title?: string
    headers?: string[]
    rows?: string[][]
    summary?: { label: string; value: string }[]
    [key: string]: unknown
  }
  expiresAt: string
  createdAt: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

function exportCSV(headers: string[], rows: string[][], filename: string) {
  const csvContent = [
    headers.join(','),
    ...rows.map(row =>
      row.map(cell => {
        const escaped = cell.replace(/"/g, '""')
        return cell.includes(',') || cell.includes('"') || cell.includes('\n')
          ? `"${escaped}"`
          : escaped
      }).join(',')
    ),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [report, setReport] = useState<SharedReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch(`/api/public/reports/${token}`)
        if (res.status === 410) {
          setError('expired')
          return
        }
        if (res.status === 404) {
          setError('not-found')
          return
        }
        if (!res.ok) {
          setError('error')
          return
        }
        const json = await res.json()
        setReport(json.data)
      } catch {
        setError('error')
      } finally {
        setLoading(false)
      }
    }
    fetchReport()
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">Loading report...</p>
        </div>
      </div>
    )
  }

  if (error === 'expired') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-500">This shared report link has expired. Please request a new link from the report owner.</p>
        </div>
      </div>
    )
  }

  if (error === 'not-found') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Report Not Found</h1>
          <p className="text-gray-500">This report link is invalid or has been removed.</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-gray-500">Unable to load this report. Please try again later.</p>
        </div>
      </div>
    )
  }

  const { generatedData, parameters, reportType, createdAt, expiresAt } = report
  const title = generatedData.title || `${reportType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Report`
  const dateRange = parameters.startDate && parameters.endDate
    ? `${parameters.startDate} to ${parameters.endDate}`
    : ''
  const headers = generatedData.headers || []
  const rows = generatedData.rows || []
  const summary = generatedData.summary || []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{title}</h1>
              <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-500">
                {dateRange && <span>Period: {dateRange}</span>}
                <span>Generated: {new Date(createdAt).toLocaleString()}</span>
                <span>Expires: {new Date(expiresAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {rows.length > 0 && (
                <button
                  onClick={() => exportCSV(headers, rows, `${reportType}-report.csv`)}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
                >
                  Download CSV
                </button>
              )}
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                Print
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Summary cards */}
        {summary.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-6">
            {summary.map((item, i) => (
              <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <p className="text-sm text-gray-500">{item.label}</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{item.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Data table */}
        {rows.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left font-semibold text-gray-700 border-b border-gray-200">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-4 py-3 text-gray-900 border-b border-gray-100">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500">No data available for this report.</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-400">
          <p>Shared report from GWI POS. This link will expire on {new Date(expiresAt).toLocaleDateString()}.</p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import type { BergUnmatchedReportResponse } from '@/lib/berg/report-types'

const TYPE_COLORS: Record<string, string> = {
  NO_ORDER_ACKED: 'bg-orange-100 text-orange-800',
  NO_ORDER_NAKED: 'bg-red-100 text-red-800',
  UNKNOWN_PLU_ACKED: 'bg-blue-100 text-blue-800',
  UNKNOWN_PLU_NAKED: 'bg-purple-100 text-purple-800',
  LOG_ONLY: 'bg-gray-100 text-gray-800',
}

function fmtMoney(n: number) {
  return '$' + n.toFixed(2)
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function weekAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

export default function BergUnmatchedReportPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<BergUnmatchedReportResponse | null>(null)

  async function runReport() {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        startDate,
        endDate,
        employeeId: employee.id,
      })
      const res = await fetch(`/api/reports/berg-unmatched?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data)
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  function exportCSV() {
    if (!locationId || !employee?.id) return
    const params = new URLSearchParams({
      locationId,
      startDate,
      endDate,
      employeeId: employee.id,
      format: 'csv',
    })
    window.open(`/api/reports/berg-unmatched?${params}`)
  }

  const dateClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="p-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Unmatched Pours</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={dateClass} />
          <span className="text-gray-400">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={dateClass} />
          <Button onClick={runReport} disabled={loading}>
            {loading ? 'Running...' : 'Run Report'}
          </Button>
          {report && (
            <Button variant="outline" onClick={exportCSV}>Export CSV</Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!report && !loading && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-8 text-center text-sm text-green-700">
          No unmatched pours for this period. Great job!
        </div>
      )}

      {report && (
        <>
          {/* Big stat header */}
          <div className="rounded-lg bg-red-50 border border-red-200 p-6 mb-6 text-center">
            <div className="text-4xl font-bold text-red-600">{fmtMoney(report.totalExposure)}</div>
            <div className="text-sm text-red-700 mt-1">
              unaccounted across {report.totalCount} pours this period
            </div>
          </div>

          {/* Type chips */}
          <div className="flex flex-wrap gap-3 mb-6">
            {Object.entries(report.summary.byType).map(([type, count]) => (
              <span
                key={type}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-800'}`}
              >
                {report.unmatchedTypeLabels[type] ?? type}
                <span className="font-bold">{count}</span>
              </span>
            ))}
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-gray-500">
                      <th className="py-2 px-3 font-medium">Time</th>
                      <th className="py-2 px-3 font-medium">Device</th>
                      <th className="py-2 px-3 font-medium">PLU</th>
                      <th className="py-2 px-3 font-medium">Description</th>
                      <th className="py-2 px-3 font-medium">Pour Size</th>
                      <th className="py-2 px-3 font-medium text-right">Cost</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                      <th className="py-2 px-3 font-medium">Unmatched Type</th>
                      <th className="py-2 px-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.events.map(ev => (
                      <tr key={ev.id}>
                        <td className="py-2 px-3 whitespace-nowrap">{new Date(ev.receivedAt).toLocaleString()}</td>
                        <td className="py-2 px-3">{ev.device?.name ?? '—'}</td>
                        <td className="py-2 px-3 font-mono">{ev.pluNumber}</td>
                        <td className="py-2 px-3">{ev.pluMapping?.description ?? '—'}</td>
                        <td className="py-2 px-3">{ev.pourSizeOz ? `${ev.pourSizeOz} oz` : '—'}</td>
                        <td className="py-2 px-3 text-right">{ev.pourCost ? fmtMoney(parseFloat(ev.pourCost)) : '—'}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            ev.status === 'ACK' || ev.status === 'ACK_BEST_EFFORT'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {ev.status}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {ev.unmatchedType && (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[ev.unmatchedType] ?? 'bg-gray-100 text-gray-800'}`}>
                              {report.unmatchedTypeLabels[ev.unmatchedType] ?? ev.unmatchedType}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {(ev.unmatchedType === 'UNKNOWN_PLU_ACKED' || ev.unmatchedType === 'UNKNOWN_PLU_NAKED') && (
                            <a
                              href="/settings/integrations/berg"
                              className="text-blue-600 hover:underline text-xs font-medium"
                            >
                              Map PLU
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                    {report.events.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-gray-400">
                          No unmatched pours for this period. Great job!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

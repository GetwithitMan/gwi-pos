'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import type { BergMappingCoverageResponse } from '@/lib/berg/report-types'

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

function coverageColor(pct: number): string {
  if (pct >= 80) return 'text-green-600'
  if (pct >= 50) return 'text-yellow-600'
  return 'text-red-600'
}

function coverageBg(pct: number): string {
  if (pct >= 80) return 'bg-green-50 border-green-200'
  if (pct >= 50) return 'bg-yellow-50 border-yellow-200'
  return 'bg-red-50 border-red-200'
}

export default function BergMappingCoveragePage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<BergMappingCoverageResponse | null>(null)

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
      const res = await fetch(`/api/reports/berg-mapping-coverage?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data)
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const dateClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900'

  return (
    <div className="p-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Berg PLU Mapping Coverage</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={dateClass} />
          <span className="text-gray-900">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={dateClass} />
          <Button onClick={runReport} disabled={loading}>
            {loading ? 'Running...' : 'Run Report'}
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {!report && !loading && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-900">
          Select a date range and run the report to see PLU mapping coverage.
        </div>
      )}

      {report && (
        <>
          {/* Low coverage alert */}
          {report.coveragePct < 80 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-6 text-sm text-red-800">
              Coverage is below 80%. Unmapped PLUs mean pours are not tracked against POS orders.
              Map them in Settings &rarr; Berg Controls.
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <Card className={`border ${coverageBg(report.coveragePct)}`}>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Coverage</div>
                <div className={`text-3xl font-bold mt-1 ${coverageColor(report.coveragePct)}`}>
                  {report.coveragePct.toFixed(1)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Mapped PLUs</div>
                <div className="text-2xl font-bold mt-1 text-green-600">{report.mappedCount}</div>
                <div className="text-xs text-gray-900 mt-0.5">{report.totalActiveMappings} active mappings</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Unmapped PLUs</div>
                <div className="text-2xl font-bold mt-1 text-red-600">{report.unmappedCount}</div>
                <div className="text-xs text-gray-900 mt-0.5">{report.summary.unmappedPours} pours untracked</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Unmapped Exposure</div>
                <div className="text-2xl font-bold mt-1 text-red-600">{fmtMoney(report.summary.unmappedExposure)}</div>
                <div className="text-xs text-gray-900 mt-0.5">est. at $10/oz</div>
              </CardContent>
            </Card>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-gray-900">
                      <th className="py-2 px-3 font-medium">PLU #</th>
                      <th className="py-2 px-3 font-medium">Description</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                      <th className="py-2 px-3 font-medium text-right">Pour Count</th>
                      <th className="py-2 px-3 font-medium text-right">Volume (oz)</th>
                      <th className="py-2 px-3 font-medium text-right">Est. Exposure</th>
                      <th className="py-2 px-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.plus.map(row => (
                      <tr key={row.pluNumber} className={row.isMapped ? '' : 'bg-red-50/50'}>
                        <td className="py-2 px-3 font-mono">{row.pluNumber}</td>
                        <td className="py-2 px-3">{row.description || <span className="text-gray-900 italic">Unknown</span>}</td>
                        <td className="py-2 px-3">
                          {row.isMapped ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Mapped</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Unmapped</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">{row.pourCount}</td>
                        <td className="py-2 px-3 text-right">{row.totalOz.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right">
                          {row.estimatedExposure != null ? (
                            <span className="text-red-600 font-medium">{fmtMoney(row.estimatedExposure)}</span>
                          ) : (
                            <span className="text-gray-900">&mdash;</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {!row.isMapped && (
                            <a
                              href="/settings/integrations/berg"
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Map This PLU
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                    {report.plus.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-gray-900">
                          No dispense events found for this date range.
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

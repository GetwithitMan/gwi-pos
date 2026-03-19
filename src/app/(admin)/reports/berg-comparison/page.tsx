'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

interface ReportRow {
  pluNumber: number
  description: string
  menuItemName: string | null
  menuItemId: string | null
  posCount: number
  posOz: number
  revenue: number
  cost: number
}

interface ReportSummary {
  totalPours: number
  totalOz: number
  totalRevenue: number
  mappingsCount: number
}

interface ReportData {
  summary: ReportSummary
  rows: ReportRow[]
  dateRange: { start: string; end: string }
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

export default function BergComparisonReportPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [bergInputs, setBergInputs] = useState<Record<number, { count: string; oz: string }>>({})

  async function runReport() {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/reports/berg-comparison?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&employeeId=${employee.id}`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data.data ?? null)
      setBergInputs({})
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  function exportCSV() {
    if (!locationId || !employee?.id) return
    window.open(
      `/api/reports/berg-comparison?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&format=csv&employeeId=${employee.id}`
    )
  }

  function updateBergInput(plu: number, field: 'count' | 'oz', value: string) {
    setBergInputs(prev => ({
      ...prev,
      [plu]: { ...prev[plu], [field]: value },
    }))
  }

  function getVariance(posVal: number, bergVal: string) {
    const b = parseFloat(bergVal)
    if (isNaN(b) || b === 0) return null
    return { diff: posVal - b, pct: ((posVal - b) / b) * 100 }
  }

  function varianceColor(pct: number) {
    const abs = Math.abs(pct)
    if (abs < 2) return 'bg-green-50'
    if (abs < 5) return 'bg-yellow-50'
    return 'bg-red-50'
  }

  const inputClass = 'border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 w-20 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-6xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Berg Comparison Report</h1>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-gray-900">to</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
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
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-900">
          No PLU mappings configured. Go to Settings &rarr; Integrations &rarr; Berg to set up PLU mappings.
        </div>
      )}

      {report && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Total Pours</div>
                <div className="text-2xl font-bold mt-1">{report.summary.totalPours}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Total Oz</div>
                <div className="text-2xl font-bold mt-1">{report.summary.totalOz.toFixed(1)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Total Revenue</div>
                <div className="text-2xl font-bold mt-1">{fmtMoney(report.summary.totalRevenue)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Mappings Count</div>
                <div className="text-2xl font-bold mt-1">{report.summary.mappingsCount}</div>
              </CardContent>
            </Card>
          </div>

          {/* Manual mode toggle */}
          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-900 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={manualMode}
                onClick={() => setManualMode(v => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${manualMode ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${manualMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              Manual Comparison Mode
            </label>
          </div>

          {/* Report table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-gray-900">
                      <th className="py-2 px-3 font-medium">PLU #</th>
                      <th className="py-2 px-3 font-medium">Description</th>
                      <th className="py-2 px-3 font-medium">Mapped Item</th>
                      <th className="py-2 px-3 font-medium text-right">POS Count</th>
                      <th className="py-2 px-3 font-medium text-right">POS Oz</th>
                      <th className="py-2 px-3 font-medium text-right">Revenue</th>
                      <th className="py-2 px-3 font-medium text-right">Cost</th>
                      {manualMode && (
                        <>
                          <th className="py-2 px-3 font-medium text-right">Berg Count</th>
                          <th className="py-2 px-3 font-medium text-right">Berg Oz</th>
                          <th className="py-2 px-3 font-medium text-right">Var Count</th>
                          <th className="py-2 px-3 font-medium text-right">Var Oz</th>
                          <th className="py-2 px-3 font-medium text-right">Var %</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.rows.map(row => {
                      const bi = bergInputs[row.pluNumber] ?? { count: '', oz: '' }
                      const varCount = manualMode ? getVariance(row.posCount, bi.count) : null
                      const varOz = manualMode ? getVariance(row.posOz, bi.oz) : null
                      const rowPct = varOz?.pct ?? varCount?.pct
                      const rowClass = manualMode && rowPct != null ? varianceColor(rowPct) : ''

                      return (
                        <tr key={row.pluNumber} className={rowClass}>
                          <td className="py-2 px-3 font-mono">{row.pluNumber}</td>
                          <td className="py-2 px-3">{row.description}</td>
                          <td className="py-2 px-3 text-gray-900">{row.menuItemName ?? '—'}</td>
                          <td className="py-2 px-3 text-right">{row.posCount}</td>
                          <td className="py-2 px-3 text-right">{row.posOz.toFixed(1)}</td>
                          <td className="py-2 px-3 text-right">{fmtMoney(row.revenue)}</td>
                          <td className="py-2 px-3 text-right">{fmtMoney(row.cost)}</td>
                          {manualMode && (
                            <>
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  value={bi.count}
                                  onChange={e => updateBergInput(row.pluNumber, 'count', e.target.value)}
                                  className={inputClass}
                                  placeholder="0"
                                />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  step="0.1"
                                  value={bi.oz}
                                  onChange={e => updateBergInput(row.pluNumber, 'oz', e.target.value)}
                                  className={inputClass}
                                  placeholder="0"
                                />
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {varCount != null ? (varCount.diff > 0 ? '+' : '') + varCount.diff : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {varOz != null ? (varOz.diff > 0 ? '+' : '') + varOz.diff.toFixed(1) : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {rowPct != null ? (rowPct > 0 ? '+' : '') + rowPct.toFixed(1) + '%' : '—'}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                    {report.rows.length === 0 && (
                      <tr>
                        <td colSpan={manualMode ? 12 : 7} className="py-8 text-center text-gray-900">
                          No data for this date range.
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

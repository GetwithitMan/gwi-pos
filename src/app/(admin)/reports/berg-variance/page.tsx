'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

interface VarianceRow {
  pluNumber: number
  description: string
  posRings: number
  bergPours: number
  varCount: number
  posOz: number
  bergOz: number
  varOz: number
  varPct: number
  revenue: number
  alert: boolean
}

interface VarianceSummary {
  totalPosRings: number
  totalBergPours: number
  itemsOverThreshold: number
  unknownPluCount: number
}

interface VarianceData {
  summary: VarianceSummary
  rows: VarianceRow[]
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

function varianceColor(pct: number, threshold: number) {
  const abs = Math.abs(pct)
  if (abs < 2) return 'bg-green-50'
  if (abs < threshold) return 'bg-yellow-50'
  return 'bg-red-50'
}

export default function BergVarianceReportPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [threshold, setThreshold] = useState('5')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<VarianceData | null>(null)

  async function runReport() {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        startDate,
        endDate,
        alertThreshold: threshold,
        employeeId: employee.id,
      })
      const res = await fetch(`/api/reports/berg-variance?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data.data ?? null)
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
      alertThreshold: threshold,
      employeeId: employee.id,
      format: 'csv',
    })
    window.open(`/api/reports/berg-variance?${params}`)
  }

  const dateClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="p-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Berg Variance Report</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={dateClass} />
          <span className="text-gray-400">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={dateClass} />
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500">Alert %</label>
            <input
              type="number"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm w-16"
              min="1"
              max="100"
            />
          </div>
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
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-500">
          No PLU mappings configured. Set up mappings in Settings &rarr; Berg Controls.
        </div>
      )}

      {report && (
        <>
          {/* Data quality warning */}
          {report.summary.unknownPluCount > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-6 text-sm text-amber-800">
              {report.summary.unknownPluCount} pours with unknown PLU excluded &mdash; set up PLU mappings in settings.
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-500 uppercase font-medium">Total POS Rings</div>
                <div className="text-2xl font-bold mt-1">{report.summary.totalPosRings}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-500 uppercase font-medium">Total Berg Pours</div>
                <div className="text-2xl font-bold mt-1">{report.summary.totalBergPours}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-500 uppercase font-medium">Items Over Threshold</div>
                <div className="text-2xl font-bold mt-1 text-red-600">{report.summary.itemsOverThreshold}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-500 uppercase font-medium">Data Quality</div>
                <div className="text-2xl font-bold mt-1">
                  {report.summary.unknownPluCount > 0
                    ? <span className="text-amber-600">Warning</span>
                    : <span className="text-green-600">Good</span>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-gray-500">
                      <th className="py-2 px-3 font-medium">PLU #</th>
                      <th className="py-2 px-3 font-medium">Description</th>
                      <th className="py-2 px-3 font-medium text-right">POS Rings</th>
                      <th className="py-2 px-3 font-medium text-right">Berg Pours</th>
                      <th className="py-2 px-3 font-medium text-right">Var Count</th>
                      <th className="py-2 px-3 font-medium text-right">POS Oz</th>
                      <th className="py-2 px-3 font-medium text-right">Berg Oz</th>
                      <th className="py-2 px-3 font-medium text-right">Var Oz</th>
                      <th className="py-2 px-3 font-medium text-right">Var %</th>
                      <th className="py-2 px-3 font-medium text-right">Revenue</th>
                      <th className="py-2 px-3 font-medium">Alert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.rows.map(row => (
                      <tr key={row.pluNumber} className={varianceColor(row.varPct, parseFloat(threshold) || 5)}>
                        <td className="py-2 px-3 font-mono">{row.pluNumber}</td>
                        <td className="py-2 px-3">{row.description}</td>
                        <td className="py-2 px-3 text-right">{row.posRings}</td>
                        <td className="py-2 px-3 text-right">{row.bergPours}</td>
                        <td className="py-2 px-3 text-right font-mono">{row.varCount > 0 ? '+' : ''}{row.varCount}</td>
                        <td className="py-2 px-3 text-right">{row.posOz.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right">{row.bergOz.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right font-mono">{row.varOz > 0 ? '+' : ''}{row.varOz.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right font-mono">{row.varPct > 0 ? '+' : ''}{row.varPct.toFixed(1)}%</td>
                        <td className="py-2 px-3 text-right">{fmtMoney(row.revenue)}</td>
                        <td className="py-2 px-3">
                          {row.alert && (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Alert</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {report.rows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-gray-400">
                          No variance data for this date range.
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

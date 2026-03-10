'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import type { BergDispenseLogResponse } from '@/lib/berg/report-types'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

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

const STATUS_OPTIONS = ['ALL', 'ACK', 'NAK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT', 'NAK_TIMEOUT'] as const
const LRC_OPTIONS = ['ALL', 'YES', 'NO'] as const

function statusBadge(status: string) {
  if (status === 'ACK' || status === 'ACK_BEST_EFFORT')
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{status}</span>
  if (status === 'ACK_TIMEOUT')
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">{status}</span>
  return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">{status}</span>
}

function lrcBadge(valid: boolean) {
  return valid
    ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Valid</span>
    : <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Invalid</span>
}

export default function BergDispenseReportPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate] = useState(today)
  const [deviceId, setDeviceId] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [lrcFilter, setLrcFilter] = useState('ALL')
  const [includeRaw, setIncludeRaw] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<BergDispenseLogResponse | null>(null)
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([])
  const [devicesLoaded, setDevicesLoaded] = useState(false)

  // Compute summary stats client-side from events
  const summary = useMemo(() => {
    if (!report) return null
    const events = report.events
    let ackCount = 0
    let nakCount = 0
    let badLrcCount = 0
    let latencySum = 0
    let latencyCount = 0
    for (const ev of events) {
      if (ev.status === 'ACK' || ev.status === 'ACK_BEST_EFFORT' || ev.status === 'ACK_TIMEOUT') ackCount++
      if (ev.status === 'NAK' || ev.status === 'NAK_TIMEOUT') nakCount++
      if (!ev.lrcValid) badLrcCount++
      if (ev.ackLatencyMs != null) {
        latencySum += ev.ackLatencyMs
        latencyCount++
      }
    }
    return {
      totalEvents: report.total,
      ackCount,
      nakCount,
      badLrcCount,
      avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
    }
  }, [report])

  async function loadDevices() {
    if (devicesLoaded || !locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/berg/devices?locationId=${locationId}&employeeId=${employee.id}`)
      if (res.ok) {
        const data = await res.json()
        setDevices(data.devices ?? [])
      }
    } catch { /* ignore */ }
    setDevicesLoaded(true)
  }

  useReportAutoRefresh({ onRefresh: () => runReport() })

  async function runReport(p = 1) {
    if (!locationId || !employee?.id) return
    setLoading(true)
    loadDevices()
    try {
      const params = new URLSearchParams({
        locationId,
        startDate,
        endDate,
        employeeId: employee.id,
        page: String(p),
        format: 'json',
      })
      if (deviceId !== 'ALL') params.set('deviceId', deviceId)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (lrcFilter !== 'ALL') params.set('lrcValid', lrcFilter === 'YES' ? 'true' : 'false')

      const res = await fetch(`/api/reports/berg-dispense?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data)
      setPage(p)
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
    if (deviceId !== 'ALL') params.set('deviceId', deviceId)
    if (statusFilter !== 'ALL') params.set('status', statusFilter)
    if (lrcFilter !== 'ALL') params.set('lrcValid', lrcFilter === 'YES' ? 'true' : 'false')
    if (includeRaw) params.set('includeRaw', 'true')
    window.open(`/api/reports/berg-dispense?${params}`)
  }

  const selectClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white'
  const dateClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="p-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Berg Dispense Log</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={dateClass} />
          <span className="text-gray-900">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={dateClass} />
          <select value={deviceId} onChange={e => setDeviceId(e.target.value)} onFocus={loadDevices} className={selectClass}>
            <option value="ALL">All Devices</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectClass}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s}</option>)}
          </select>
          <select value={lrcFilter} onChange={e => setLrcFilter(e.target.value)} className={selectClass}>
            {LRC_OPTIONS.map(s => <option key={s} value={s}>{s === 'ALL' ? 'LRC: All' : `LRC: ${s}`}</option>)}
          </select>
          <Button onClick={() => runReport(1)} disabled={loading}>
            {loading ? 'Running...' : 'Run Report'}
          </Button>
          {report && (
            <>
              <Button variant="outline" onClick={exportCSV}>Export CSV</Button>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={includeRaw} onChange={e => setIncludeRaw(e.target.checked)} />
                Include raw packets
              </label>
            </>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!report && !loading && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-900">
          No dispense events found for this period.
        </div>
      )}

      {report && summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Total Events</div>
                <div className="text-2xl font-bold mt-1">{summary.totalEvents}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">ACK&apos;d</div>
                <div className="text-2xl font-bold mt-1 text-green-600">{summary.ackCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">NAK&apos;d</div>
                <div className="text-2xl font-bold mt-1 text-red-600">{summary.nakCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Bad LRC</div>
                <div className="text-2xl font-bold mt-1 text-red-600">{summary.badLrcCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-gray-900 uppercase font-medium">Avg Latency</div>
                <div className="text-2xl font-bold mt-1">{summary.avgLatencyMs}ms</div>
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
                      <th className="py-2 px-3 font-medium">Time</th>
                      <th className="py-2 px-3 font-medium">Device</th>
                      <th className="py-2 px-3 font-medium">PLU</th>
                      <th className="py-2 px-3 font-medium">Description</th>
                      <th className="py-2 px-3 font-medium">Pour Size</th>
                      <th className="py-2 px-3 font-medium text-right">Cost</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                      <th className="py-2 px-3 font-medium">LRC</th>
                      <th className="py-2 px-3 font-medium text-right">Latency</th>
                      <th className="py-2 px-3 font-medium">Order</th>
                      <th className="py-2 px-3 font-medium">Unmatched</th>
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
                        <td className="py-2 px-3">{statusBadge(ev.status)}</td>
                        <td className="py-2 px-3">{lrcBadge(ev.lrcValid)}</td>
                        <td className="py-2 px-3 text-right font-mono">{ev.ackLatencyMs != null ? `${ev.ackLatencyMs}ms` : '—'}</td>
                        <td className="py-2 px-3">{ev.orderId ?? '—'}</td>
                        <td className="py-2 px-3 text-gray-900">{ev.unmatchedType ?? '—'}</td>
                      </tr>
                    ))}
                    {report.events.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-gray-900">
                          No dispense events found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          {report.pages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => runReport(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-gray-600">Page {page} of {report.pages}</span>
              <Button variant="outline" size="sm" disabled={page >= report.pages} onClick={() => runReport(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import type { BergHealthReportResponse } from '@/lib/berg/report-types'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import Link from 'next/link'

function today() {
  return new Date().toISOString().split('T')[0]
}

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function connectionBadge(lastSeenAt: string | null, minutesSinceLastSeen: number | null) {
  if (!lastSeenAt)
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Never seen</span>
  if (minutesSinceLastSeen != null && minutesSinceLastSeen < 5)
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Connected</span>
  if (minutesSinceLastSeen != null && minutesSinceLastSeen < 30)
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Idle</span>
  return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Offline</span>
}

function latencyColor(ms: number | null) {
  if (ms == null) return ''
  if (ms < 500) return 'text-green-600'
  if (ms < 1500) return 'text-yellow-600'
  return 'text-red-600'
}

export default function BergHealthPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [startDate, setStartDate] = useState(yesterday)
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<BergHealthReportResponse | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runReport = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/reports/berg-health?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}&employeeId=${employee.id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReport(data)
    } catch {
      toast.error('Failed to load health data')
    } finally {
      setLoading(false)
    }
  }, [locationId, employee?.id, startDate, endDate])

  useReportAutoRefresh({ onRefresh: runReport })

  // Auto-refresh every 60 seconds (fallback — kept alongside socket-driven refresh)
  useEffect(() => {
    if (report) {
      intervalRef.current = setInterval(runReport, 60_000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [report, runReport])

  const dateClass = 'border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900'

  return (
    <div className="p-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Bridge Health</h1>
          {report && (
            <div className="text-xs text-gray-900 mt-1">Auto-refreshes every 60s</div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={dateClass} />
          <span className="text-gray-900">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={dateClass} />
          <Button onClick={runReport} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          <Link href="/settings/integrations/berg" className="text-sm text-blue-600 hover:underline">
            Berg Settings
          </Link>
        </div>
      </div>

      {/* NTP warning */}
      {report?.timeSyncWarning && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-6 text-sm text-amber-800">
          NUC clock not NTP-synchronized &mdash; variance reports may be inaccurate.
        </div>
      )}

      {/* Overall alerts */}
      {report && report.overallAlerts.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-6">
          {report.overallAlerts.map((alert, i) => (
            <div key={i} className="text-sm text-red-800">{alert}</div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!report && !loading && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-900">
          No active Berg devices configured.
        </div>
      )}

      {/* Device cards */}
      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {report.devices.map(device => (
            <Card key={device.id}>
              <CardContent className="pt-4">
                {/* Device header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">{device.name}</span>
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {device.model}
                    </span>
                  </div>
                  {connectionBadge(device.lastSeenAt, device.minutesSinceLastSeen)}
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div>
                    <div className="text-xs text-gray-900 uppercase">Events</div>
                    <div className="text-lg font-bold">{device.stats.total}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-900 uppercase">ACK Count</div>
                    <div className="text-lg font-bold text-green-600">{device.stats.ackCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-900 uppercase">NAK Rate</div>
                    <div className="text-lg font-bold text-red-600">{device.stats.nakRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-900 uppercase">LRC Errors</div>
                    <div className="text-lg font-bold">{device.stats.lrcErrorRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-900 uppercase">Avg Latency</div>
                    <div className={`text-lg font-bold ${latencyColor(device.stats.avgAckLatencyMs)}`}>
                      {device.stats.avgAckLatencyMs != null ? `${device.stats.avgAckLatencyMs}ms` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-900 uppercase">Max Latency</div>
                    <div className="text-lg font-bold">
                      {device.stats.maxAckLatencyMs != null ? `${device.stats.maxAckLatencyMs}ms` : '—'}
                    </div>
                  </div>
                </div>

                {/* Dedup rate */}
                {device.stats.dedupRate > 0 && (
                  <div className={`text-xs mb-3 ${device.stats.dedupRate > 5 ? 'text-amber-600 font-medium' : 'text-gray-900'}`}>
                    {device.stats.dedupRate.toFixed(1)}% dedup rate
                    {device.stats.dedupRate > 5 && ' — high duplicate rate detected'}
                  </div>
                )}

                {/* Alerts */}
                {device.alerts.length > 0 && (
                  <div className="space-y-1">
                    {device.alerts.map((alert, i) => (
                      <div key={i} className="inline-block mr-2 mb-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                        {alert}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {report.devices.length === 0 && (
            <div className="col-span-full rounded-lg bg-gray-50 border border-gray-200 p-8 text-center text-sm text-gray-900">
              No active Berg devices configured.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { formatCurrency } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

type ExceptionSeverity = 'critical' | 'high' | 'medium' | 'low'

interface ReportSummary {
  totalDeliveries: number
  completedDeliveries: number
  failedDeliveries: number
  cancelledDeliveries: number
  activeDeliveries: number
  onTimePercent: number
  avgDoorToDoorMinutes: number | null
  avgTotalMinutes: number | null
  totalFeeRevenue: number
  cashVarianceCents: number
  costPerDelivery: number
}

interface DriverPerf {
  driverId: string
  name: string
  totalDeliveries: number
  completedDeliveries: number
  avgDoorToDoorMinutes: number | null
  onTimePercent: number
}

interface ZonePerf {
  zoneId: string | null
  zoneName: string
  totalDeliveries: number
  completedDeliveries: number
  avgDoorToDoorMinutes: number | null
  feeRevenue: number
}

interface DeliveryException {
  id: string
  type: string
  severity: ExceptionSeverity
  description: string
  status: string
  deliveryOrderId: string | null
  driverId: string | null
  driverName: string | null
  deliveryCustomerName: string | null
  createdAt: string
  resolvedAt: string | null
}

interface DashboardData {
  summary: ReportSummary | null
  byDriver: DriverPerf[]
  byZone: ZonePerf[]
  exceptions: DeliveryException[]
  activeCount: number
  lateCount: number
}

// ─── Severity Config ────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<ExceptionSeverity, { dot: string; bg: string; border: string; label: string }> = {
  critical: { dot: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200', label: 'Critical' },
  high:     { dot: 'bg-orange-500', bg: 'bg-orange-50', border: 'border-orange-200', label: 'High' },
  medium:   { dot: 'bg-yellow-500', bg: 'bg-yellow-50', border: 'border-yellow-200', label: 'Medium' },
  low:      { dot: 'bg-green-500', bg: 'bg-green-50', border: 'border-green-200', label: 'Low' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTodayRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  return {
    startDate: start.toISOString(),
    endDate: now.toISOString(),
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function getDriverStatusIndicator(onTimePct: number): { color: string; label: string } {
  if (onTimePct >= 90) return { color: 'bg-green-500', label: 'Excellent' }
  if (onTimePct >= 75) return { color: 'bg-yellow-500', label: 'Fair' }
  return { color: 'bg-red-500', label: 'Needs Attention' }
}

// ─── SOCKET EVENTS ──────────────────────────────────────────────────────────

const DELIVERY_SOCKET_EVENTS = [
  'delivery:status_changed',
  'delivery:run_created',
  'delivery:run_completed',
  'delivery:exception_created',
  'delivery:exception_resolved',
  'driver:status_changed',
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeliveryDashboardPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/delivery/dashboard' })
  const employee = useAuthStore(s => s.employee)
  const deliveryEnabled = useDeliveryFeature('deliveryReportsProvisioned')

  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState<DashboardData>({
    summary: null,
    byDriver: [],
    byZone: [],
    exceptions: [],
    activeCount: 0,
    lateCount: 0,
  })

  // ─── Data fetching ──────────────────────────────────────────────────────

  const loadDashboardData = useCallback(async () => {
    try {
      const { startDate, endDate } = getTodayRange()

      // Parallel fetch: report, exceptions, dispatch (active count)
      const [reportRes, exceptionsRes, dispatchRes] = await Promise.all([
        fetch(`/api/reports/delivery?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        fetch('/api/delivery/exceptions?status=open'),
        fetch('/api/delivery/dispatch'),
      ])

      let summary: ReportSummary | null = null
      let byDriver: DriverPerf[] = []
      let byZone: ZonePerf[] = []

      if (reportRes.ok) {
        const reportJson = await reportRes.json()
        const report = reportJson.report
        if (report) {
          summary = report.summary
          byDriver = report.byDriver ?? []
          byZone = report.byZone ?? []
        }
      }

      let exceptions: DeliveryException[] = []
      if (exceptionsRes.ok) {
        const excJson = await exceptionsRes.json()
        exceptions = excJson.exceptions ?? []
      }

      let activeCount = 0
      let lateCount = 0
      if (dispatchRes.ok) {
        const dispatchJson = await dispatchRes.json()
        const dispatchData = dispatchJson.data ?? dispatchJson
        const orders = dispatchData.orders ?? []
        activeCount = orders.filter((o: any) =>
          o.status === 'out_for_delivery' || o.status === 'ready_for_pickup' || o.status === 'preparing'
        ).length
        lateCount = orders.filter((o: any) => o.isLate).length
      }

      setData({ summary, byDriver, byZone, exceptions, activeCount, lateCount })
    } catch (error) {
      console.error('[DeliveryDashboard] Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (employee?.location?.id && deliveryEnabled) {
      void loadDashboardData()
    } else {
      setIsLoading(false)
    }
  }, [employee?.location?.id, deliveryEnabled, loadDashboardData])

  // ─── Auto-refresh via socket + 60s fallback ───────────────────────────

  useReportAutoRefresh({
    onRefresh: loadDashboardData,
    events: DELIVERY_SOCKET_EVENTS,
    debounceMs: 3000,
    fallbackIntervalMs: 60000,
    enabled: deliveryEnabled,
  })

  // ─── Derived data ─────────────────────────────────────────────────────

  const kpiCards = useMemo(() => {
    const s = data.summary
    if (!s) return []

    const cashVarianceDollars = s.cashVarianceCents / 100

    return [
      // Top row
      {
        label: "Today's Deliveries",
        value: String(s.totalDeliveries),
        sub: `${s.completedDeliveries} completed`,
        color: 'blue' as const,
      },
      {
        label: 'On-Time Rate',
        value: `${s.onTimePercent}%`,
        sub: `${s.completedDeliveries} completed`,
        color: s.onTimePercent >= 85 ? 'green' as const : s.onTimePercent >= 70 ? 'yellow' as const : 'red' as const,
      },
      {
        label: 'Avg Door-to-Door',
        value: s.avgDoorToDoorMinutes != null ? `${s.avgDoorToDoorMinutes} min` : '--',
        sub: 'dispatch to delivery',
        color: 'purple' as const,
      },
      {
        label: 'Active Right Now',
        value: String(data.activeCount),
        sub: data.lateCount > 0 ? `${data.lateCount} running late` : 'on track',
        color: data.lateCount > 0 ? 'red' as const : 'green' as const,
      },
      // Bottom row
      {
        label: 'Late Orders',
        value: String(data.lateCount),
        sub: data.lateCount > 0 ? 'needs attention' : 'none',
        color: data.lateCount > 0 ? 'red' as const : 'green' as const,
        alert: data.lateCount > 0,
      },
      {
        label: 'Cost / Delivery',
        value: formatCurrency(s.costPerDelivery),
        sub: 'mileage + per-delivery',
        color: 'gray' as const,
      },
      {
        label: 'Cash Variance',
        value: formatCurrency(Math.abs(cashVarianceDollars)),
        sub: cashVarianceDollars === 0 ? 'balanced' : cashVarianceDollars > 0 ? 'overage' : 'shortage',
        color: cashVarianceDollars === 0 ? 'green' as const : 'red' as const,
        prefix: cashVarianceDollars < 0 ? '-' : cashVarianceDollars > 0 ? '+' : '',
      },
      {
        label: 'Fee Revenue',
        value: formatCurrency(s.totalFeeRevenue),
        sub: `${data.byZone.length} zone${data.byZone.length !== 1 ? 's' : ''}`,
        color: 'blue' as const,
      },
    ]
  }, [data])

  const sortedExceptions = useMemo(
    () => data.exceptions
      .filter(e => !e.resolvedAt && e.status === 'open')
      .sort((a, b) => {
        const order: Record<ExceptionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4)
      })
      .slice(0, 10),
    [data.exceptions]
  )

  // ─── Render guards ────────────────────────────────────────────────────

  if (!hydrated) return null

  if (!deliveryEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">🚚</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Delivery Dashboard Not Available</h2>
          <p className="text-gray-600 text-sm">
            The delivery dashboard requires delivery reports to be provisioned from Mission Control.
            Contact your administrator to enable delivery for this venue.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-600">Loading delivery dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <AdminPageHeader
          title="Delivery Operations"
          subtitle="Real-time delivery performance and exception monitoring"
          breadcrumbs={[
            { label: 'Delivery', href: '/delivery' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/delivery">
                <Button variant="outline" size="sm">
                  Manage Orders
                </Button>
              </Link>
              <Link href="/dispatch">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Go to Dispatch
                </Button>
              </Link>
              <button
                onClick={() => void loadDashboardData()}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh data"
              >
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          }
        />

        {/* ─── KPI Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {kpiCards.map((card, idx) => (
            <KPICard key={idx} {...card} />
          ))}
        </div>

        {/* ─── Active Exceptions ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Active Exceptions</h2>
              {sortedExceptions.length > 0 && (
                <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded-full bg-red-100 text-red-700">
                  {sortedExceptions.length}
                </span>
              )}
            </div>
            <Link
              href="/delivery?tab=exceptions"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View All
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {sortedExceptions.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-500">
                No open exceptions -- all clear.
              </div>
            ) : (
              sortedExceptions.map(ex => {
                const sev = SEVERITY_CONFIG[ex.severity]
                return (
                  <div key={ex.id} className={`px-5 py-3 flex items-start gap-3 ${sev.bg}`}>
                    <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 capitalize">
                          {ex.type.replace(/_/g, ' ')}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                          ex.severity === 'critical' ? 'bg-red-600 text-white'
                            : ex.severity === 'high' ? 'bg-orange-500 text-white'
                            : ex.severity === 'medium' ? 'bg-yellow-500 text-white'
                            : 'bg-gray-400 text-white'
                        }`}>
                          {sev.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5 line-clamp-1">{ex.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        {ex.driverName && <span>Driver: {ex.driverName}</span>}
                        {ex.deliveryCustomerName && <span>Customer: {ex.deliveryCustomerName}</span>}
                        <span>{timeAgo(ex.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ─── Two-column: Drivers + Zones ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Driver Performance */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Driver Performance (Today)</h2>
              <Link
                href="/settings/delivery/drivers"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Manage Drivers
              </Link>
            </div>
            {data.byDriver.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-500">
                No driver data for today.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Driver</th>
                      <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Deliveries</th>
                      <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">On-Time</th>
                      <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Time</th>
                      <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.byDriver.map(driver => {
                      const status = getDriverStatusIndicator(driver.onTimePercent)
                      return (
                        <tr key={driver.driverId} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3">
                            <span className="font-medium text-gray-900">{driver.name}</span>
                          </td>
                          <td className="text-center px-3 py-3 text-gray-700">{driver.totalDeliveries}</td>
                          <td className="text-center px-3 py-3">
                            <span className={`font-medium ${
                              driver.onTimePercent >= 90 ? 'text-green-600'
                                : driver.onTimePercent >= 75 ? 'text-yellow-600'
                                : 'text-red-600'
                            }`}>
                              {driver.onTimePercent}%
                            </span>
                          </td>
                          <td className="text-center px-3 py-3 text-gray-700">
                            {driver.avgDoorToDoorMinutes != null ? `${driver.avgDoorToDoorMinutes} min` : '--'}
                          </td>
                          <td className="text-center px-3 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${status.color}`} />
                              <span className="text-xs text-gray-500">{status.label}</span>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Zone Performance */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Zone Performance (Today)</h2>
              <Link
                href="/settings/delivery/zones"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Manage Zones
              </Link>
            </div>
            {data.byZone.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-500">
                No zone data for today.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Zone</th>
                      <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Orders</th>
                      <th className="text-center px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Time</th>
                      <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.byZone.map(zone => (
                      <tr key={zone.zoneId ?? zone.zoneName} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <span className="font-medium text-gray-900">{zone.zoneName}</span>
                        </td>
                        <td className="text-center px-3 py-3 text-gray-700">{zone.totalDeliveries}</td>
                        <td className="text-center px-3 py-3 text-gray-700">
                          {zone.avgDoorToDoorMinutes != null ? `${zone.avgDoorToDoorMinutes} min` : '--'}
                        </td>
                        <td className="text-right px-5 py-3 font-medium text-gray-900">
                          {formatCurrency(zone.feeRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ─── Quick Links Footer ────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <Link href="/delivery" className="text-blue-600 hover:text-blue-700 font-medium">
            Order Management
          </Link>
          <span className="text-gray-300">|</span>
          <Link href="/dispatch" className="text-blue-600 hover:text-blue-700 font-medium">
            Dispatch Board
          </Link>
          <span className="text-gray-300">|</span>
          <Link href="/settings/delivery" className="text-blue-600 hover:text-blue-700 font-medium">
            Delivery Settings
          </Link>
          <span className="text-gray-300">|</span>
          <Link href="/settings/delivery/zones" className="text-blue-600 hover:text-blue-700 font-medium">
            Zone Config
          </Link>
          <span className="text-gray-300">|</span>
          <Link href="/settings/delivery/drivers" className="text-blue-600 hover:text-blue-700 font-medium">
            Driver Config
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── KPI Card Component ─────────────────────────────────────────────────────

interface KPICardProps {
  label: string
  value: string
  sub: string
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray'
  alert?: boolean
  prefix?: string
}

const COLOR_MAP: Record<KPICardProps['color'], {
  bg: string
  border: string
  icon: string
  value: string
}> = {
  blue:   { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-500', value: 'text-blue-700' },
  green:  { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-500', value: 'text-green-700' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'text-yellow-500', value: 'text-yellow-700' },
  red:    { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-500', value: 'text-red-700' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-500', value: 'text-purple-700' },
  gray:   { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-500', value: 'text-gray-700' },
}

function KPICard({ label, value, sub, color, alert, prefix }: KPICardProps) {
  const c = COLOR_MAP[color]
  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4 transition-all hover:shadow-sm ${alert ? 'ring-2 ring-red-300 animate-pulse' : ''}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${c.value}`}>
        {prefix}{value}
      </div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatTime } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { getSharedSocket, releaseSharedSocket, isSharedSocketConnected } from '@/lib/shared-socket'

// ============================================================================
// TYPES
// ============================================================================

interface OpenOrder {
  id: string
  orderNumber: number
  displayNumber: string
  status: string
  orderType: string
  orderTypeConfig: { name: string; color: string | null; icon: string | null } | null
  tabName: string | null
  tableName: string | null
  table: { id: string; name: string; section: string | null } | null
  employee: { id: string; name: string }
  itemCount: number
  total: number
  ageMinutes: number
  createdAt: string
  openedAt: string
}

interface ClockedInEmployee {
  id: string
  employeeId: string
  employeeName: string
  clockIn: string
  breakMinutes: number
  isOnBreak: boolean
  hourlyRate: number | null
}

interface DailyRevenue {
  netSales: number
  totalCollected: number
  checks: number
}

// W4-5: Employee performance metrics
interface EmployeePerformance {
  employeeId: string
  name: string
  totalSales: number
  orderCount: number
  avgCheckSize: number
  totalTips: number
  voidCount: number
  voidAmount: number
  discountCount: number
  discountAmount: number
}

// W4-6: Dashboard alert
interface DashboardAlert {
  id: string
  timestamp: Date
  type: 'info' | 'warning' | 'error' | 'success'
  title: string
  message: string
  dismissed: boolean
}

// ============================================================================
// HELPERS
// ============================================================================

function getAgeColor(minutes: number): string {
  if (minutes > 20) return 'text-red-600 bg-red-50'
  if (minutes >= 10) return 'text-amber-600 bg-amber-50'
  return 'text-green-600 bg-green-50'
}

function getHoursOnShift(clockIn: string): string {
  const mins = Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000)
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs === 0) return `${rem}m`
  return `${hrs}h ${rem}m`
}

function getTodayDateStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function getAlertBorderColor(type: string): string {
  switch (type) {
    case 'error': return 'border-l-red-500 bg-red-50'
    case 'warning': return 'border-l-amber-500 bg-amber-50'
    case 'info': return 'border-l-blue-500 bg-blue-50'
    case 'success': return 'border-l-green-500 bg-green-50'
    default: return 'border-l-gray-400 bg-gray-50'
  }
}

function getAlertIconColor(type: string): string {
  switch (type) {
    case 'error': return 'text-red-600'
    case 'warning': return 'text-amber-600'
    case 'info': return 'text-blue-600'
    case 'success': return 'text-green-600'
    default: return 'text-gray-500'
  }
}

function getAlertIcon(type: string): string {
  switch (type) {
    case 'error': return '\u26A0'   // warning sign
    case 'warning': return '\u26A0' // warning sign
    case 'info': return '\u2139'    // info
    case 'success': return '\u2713' // checkmark
    default: return '\u2022'        // bullet
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function ManagerDashboardPage() {
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/dashboard' })

  // Existing state
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [staff, setStaff] = useState<ClockedInEmployee[]>([])
  const [revenue, setRevenue] = useState<DailyRevenue>({ netSales: 0, totalCollected: 0, checks: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now())
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  // W4-5: Employee performance state
  const [employeeStats, setEmployeeStats] = useState<EmployeePerformance[]>([])

  // W4-6: Alert state
  const [alerts, setAlerts] = useState<DashboardAlert[]>([])

  // Tick for "last updated" display
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  const locationId = currentEmployee?.location?.id

  // ------------------------------------------
  // Data fetching (core dashboard)
  // ------------------------------------------
  const refreshData = useCallback(async () => {
    if (!locationId) return

    try {
      const [ordersRes, staffRes, reportRes] = await Promise.all([
        fetch(`/api/orders/open?summary=true&locationId=${locationId}`),
        fetch(`/api/time-clock?locationId=${locationId}&openOnly=true`),
        fetch(`/api/reports/daily?locationId=${locationId}&requestingEmployeeId=${currentEmployee?.id}`),
      ])

      if (ordersRes.ok) {
        const data = await ordersRes.json()
        setOrders(data.data?.orders ?? [])
      }

      if (staffRes.ok) {
        const data = await staffRes.json()
        setStaff(data.data?.entries ?? [])
      }

      if (reportRes.ok) {
        const data = await reportRes.json()
        const r = data.data?.revenue
        const s = data.data?.stats
        if (r && s) {
          setRevenue({
            netSales: r.netSales ?? 0,
            totalCollected: r.totalCollected ?? 0,
            checks: s.checks ?? 0,
          })
        }
      }
    } catch (err) {
      console.error('Dashboard refresh failed:', err)
    } finally {
      setIsLoading(false)
      setLastRefresh(Date.now())
    }
  }, [locationId, currentEmployee?.id])

  // ------------------------------------------
  // W4-5: Employee performance data fetch
  // ------------------------------------------
  const refreshEmployeeStats = useCallback(async () => {
    if (!locationId || !currentEmployee?.id) return

    const today = getTodayDateStr()
    const baseParams = `locationId=${locationId}&requestingEmployeeId=${currentEmployee.id}&startDate=${today}&endDate=${today}`

    try {
      const [perfRes, voidsRes, discountsRes] = await Promise.all([
        fetch(`/api/reports/server-performance?${baseParams}`),
        fetch(`/api/reports/voids?${baseParams}`),
        fetch(`/api/reports/discounts?${baseParams}`),
      ])

      // Parse server performance data
      const perfData = perfRes.ok ? await perfRes.json() : null
      const servers: Array<{
        employeeId: string
        name: string
        totalSales: number
        orderCount: number
        avgCheckSize: number
        totalTips: number
      }> = perfData?.data?.servers ?? []

      // Parse voids data — build map by employeeId
      const voidsData = voidsRes.ok ? await voidsRes.json() : null
      const voidsByEmployee: Record<string, { voids: number; comps: number; amount: number }> = {}
      if (voidsData?.data?.summary?.byEmployee) {
        for (const emp of voidsData.data.summary.byEmployee) {
          // The voids report returns byEmployee as an array of { name, voids, comps, amount }
          // but doesn't include employeeId in the array. Match by name instead.
          voidsByEmployee[emp.name] = {
            voids: (emp.voids ?? 0) + (emp.comps ?? 0),
            comps: emp.comps ?? 0,
            amount: emp.amount ?? 0,
          }
        }
      }

      // Parse discounts data — build map by employeeId
      const discountsData = discountsRes.ok ? await discountsRes.json() : null
      const discountsByEmployee: Record<string, { count: number; totalAmount: number }> = {}
      if (discountsData?.data?.byEmployee) {
        for (const emp of discountsData.data.byEmployee) {
          discountsByEmployee[emp.id] = {
            count: emp.count ?? 0,
            totalAmount: emp.totalAmount ?? 0,
          }
        }
      }

      // Merge into unified employee stats
      const merged: EmployeePerformance[] = servers.map(s => {
        const voidData = voidsByEmployee[s.name] ?? { voids: 0, amount: 0 }
        const discountData = discountsByEmployee[s.employeeId] ?? { count: 0, totalAmount: 0 }

        return {
          employeeId: s.employeeId,
          name: s.name,
          totalSales: s.totalSales,
          orderCount: s.orderCount,
          avgCheckSize: s.avgCheckSize,
          totalTips: s.totalTips,
          voidCount: voidData.voids,
          voidAmount: voidData.amount,
          discountCount: discountData.count,
          discountAmount: discountData.totalAmount,
        }
      })

      setEmployeeStats(merged)
    } catch (err) {
      console.error('Employee stats refresh failed:', err)
    }
  }, [locationId, currentEmployee?.id])

  // Initial load
  useEffect(() => {
    if (locationId) {
      refreshData()
      refreshEmployeeStats()
    }
  }, [locationId, refreshData, refreshEmployeeStats])

  // ------------------------------------------
  // Socket: real-time updates
  // ------------------------------------------
  const refreshRef = useRef(refreshData)
  refreshRef.current = refreshData

  useEffect(() => {
    if (!locationId) return

    const socket = getSharedSocket()

    const debounceTimer = { current: null as ReturnType<typeof setTimeout> | null }

    const debouncedRefresh = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        refreshRef.current()
      }, 500)
    }

    // W4-6: Listen for location alerts
    const onAlert = (data: {
      type: 'info' | 'warning' | 'error' | 'success'
      title: string
      message: string
    }) => {
      const newAlert: DashboardAlert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date(),
        type: data.type,
        title: data.title,
        message: data.message,
        dismissed: false,
      }
      setAlerts(prev => [newAlert, ...prev].slice(0, 50))
    }

    const onConnect = () => refreshRef.current()

    socket.on('orders:list-changed', debouncedRefresh)
    socket.on('order:totals-updated', debouncedRefresh)
    socket.on('employee:clock-changed', debouncedRefresh)
    socket.on('location:alert', onAlert)
    socket.on('connect', onConnect)

    return () => {
      socket.off('orders:list-changed', debouncedRefresh)
      socket.off('order:totals-updated', debouncedRefresh)
      socket.off('employee:clock-changed', debouncedRefresh)
      socket.off('location:alert', onAlert)
      socket.off('connect', onConnect)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      releaseSharedSocket()
    }
  }, [locationId])

  // ------------------------------------------
  // Fallback polling (60s when socket disconnected)
  // ------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      // Skip polling when socket is connected — real-time events handle updates
      if (isSharedSocketConnected()) return
      refreshRef.current()
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // ------------------------------------------
  // Derived stats
  // ------------------------------------------
  const agingAlertCount = orders.filter(o => o.ageMinutes > 20).length
  const sortedOrders = [...orders].sort((a, b) => b.ageMinutes - a.ageMinutes)
  const secondsAgo = Math.floor((Date.now() - lastRefresh) / 1000)

  // W4-5: Average check size for risk highlighting
  const avgCheckAcrossAll = useMemo(() => {
    if (employeeStats.length === 0) return 0
    const totalSales = employeeStats.reduce((sum, e) => sum + e.totalSales, 0)
    const totalOrders = employeeStats.reduce((sum, e) => sum + e.orderCount, 0)
    return totalOrders > 0 ? totalSales / totalOrders : 0
  }, [employeeStats])

  // W4-6: Visible alerts (not dismissed)
  const visibleAlerts = alerts.filter(a => !a.dismissed)

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a))
  }, [])

  const dismissAllAlerts = useCallback(() => {
    setAlerts(prev => prev.map(a => ({ ...a, dismissed: true })))
  }, [])

  // ------------------------------------------
  // Permission check
  // ------------------------------------------
  const permissions = currentEmployee?.permissions ?? []
  const isManager = permissions.includes('reports.view') ||
    permissions.includes('admin.full') ||
    permissions.includes('*')

  if (!hydrated || !currentEmployee) return null

  if (!isManager) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader title="Manager Dashboard" />
        <div className="text-center py-20 text-gray-500">
          You do not have permission to view this page.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Manager Dashboard"
        subtitle={
          <span className="text-xs text-gray-400">
            Last updated: {secondsAgo < 5 ? 'just now' : `${secondsAgo}s ago`}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refreshData(); refreshEmployeeStats() }}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* ================================================================ */}
      {/* W4-6: REAL-TIME ALERT PANEL                                     */}
      {/* ================================================================ */}
      {visibleAlerts.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Alerts</h2>
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                {visibleAlerts.length}
              </span>
            </div>
            <button
              onClick={dismissAllAlerts}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Dismiss all
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
            {visibleAlerts.map(alert => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 px-5 py-3 border-l-4 ${getAlertBorderColor(alert.type)}`}
              >
                <span className={`text-lg leading-none mt-0.5 ${getAlertIconColor(alert.type)}`}>
                  {getAlertIcon(alert.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-900">{alert.title}</span>
                    <span className="text-[10px] text-gray-400">
                      {alert.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5 truncate">{alert.message}</p>
                </div>
                <button
                  onClick={() => dismissAlert(alert.id)}
                  className="text-gray-300 hover:text-gray-500 transition-colors text-sm leading-none"
                  aria-label="Dismiss alert"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* QUICK STATS */}
      {/* ================================================================ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Open Orders"
          value={String(orders.length)}
          color="blue"
        />
        <StatCard
          label="Revenue Today"
          value={formatCurrency(revenue.totalCollected)}
          color="green"
        />
        <StatCard
          label="Staff on Floor"
          value={String(staff.length)}
          color="purple"
        />
        <StatCard
          label="Aging Alerts"
          value={String(agingAlertCount)}
          color={agingAlertCount > 0 ? 'red' : 'gray'}
        />
      </div>

      {/* ================================================================ */}
      {/* OPEN ORDERS TABLE */}
      {/* ================================================================ */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Open Orders</h2>
          <p className="text-xs text-gray-500 mt-0.5">Sorted by age — oldest first</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : sortedOrders.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No open orders</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Order #</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Table / Tab</th>
                  <th className="px-5 py-3">Server</th>
                  <th className="px-5 py-3 text-right">Items</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Age</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedOrders.map(order => (
                  <tr
                    key={order.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setExpandedOrderId(prev => prev === order.id ? null : order.id)}
                  >
                    <td className="px-5 py-3 font-medium text-gray-900">
                      #{order.displayNumber}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: order.orderTypeConfig?.color
                            ? `${order.orderTypeConfig.color}20`
                            : '#f3f4f6',
                          color: order.orderTypeConfig?.color || '#6b7280',
                        }}
                      >
                        {order.orderTypeConfig?.name || order.orderType}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {order.table?.name || order.tabName || '\u2014'}
                    </td>
                    <td className="px-5 py-3 text-gray-700">{order.employee.name}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{order.itemCount}</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">
                      {formatCurrency(order.total)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getAgeColor(order.ageMinutes)}`}>
                        {order.ageMinutes}m
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium capitalize">
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================================================================ */}
      {/* CLOCKED-IN STAFF */}
      {/* ================================================================ */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Clocked-In Staff</h2>
          <p className="text-xs text-gray-500 mt-0.5">{staff.length} employee{staff.length !== 1 ? 's' : ''} on the clock</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : staff.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No employees clocked in</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Clock-In Time</th>
                  <th className="px-5 py-3">Hours on Shift</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {staff.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">{emp.employeeName}</td>
                    <td className="px-5 py-3 text-gray-600">{formatTime(emp.clockIn)}</td>
                    <td className="px-5 py-3 text-gray-600">{getHoursOnShift(emp.clockIn)}</td>
                    <td className="px-5 py-3">
                      {emp.isOnBreak ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-medium">
                          On Break
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-green-50 text-green-700 text-xs font-medium">
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================================================================ */}
      {/* W4-5: EMPLOYEE PERFORMANCE                                      */}
      {/* ================================================================ */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Employee Performance</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Today&apos;s per-employee metrics with risk indicators
          </p>
        </div>

        {employeeStats.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No employee data for today</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3 text-right">Sales</th>
                  <th className="px-5 py-3 text-right">Orders</th>
                  <th className="px-5 py-3 text-right">Avg Check</th>
                  <th className="px-5 py-3 text-right">Tips</th>
                  <th className="px-5 py-3 text-right">Voids</th>
                  <th className="px-5 py-3 text-right">Void %</th>
                  <th className="px-5 py-3 text-right">Discounts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employeeStats.map(emp => {
                  const voidPct = emp.orderCount > 0
                    ? (emp.voidCount / emp.orderCount) * 100
                    : 0
                  const isHighVoid = voidPct > 5
                  const isHighDiscount = emp.discountCount > 10
                  const isLowAvgCheck = avgCheckAcrossAll > 0 && emp.avgCheckSize < avgCheckAcrossAll * 0.7

                  // Row highlight: red if high void, amber if high discounts
                  let rowClass = 'hover:bg-gray-50 transition-colors'
                  if (isHighVoid) {
                    rowClass = 'bg-red-50/50 hover:bg-red-50 transition-colors'
                  } else if (isHighDiscount) {
                    rowClass = 'bg-amber-50/50 hover:bg-amber-50 transition-colors'
                  }

                  return (
                    <tr key={emp.employeeId} className={rowClass}>
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {emp.name}
                        {isHighVoid && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">
                            HIGH VOIDS
                          </span>
                        )}
                        {isHighDiscount && !isHighVoid && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                            FREQ. DISCOUNTS
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900">
                        {formatCurrency(emp.totalSales)}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {emp.orderCount}
                      </td>
                      <td className={`px-5 py-3 text-right ${isLowAvgCheck ? 'text-gray-400 italic' : 'text-gray-600'}`}>
                        {formatCurrency(emp.avgCheckSize)}
                        {isLowAvgCheck && (
                          <span className="ml-1 text-[10px] text-gray-400" title="Below location average">&darr;</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {formatCurrency(emp.totalTips)}
                      </td>
                      <td className={`px-5 py-3 text-right ${isHighVoid ? 'text-red-700 font-semibold' : 'text-gray-600'}`}>
                        {emp.voidCount}
                        {emp.voidAmount > 0 && (
                          <span className="text-[10px] text-gray-400 ml-1">
                            ({formatCurrency(emp.voidAmount)})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          isHighVoid
                            ? 'bg-red-100 text-red-700'
                            : voidPct > 0
                              ? 'bg-gray-100 text-gray-600'
                              : 'text-gray-400'
                        }`}>
                          {voidPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className={`px-5 py-3 text-right ${isHighDiscount ? 'text-amber-700 font-semibold' : 'text-gray-600'}`}>
                        {emp.discountCount}
                        {emp.discountAmount > 0 && (
                          <span className="text-[10px] text-gray-400 ml-1">
                            ({formatCurrency(emp.discountAmount)})
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

        {/* Legend */}
        {employeeStats.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-4 text-[10px] text-gray-400">
            <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1"></span>High void rate (&gt;5%)</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>Frequent discounts (&gt;10 today)</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-gray-300 mr-1"></span>&darr; Below avg check size</span>
          </div>
        )}
      </section>
    </div>
  )
}

// ============================================================================
// STAT CARD
// ============================================================================

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-500',
  }

  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.gray}`}>
      <p className="text-xs font-medium opacity-70 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatTime } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

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

// ============================================================================
// COMPONENT
// ============================================================================

export default function ManagerDashboardPage() {
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/dashboard' })

  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [staff, setStaff] = useState<ClockedInEmployee[]>([])
  const [revenue, setRevenue] = useState<DailyRevenue>({ netSales: 0, totalCollected: 0, checks: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now())
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  // Tick for "last updated" display
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  const locationId = currentEmployee?.location?.id

  // ------------------------------------------
  // Data fetching
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

  // Initial load
  useEffect(() => {
    if (locationId) refreshData()
  }, [locationId, refreshData])

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

    socket.on('orders:list-changed', debouncedRefresh)
    socket.on('order:totals-updated', debouncedRefresh)
    socket.on('employee:clock-changed', debouncedRefresh)
    socket.on('connect', () => refreshRef.current())

    return () => {
      socket.off('orders:list-changed', debouncedRefresh)
      socket.off('order:totals-updated', debouncedRefresh)
      socket.off('employee:clock-changed', debouncedRefresh)
      socket.off('connect')
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      releaseSharedSocket()
    }
  }, [locationId])

  // ------------------------------------------
  // Fallback polling (60s when socket disconnected)
  // ------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
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
          <Button variant="outline" size="sm" onClick={() => refreshData()}>
            Refresh
          </Button>
        }
      />

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
                      {order.table?.name || order.tabName || '—'}
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
      <section className="bg-white rounded-xl shadow-sm border border-gray-200">
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

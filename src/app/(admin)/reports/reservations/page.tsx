'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, reportsSubNav } from '@/components/admin/AdminSubNav'

interface Summary {
  totalReservations: number
  totalCovers: number
  avgPartySize: number
  completedCount: number
  noShowCount: number
  cancelledCount: number
  completionRate: number
  noShowRate: number
  cancellationRate: number
  totalRevenue: number
  avgRevenuePerReservation: number
}

interface StatusBreakdown {
  status: string
  count: number
  percentage: number
}

interface DayOfWeek {
  day: string
  dayNum: number
  count: number
  covers: number
  noShows: number
}

interface TimeSlot {
  time: string
  hour: number
  count: number
  covers: number
}

interface TableStat {
  table: string
  count: number
  covers: number
  completed: number
  noShows: number
}

interface DailyTrend {
  date: string
  count: number
  covers: number
  completed: number
  noShows: number
  cancelled: number
}

interface PartySizeDistribution {
  size: string
  count: number
}

interface Reservation {
  id: string
  guestName: string
  partySize: number
  date: string
  time: string
  status: string
  table?: string
  orderTotal?: number | null
}

export default function ReservationReportsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([])
  const [byDayOfWeek, setByDayOfWeek] = useState<DayOfWeek[]>([])
  const [byTimeSlot, setByTimeSlot] = useState<TimeSlot[]>([])
  const [byTable, setByTable] = useState<TableStat[]>([])
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([])
  const [partySizeDistribution, setPartySizeDistribution] = useState<PartySizeDistribution[]>([])
  const [recentReservations, setRecentReservations] = useState<Reservation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'patterns' | 'tables' | 'list'>('overview')

  // Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/reservations')
      return
    }
    loadReport()
  }, [isAuthenticated, router, startDate, endDate])

  const loadReport = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
      })

      const res = await fetch(`/api/reports/reservations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setStatusBreakdown(data.statusBreakdown)
        setByDayOfWeek(data.byDayOfWeek)
        setByTimeSlot(data.byTimeSlot)
        setByTable(data.byTable)
        setDailyTrend(data.dailyTrend)
        setPartySizeDistribution(data.partySizeDistribution)
        setRecentReservations(data.recentReservations)
      }
    } catch (error) {
      console.error('Failed to load reservation report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-blue-100 text-blue-800'
      case 'seated': return 'bg-yellow-100 text-yellow-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'cancelled': return 'bg-gray-100 text-gray-800'
      case 'no_show': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Reservation Reports"
        subtitle="Analyze booking patterns and utilization"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />
      <AdminSubNav items={reportsSubNav} basePath="/reports" />

      <div className="max-w-7xl mx-auto">

        {/* Date Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - 7)
                    setStartDate(d.toISOString().split('T')[0])
                    setEndDate(new Date().toISOString().split('T')[0])
                  }}
                >
                  Last 7 Days
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - 30)
                    setStartDate(d.toISOString().split('T')[0])
                    setEndDate(new Date().toISOString().split('T')[0])
                  }}
                >
                  Last 30 Days
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading report...</div>
        ) : (
          <>
            {/* Summary Cards */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{summary.totalReservations}</p>
                    <p className="text-xs text-gray-600">Reservations</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{summary.totalCovers}</p>
                    <p className="text-xs text-gray-600">Total Covers</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{summary.avgPartySize}</p>
                    <p className="text-xs text-gray-600">Avg Party</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{summary.completionRate}%</p>
                    <p className="text-xs text-gray-600">Completed</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{summary.noShowRate}%</p>
                    <p className="text-xs text-gray-600">No-Show</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-gray-600">{summary.cancellationRate}%</p>
                    <p className="text-xs text-gray-600">Cancelled</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalRevenue)}</p>
                    <p className="text-xs text-gray-600">Revenue</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{formatCurrency(summary.avgRevenuePerReservation)}</p>
                    <p className="text-xs text-gray-600">Avg/Res</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
              <Button
                variant={activeTab === 'overview' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </Button>
              <Button
                variant={activeTab === 'patterns' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('patterns')}
              >
                Patterns
              </Button>
              <Button
                variant={activeTab === 'tables' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('tables')}
              >
                By Table
              </Button>
              <Button
                variant={activeTab === 'list' ? 'primary' : 'ghost'}
                onClick={() => setActiveTab('list')}
              >
                Reservations
              </Button>
            </div>

            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Status Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>By Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {statusBreakdown.map(s => (
                        <div key={s.status} className="flex items-center justify-between">
                          <span className={`px-2 py-1 rounded text-xs capitalize ${getStatusColor(s.status)}`}>
                            {s.status.replace('_', ' ')}
                          </span>
                          <div className="flex-1 mx-4">
                            <div className="h-2 bg-gray-200 rounded">
                              <div
                                className={`h-2 rounded ${
                                  s.status === 'completed' ? 'bg-green-500' :
                                  s.status === 'no_show' ? 'bg-red-500' :
                                  s.status === 'cancelled' ? 'bg-gray-500' :
                                  'bg-blue-500'
                                }`}
                                style={{ width: `${s.percentage}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-sm font-medium">{s.count} ({s.percentage}%)</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Party Size Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Party Size Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {partySizeDistribution.map(p => {
                        const percentage = summary?.totalReservations
                          ? Math.round((p.count / summary.totalReservations) * 100)
                          : 0
                        return (
                          <div key={p.size} className="flex items-center justify-between">
                            <span className="text-sm font-medium w-16">{p.size} guests</span>
                            <div className="flex-1 mx-4">
                              <div className="h-4 bg-gray-200 rounded">
                                <div
                                  className="h-4 bg-blue-500 rounded"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-sm">{p.count} ({percentage}%)</span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Daily Trend */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Daily Reservations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <div className="min-w-[600px] h-48">
                        <div className="flex h-full items-end gap-1">
                          {dailyTrend.map(d => {
                            const maxCount = Math.max(...dailyTrend.map(x => x.count))
                            const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0
                            return (
                              <div key={d.date} className="flex-1 flex flex-col items-center">
                                <div
                                  className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                                  style={{ height: `${height}%`, minHeight: d.count > 0 ? '4px' : '0' }}
                                  title={`${d.date}: ${d.count} reservations, ${d.covers} covers`}
                                />
                                <span className="text-[8px] text-gray-500 mt-1 -rotate-45 origin-left">
                                  {d.date.split('-').slice(1).join('/')}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'patterns' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* By Day of Week */}
                <Card>
                  <CardHeader>
                    <CardTitle>By Day of Week</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {byDayOfWeek.map(d => {
                        const maxCount = Math.max(...byDayOfWeek.map(x => x.count))
                        const width = maxCount > 0 ? (d.count / maxCount) * 100 : 0
                        return (
                          <div key={d.day} className="flex items-center gap-2">
                            <span className="text-sm w-24">{d.day}</span>
                            <div className="flex-1 h-6 bg-gray-200 rounded relative">
                              <div
                                className="h-6 bg-blue-500 rounded"
                                style={{ width: `${width}%` }}
                              />
                              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                                {d.count} res / {d.covers} covers
                              </span>
                            </div>
                            {d.noShows > 0 && (
                              <span className="text-xs text-red-600">{d.noShows} NS</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* By Time Slot */}
                <Card>
                  <CardHeader>
                    <CardTitle>By Time Slot</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 max-h-80 overflow-y-auto">
                      {byTimeSlot.map(t => {
                        const maxCount = Math.max(...byTimeSlot.map(x => x.count))
                        const width = maxCount > 0 ? (t.count / maxCount) * 100 : 0
                        return (
                          <div key={t.time} className="flex items-center gap-2">
                            <span className="text-sm font-mono w-12">{t.time}</span>
                            <div className="flex-1 h-5 bg-gray-200 rounded">
                              <div
                                className="h-5 bg-green-500 rounded"
                                style={{ width: `${width}%` }}
                              />
                            </div>
                            <span className="text-xs w-20 text-right">
                              {t.count} / {t.covers}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'tables' && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Table</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Reservations</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Covers</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Completed</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">No-Shows</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Completion Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {byTable.map(t => (
                          <tr key={t.table} className="hover:bg-gray-50">
                            <td className="p-3 font-medium">{t.table}</td>
                            <td className="p-3 text-right">{t.count}</td>
                            <td className="p-3 text-right">{t.covers}</td>
                            <td className="p-3 text-right text-green-600">{t.completed}</td>
                            <td className="p-3 text-right text-red-600">{t.noShows}</td>
                            <td className="p-3 text-right">
                              {t.count > 0 ? Math.round((t.completed / t.count) * 100) : 0}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'list' && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Date</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Time</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Guest</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Party</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Table</th>
                          <th className="text-left p-3 text-sm font-medium text-gray-600">Status</th>
                          <th className="text-right p-3 text-sm font-medium text-gray-600">Order Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {recentReservations.map(r => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="p-3">{new Date(r.date).toLocaleDateString()}</td>
                            <td className="p-3 font-mono">{r.time}</td>
                            <td className="p-3">{r.guestName}</td>
                            <td className="p-3 text-right">{r.partySize}</td>
                            <td className="p-3">{r.table || '-'}</td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded text-xs capitalize ${getStatusColor(r.status)}`}>
                                {r.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              {r.orderTotal ? formatCurrency(r.orderTotal) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}

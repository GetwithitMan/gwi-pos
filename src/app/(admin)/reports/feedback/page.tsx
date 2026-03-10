'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface FeedbackEntry {
  id: string
  orderId: string | null
  rating: number
  comment: string | null
  source: string
  tags: string[]
  employeeId: string | null
  createdAt: string
}

interface FeedbackAggregates {
  totalCount: number
  averageRating: number
  npsScore: number
  ratingDistribution: Record<number, number>
  topTags: Array<{ tag: string; count: number }>
}

interface FeedbackData {
  entries: FeedbackEntry[]
  aggregates: FeedbackAggregates
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ color: i < rating ? '#fbbf24' : '#475569', fontSize: 16 }}>&#9733;</span>
      ))}
    </span>
  )
}

export default function FeedbackDashboardPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/feedback' })
  const employee = useAuthStore(s => s.employee)

  const [data, setData] = useState<FeedbackData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [ratingFilter, setRatingFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  const loadData = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        requestingEmployeeId: employee.id,
        startDate,
        endDate,
      })
      if (ratingFilter) params.set('rating', ratingFilter)
      if (sourceFilter) params.set('source', sourceFilter)

      const res = await fetch(`/api/feedback?${params}`)
      if (res.ok) {
        const json = await res.json()
        setData(json.data)
      } else {
        toast.error('Failed to load feedback data')
      }
    } catch {
      toast.error('Failed to load feedback data')
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, startDate, endDate, ratingFilter, sourceFilter])

  useReportAutoRefresh({ onRefresh: loadData })

  useEffect(() => {
    if (employee?.location?.id) loadData()
  }, [employee?.location?.id, loadData])

  if (!hydrated) return null

  const agg = data?.aggregates
  const entries = data?.entries ?? []
  const dist = agg?.ratingDistribution ?? {}
  const maxDistCount = Math.max(...Object.values(dist), 1)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Customer Feedback"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="text-xs text-gray-500 block mb-1">From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border rounded px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border rounded px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Rating</label>
          <select value={ratingFilter} onChange={e => setRatingFilter(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
            <option value="">All</option>
            {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r} Star{r > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Source</label>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
            <option value="">All</option>
            <option value="in_store">In-Store</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="web">Web</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">Average Rating</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{agg?.averageRating?.toFixed(1) ?? '—'}</div>
                <StarRating rating={Math.round(agg?.averageRating ?? 0)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">NPS Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" style={{ color: (agg?.npsScore ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                  {agg?.npsScore ?? 0}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {(agg?.npsScore ?? 0) >= 50 ? 'Excellent' : (agg?.npsScore ?? 0) >= 0 ? 'Good' : 'Needs improvement'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">Total Responses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{agg?.totalCount ?? 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">Low Ratings (1-2)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">
                  {(dist[1] ?? 0) + (dist[2] ?? 0)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Rating Distribution + Tags */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Rating Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {[5, 4, 3, 2, 1].map(star => (
                  <div key={star} className="flex items-center gap-2 mb-2">
                    <span className="text-sm w-12 text-right">{star} star</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${maxDistCount > 0 ? ((dist[star] ?? 0) / maxDistCount) * 100 : 0}%`,
                          background: star >= 4 ? '#16a34a' : star === 3 ? '#f59e0b' : '#dc2626',
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                    <span className="text-sm text-gray-500 w-8">{dist[star] ?? 0}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Tags */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Top Feedback Tags</CardTitle>
              </CardHeader>
              <CardContent>
                {(agg?.topTags ?? []).length === 0 ? (
                  <p className="text-gray-400 text-sm">No tagged feedback yet</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {agg!.topTags.map(t => (
                      <span
                        key={t.tag}
                        className="px-3 py-1 rounded-full text-sm font-medium"
                        style={{
                          background: 'rgba(79, 70, 229, 0.1)',
                          color: '#4f46e5',
                        }}
                      >
                        {t.tag.replace(/_/g, ' ')} ({t.count})
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-500">Recent Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">No feedback yet</p>
              ) : (
                <div className="divide-y">
                  {entries.map(entry => (
                    <div key={entry.id} className="py-3 flex items-start gap-3">
                      <div className="flex-shrink-0 pt-0.5">
                        <StarRating rating={entry.rating} />
                      </div>
                      <div className="flex-1 min-w-0">
                        {entry.comment && (
                          <p className="text-sm text-gray-700 mb-1">{entry.comment}</p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>{formatDate(entry.createdAt)}</span>
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{entry.source.replace('_', ' ')}</span>
                          {entry.tags.length > 0 && entry.tags.map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{tag.replace(/_/g, ' ')}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

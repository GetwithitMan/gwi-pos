'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

type ReportTab = 'summary' | 'revenue' | 'declines' | 'by_plan' | 'aging'

export default function MembershipReportsPage() {
  const ready = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const [tab, setTab] = useState<ReportTab>('summary')
  const [data, setData] = useState<any>(null)
  const [period, setPeriod] = useState('monthly')
  const [loading, setLoading] = useState(false)

  const fetchReport = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        requestingEmployeeId: employee.id,
        type: tab,
        period,
      })
      const res = await fetch(`/api/reports/memberships?${params}`)
      const json = await res.json()
      setData(json.data)
    } catch { /* */ }
    setLoading(false)
  }, [locationId, employee?.id, tab, period])

  useEffect(() => { if (ready) fetchReport() }, [ready, fetchReport])

  const exportCSV = () => {
    if (!data) return
    const rows = tab === 'summary'
      ? [['Metric', 'Value'], ...Object.entries(data)]
      : tab === 'revenue'
        ? [['Period', 'Collected', 'Failed', 'Recovered'], ...(data.rows || []).map((r: any) => [r.period, r.collected, r.failed, r.recovered])]
        : tab === 'aging'
          ? [['Bucket', 'Count', 'Amount'], ...(data.buckets || []).map((b: any) => [b.label, b.count, b.amount])]
          : tab === 'by_plan'
            ? [['Plan', 'Active', 'MRR', 'Churned'], ...(data.plans || []).map((p: any) => [p.planName, p.activeCount, p.mrr, p.churned30d])]
            : [['Reason', 'Count'], ...(data.byReason || []).map((r: any) => [r.declineReason, r.count])]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `memberships-${tab}-report.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!ready) return null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminPageHeader title="Membership Reports" subtitle="Revenue, churn, and billing analytics" />

      <div className="flex gap-2 mb-6 border-b">
        {(['summary', 'revenue', 'declines', 'by_plan', 'aging'] as ReportTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-900 hover:text-gray-900'
            }`}
          >
            {t.replace('_', ' ')}
          </button>
        ))}
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={exportCSV}>Export CSV</Button>
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-900">Loading...</div>}

      {!loading && data && tab === 'summary' && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="text-sm text-gray-900">Active</div>
            <div className="text-3xl font-bold">{data.activeCount}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-900">MRR</div>
            <div className="text-3xl font-bold">{formatCurrency(data.mrr)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-900">ARR</div>
            <div className="text-3xl font-bold">{formatCurrency(data.arr)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-900">Churn Rate</div>
            <div className="text-3xl font-bold">{data.churnRate}%</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-gray-900">Past Due</div>
            <div className="text-3xl font-bold text-orange-600">{data.pastDueCount}</div>
          </Card>
        </div>
      )}

      {!loading && data && tab === 'revenue' && (
        <div>
          <div className="flex gap-2 mb-4">
            {['daily', 'weekly', 'monthly'].map(p => (
              <Button key={p} size="sm" variant={period === p ? 'default' : 'outline'} onClick={() => setPeriod(p)}>{p}</Button>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-gray-900"><th className="pb-2">Period</th><th>Collected</th><th>Failed</th><th>Recovered</th><th>Success</th><th>Fail</th></tr></thead>
            <tbody>
              {(data.rows || []).map((r: any, i: number) => (
                <tr key={i} className="border-b"><td className="py-1">{r.period?.split('T')[0]}</td><td>{formatCurrency(r.collected)}</td><td>{formatCurrency(r.failed)}</td><td>{formatCurrency(r.recovered)}</td><td>{r.successCount}</td><td>{r.failCount}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data && tab === 'declines' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4"><div className="text-sm text-gray-900">Total Declines (90d)</div><div className="text-2xl font-bold">{data.totalDeclines}</div></Card>
            <Card className="p-4"><div className="text-sm text-gray-900">Retry Success Rate</div><div className="text-2xl font-bold">{data.retrySuccessRate}%</div></Card>
          </div>
          <div>
            <h3 className="font-semibold mb-2">By Reason</h3>
            <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="pb-2">Reason</th><th>Count</th><th>Amount</th></tr></thead>
              <tbody>{(data.byReason || []).map((r: any, i: number) => (
                <tr key={i} className="border-b"><td className="py-1">{r.declineReason || 'Unknown'}</td><td>{r.count}</td><td>{formatCurrency(r.totalAmount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div>
            <h3 className="font-semibold mb-2">By Failure Type</h3>
            <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="pb-2">Type</th><th>Count</th></tr></thead>
              <tbody>{(data.byType || []).map((r: any, i: number) => (
                <tr key={i} className="border-b"><td className="py-1">{r.failureType || 'Unknown'}</td><td>{r.count}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && data && tab === 'by_plan' && (
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-gray-900"><th className="pb-2">Plan</th><th>Price</th><th>Active</th><th>MRR</th><th>Churned (30d)</th></tr></thead>
          <tbody>
            {(data.plans || []).map((p: any) => (
              <tr key={p.planId} className="border-b"><td className="py-2 font-medium">{p.planName}</td><td>{formatCurrency(Number(p.planPrice))}</td><td>{p.activeCount}</td><td>{formatCurrency(p.mrr)}</td><td>{p.churned30d}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && data && tab === 'aging' && (
        <div className="space-y-4">
          {(data.buckets || []).map((b: any, i: number) => {
            const colors = ['bg-yellow-200', 'bg-orange-200', 'bg-orange-300', 'bg-red-300']
            return (
              <div key={i} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium">{b.label}</div>
                <div className={`h-8 rounded ${colors[i] || 'bg-gray-200'}`} style={{ width: `${Math.max(b.count * 20, 8)}px` }} />
                <div className="text-sm">{b.count} members — {formatCurrency(b.amount)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

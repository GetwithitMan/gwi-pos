'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface DailyData {
  reportDate: string
  revenue: {
    netSales: number
    totalCollected: number
    discounts: number
    tips: number
  }
  voids: {
    total: { amount: number }
    percentOfSales: number
  }
  labor: {
    total: { hours: number; cost: number; percentOfSales: number }
  }
  stats: {
    checks: number
    avgCheck: number
    covers: number
  }
}

interface FlashMetric {
  label: string
  value: string
  delta: string | null
  deltaUp: boolean | null
  color: string
}

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function getDayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function calcDelta(current: number, previous: number): { text: string; up: boolean } | null {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return { text: '+100%', up: true }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const sign = pct >= 0 ? '+' : ''
  return { text: `${sign}${pct.toFixed(1)}%`, up: pct >= 0 }
}

function exportFlashCSV(metrics: FlashMetric[], dateStr: string) {
  const header = ['Metric', 'Value', 'vs Previous Day'].join(',')
  const rows = metrics.map(m =>
    [`"${m.label}"`, `"${m.value}"`, `"${m.delta || 'N/A'}"`].join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flash-report-${dateStr}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function FlashReportPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/flash' })
  const employee = useAuthStore(s => s.employee)
  const [selectedDate, setSelectedDate] = useState(getYesterday)
  const [current, setCurrent] = useState<DailyData | null>(null)
  const [previous, setPrevious] = useState<DailyData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (employee?.location?.id) {
      loadFlashData()
    }
  }, [employee?.location?.id, selectedDate])

  const loadFlashData = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const prevDate = getDayBefore(selectedDate)
      const [curRes, prevRes] = await Promise.all([
        fetch(`/api/reports/daily?locationId=${employee.location.id}&date=${selectedDate}&employeeId=${employee.id}`),
        fetch(`/api/reports/daily?locationId=${employee.location.id}&date=${prevDate}&employeeId=${employee.id}`),
      ])
      if (curRes.ok) {
        const d = await curRes.json()
        setCurrent(d.data)
      } else {
        setCurrent(null)
      }
      if (prevRes.ok) {
        const d = await prevRes.json()
        setPrevious(d.data)
      } else {
        setPrevious(null)
      }
    } catch (error) {
      console.error('Failed to load flash report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!hydrated) return null

  const metrics: FlashMetric[] = current ? (() => {
    const p = previous
    const items: FlashMetric[] = []

    const netDelta = p ? calcDelta(current.revenue.netSales, p.revenue.netSales) : null
    items.push({
      label: 'Net Sales',
      value: formatCurrency(current.revenue.netSales),
      delta: netDelta?.text ?? null,
      deltaUp: netDelta?.up ?? null,
      color: 'text-green-600',
    })

    const orderDelta = p ? calcDelta(current.stats.checks, p.stats.checks) : null
    items.push({
      label: 'Total Orders',
      value: String(current.stats.checks),
      delta: orderDelta?.text ?? null,
      deltaUp: orderDelta?.up ?? null,
      color: 'text-blue-600',
    })

    const avgDelta = p ? calcDelta(current.stats.avgCheck, p.stats.avgCheck) : null
    items.push({
      label: 'Avg Check',
      value: formatCurrency(current.stats.avgCheck),
      delta: avgDelta?.text ?? null,
      deltaUp: avgDelta?.up ?? null,
      color: 'text-purple-600',
    })

    items.push({
      label: 'Labor %',
      value: `${current.labor.total.percentOfSales.toFixed(1)}%`,
      delta: p ? `${(current.labor.total.percentOfSales - p.labor.total.percentOfSales).toFixed(1)}pp` : null,
      deltaUp: p ? current.labor.total.percentOfSales <= p.labor.total.percentOfSales : null,
      color: current.labor.total.percentOfSales > 35 ? 'text-red-600' : current.labor.total.percentOfSales > 30 ? 'text-amber-600' : 'text-green-600',
    })

    items.push({
      label: 'Void %',
      value: `${current.voids.percentOfSales.toFixed(1)}%`,
      delta: p ? `${(current.voids.percentOfSales - p.voids.percentOfSales).toFixed(1)}pp` : null,
      deltaUp: p ? current.voids.percentOfSales <= p.voids.percentOfSales : null,
      color: current.voids.percentOfSales > 5 ? 'text-red-600' : 'text-gray-700',
    })

    const discDelta = p ? calcDelta(current.revenue.discounts, p.revenue.discounts) : null
    items.push({
      label: 'Discount Total',
      value: formatCurrency(current.revenue.discounts),
      delta: discDelta?.text ?? null,
      deltaUp: discDelta ? !discDelta.up : null,
      color: 'text-red-600',
    })

    const tipDelta = p ? calcDelta(current.revenue.tips, p.revenue.tips) : null
    items.push({
      label: 'Tips Total',
      value: formatCurrency(current.revenue.tips),
      delta: tipDelta?.text ?? null,
      deltaUp: tipDelta?.up ?? null,
      color: 'text-orange-600',
    })

    return items
  })() : []

  const dateFormatted = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Flash Report"
        subtitle={dateFormatted}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            />
            {metrics.length > 0 && (
              <Button variant="outline" onClick={() => exportFlashCSV(metrics, selectedDate)}>
                Export CSV
              </Button>
            )}
          </div>
        }
      />

      <div className="max-w-5xl mx-auto">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading flash report...</div>
        ) : !current ? (
          <div className="text-center py-12 text-gray-500">No data available for this date</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {metrics.map((m) => (
              <Card key={m.label}>
                <CardContent className="p-5">
                  <p className="text-sm text-gray-500 mb-1">{m.label}</p>
                  <p className={`text-3xl font-bold ${m.color}`}>{m.value}</p>
                  {m.delta !== null && (
                    <p className={`text-sm mt-1 font-medium ${m.deltaUp ? 'text-green-600' : 'text-red-600'}`}>
                      {m.delta} vs prev day
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

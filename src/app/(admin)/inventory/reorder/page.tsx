'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface Vendor {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface ReorderSuggestion {
  id: string
  name: string
  sku: string | null
  category: string
  department: string
  currentStock: number
  storageUnit: string
  parLevel: number | null
  reorderPoint: number | null
  reorderQty: number | null
  costPerUnit: number
  lastInvoiceCost: number | null
  estimatedCost: number | null
  severity: 'critical' | 'warning'
  vendor: Vendor | null
}

interface Summary {
  critical: number
  warning: number
  total: number
}

export default function ReorderSuggestionsPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/inventory/reorder' })

  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([])
  const [summary, setSummary] = useState<Summary>({ critical: 0, warning: 0, total: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all')

  const loadSuggestions = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/inventory/reorder-suggestions?locationId=${employee.location.id}`)
      if (res.ok) {
        const data = await res.json()
        setSuggestions(data.data.suggestions || [])
        setSummary(data.data.summary || { critical: 0, warning: 0, total: 0 })
      } else {
        toast.error('Failed to load reorder suggestions')
      }
    } catch (error) {
      console.error('Failed to load reorder suggestions:', error)
      toast.error('Failed to load reorder suggestions')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (employee?.location?.id) loadSuggestions()
  }, [employee?.location?.id])

  // Filter suggestions
  const filtered = useMemo(() => {
    if (filter === 'all') return suggestions
    return suggestions.filter(s => s.severity === filter)
  }, [suggestions, filter])

  // Group by vendor
  const groupedByVendor = useMemo(() => {
    const groups: Record<string, { vendor: Vendor | null; items: ReorderSuggestion[] }> = {}
    for (const item of filtered) {
      const key = item.vendor?.id || '_no_vendor'
      if (!groups[key]) {
        groups[key] = { vendor: item.vendor, items: [] }
      }
      groups[key].items.push(item)
    }
    // Sort: vendors with items first, no-vendor last
    return Object.values(groups).sort((a, b) => {
      if (!a.vendor && b.vendor) return 1
      if (a.vendor && !b.vendor) return -1
      return (a.vendor?.name || '').localeCompare(b.vendor?.name || '')
    })
  }, [filtered])

  // Total estimated cost
  const totalEstimatedCost = useMemo(() => {
    return filtered.reduce((sum, s) => sum + (s.estimatedCost || 0), 0)
  }, [filtered])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Reorder Suggestions"
        subtitle="Items below par level or reorder point"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Button variant="outline" onClick={loadSuggestions} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card
          className={`cursor-pointer transition-colors ${filter === 'critical' ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => setFilter(f => f === 'critical' ? 'all' : 'critical')}
        >
          <CardContent className="p-4">
            <p className="text-sm text-red-600">Critical</p>
            <p className="text-3xl font-bold text-red-700">{summary.critical}</p>
            <p className="text-xs text-red-500">Below reorder point</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${filter === 'warning' ? 'ring-2 ring-amber-400' : ''}`}
          onClick={() => setFilter(f => f === 'warning' ? 'all' : 'warning')}
        >
          <CardContent className="p-4">
            <p className="text-sm text-amber-600">Low Stock</p>
            <p className="text-3xl font-bold text-amber-700">{summary.warning}</p>
            <p className="text-xs text-amber-500">Below par level</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Total Items</p>
            <p className="text-3xl font-bold text-gray-900">{summary.total}</p>
            <p className="text-xs text-gray-900">Need attention</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Est. Reorder Cost</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalEstimatedCost)}</p>
            <p className="text-xs text-gray-900">Based on last invoice</p>
          </CardContent>
        </Card>
      </div>

      {/* Content */}
      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-900">
            Loading reorder suggestions...
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-gray-900 text-lg mb-2">All stocked up!</p>
            <p className="text-gray-900 text-sm">No items currently need reordering.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedByVendor.map((group) => (
            <Card key={group.vendor?.id || '_no_vendor'}>
              {/* Vendor Header */}
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {group.vendor?.name || 'No Vendor Assigned'}
                  </h3>
                  {group.vendor && (
                    <div className="flex gap-4 text-xs text-gray-900 mt-0.5">
                      {group.vendor.phone && <span>{group.vendor.phone}</span>}
                      {group.vendor.email && <span>{group.vendor.email}</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-900">{group.items.length} items</span>
                  {group.vendor && (
                    <Link href={`/inventory/orders/new?vendor=${group.vendor.id}&fromReorder=1`}>
                      <Button variant="outline" size="sm">Create PO</Button>
                    </Link>
                  )}
                </div>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">Item</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-900 uppercase">Current</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-900 uppercase">Par Level</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-900 uppercase">Reorder Pt</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-900 uppercase">Order Qty</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-900 uppercase">Est. Cost</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-900 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {group.items.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-900">
                            {item.category}
                            {item.sku && ` / ${item.sku}`}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm">
                          <span className={item.severity === 'critical' ? 'text-red-600 font-bold' : 'text-amber-600 font-medium'}>
                            {item.currentStock.toFixed(1)}
                          </span>
                          <span className="text-gray-900 ml-1">{item.storageUnit}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600">
                          {item.parLevel !== null ? `${item.parLevel.toFixed(1)}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600">
                          {item.reorderPoint !== null ? `${item.reorderPoint.toFixed(1)}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                          {item.reorderQty !== null ? `${item.reorderQty.toFixed(1)} ${item.storageUnit}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">
                          {item.estimatedCost !== null ? formatCurrency(item.estimatedCost) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                            item.severity === 'critical'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {item.severity === 'critical' ? 'Critical' : 'Low'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

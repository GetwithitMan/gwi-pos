'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

interface Invoice {
  id: string
  vendorId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  deliveryDate: string | null
  subtotal: number
  totalAmount: number
  status: string
  source: string
  marginEdgeInvoiceId: string | null
  lineItemCount: number
  createdAt: string
}

interface Vendor {
  id: string
  name: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-900',
  pending: 'bg-yellow-100 text-yellow-800',
  posted: 'bg-green-100 text-green-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-emerald-100 text-emerald-800',
  voided: 'bg-red-100 text-red-700',
}

const SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-blue-100 text-blue-700',
  marginedge: 'bg-purple-100 text-purple-700',
  api: 'bg-indigo-100 text-indigo-700',
}

export default function InvoicesPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/invoices' })
  const locationId = employee?.location?.id

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  // Filters
  const [vendorFilter, setVendorFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const loadInvoices = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        requestingEmployeeId: employee.id,
        page: String(page),
      })
      if (vendorFilter) params.set('vendorId', vendorFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/invoices?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setInvoices(data.data.invoices)
      setTotal(data.data.total)
    } catch {
      toast.error('Failed to load invoices')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, employee?.id, page, vendorFilter, statusFilter, sourceFilter, startDate, endDate])

  const loadVendors = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/inventory/vendors?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setVendors(data.data.vendors || [])
      }
    } catch {
      // silent
    }
  }, [locationId])

  useEffect(() => { loadInvoices() }, [loadInvoices])
  useEffect(() => { loadVendors() }, [loadVendors])

  const handlePost = async (invoiceId: string) => {
    if (!locationId || !employee?.id) return
    if (!confirm('Post this invoice? This will update inventory item costs and cascade to recipes.')) return

    try {
      const res = await fetch(`/api/invoices/${invoiceId}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, requestingEmployeeId: employee.id }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to post')
      }
      const data = await res.json()
      const result = data.data
      toast.success(
        `Invoice posted. ${result.costsUpdated} costs updated, ${result.recipesRecalculated} recipes recalculated.`
      )
      if (result.significantChanges?.length > 0) {
        toast.warning(
          `${result.significantChanges.length} significant cost change(s) detected. Check alerts.`
        )
      }
      loadInvoices()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post invoice')
    }
  }

  const handleDelete = async (invoiceId: string) => {
    if (!locationId || !employee?.id) return
    if (!confirm('Delete this draft invoice?')) return

    try {
      const res = await fetch(
        `/api/invoices/${invoiceId}?locationId=${locationId}&requestingEmployeeId=${employee.id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete')
      }
      toast.success('Invoice deleted')
      loadInvoices()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete invoice')
    }
  }

  const totalPages = useMemo(() => Math.ceil(total / 50), [total])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Invoices"
        subtitle={`${total} invoice${total !== 1 ? 's' : ''}`}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Link href="/invoices/new">
            <Button>+ New Invoice</Button>
          </Link>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={vendorFilter}
          onChange={(e) => { setVendorFilter(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Vendors</option>
          {vendors.map(v => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="posted">Posted</option>
          <option value="paid">Paid</option>
          <option value="voided">Voided</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Sources</option>
          <option value="manual">Manual</option>
          <option value="marginedge">MarginEdge</option>
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm"
          placeholder="Start date"
        />
        <span className="text-gray-900 text-sm">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm"
          placeholder="End date"
        />

        {(vendorFilter || statusFilter || sourceFilter || startDate || endDate) && (
          <button
            onClick={() => {
              setVendorFilter('')
              setStatusFilter('')
              setSourceFilter('')
              setStartDate('')
              setEndDate('')
              setPage(1)
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-gray-900">Loading...</p>
      ) : invoices.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-900">
            No invoices found. Create your first invoice to start tracking costs.
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invoice #</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Source</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Items</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {new Date(inv.invoiceDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-medium">{inv.vendorName}</td>
                    <td className="px-4 py-3 text-gray-600">{inv.invoiceNumber || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      ${inv.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[inv.status] || 'bg-gray-100'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[inv.source] || 'bg-gray-100'}`}>
                        {inv.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {inv.lineItemCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/invoices/new?edit=${inv.id}`}>
                          <Button variant="outline" size="sm">View</Button>
                        </Link>
                        {inv.status === 'draft' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePost(inv.id)}
                              className="text-green-700 border-green-300 hover:bg-green-50"
                            >
                              Post
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(inv.id)}
                              className="text-red-600"
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages} ({total} total)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

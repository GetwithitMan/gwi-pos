'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, inventorySubNav } from '@/components/admin/AdminSubNav'

interface InventoryItem {
  id: string
  name: string
  sku: string | null
  storageUnit: string
}

interface Transaction {
  id: string
  inventoryItemId: string
  inventoryItem: InventoryItem
  type: string
  quantityBefore: number
  quantityChange: number
  quantityAfter: number
  unitCost: number | null
  totalCost: number | null
  reason: string | null
  createdAt: string
}

interface Pagination {
  total: number
  limit: number
  skip: number
  hasMore: boolean
}

// Transaction type colors as specified in the plan
const TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  purchase: { bg: 'bg-green-100', text: 'text-green-700', label: 'Purchase' },
  sale: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Sale' },
  adjustment: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Adjustment' },
  waste: { bg: 'bg-red-100', text: 'text-red-700', label: 'Waste' },
  transfer: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Transfer' },
  count: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Count' },
}

const TRANSACTION_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'sale', label: 'Sale' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'waste', label: 'Waste' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'count', label: 'Count' },
]

export default function TransactionsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7) // Last 7 days
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  // Pagination
  const [page, setPage] = useState(0)
  const limit = 50

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/transactions')
      return
    }
    loadTransactions()
  }, [isAuthenticated, router])

  // Reload when filters change
  useEffect(() => {
    if (employee?.location?.id) {
      setPage(0) // Reset to first page
      loadTransactions(0)
    }
  }, [type, startDate, endDate])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (employee?.location?.id) {
        setPage(0)
        loadTransactions(0)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const loadTransactions = async (pageNum?: number) => {
    if (!employee?.location?.id) return
    setIsLoading(true)

    const currentPage = pageNum ?? page
    const params = new URLSearchParams({
      locationId: employee.location.id,
      limit: String(limit),
      skip: String(currentPage * limit),
    })

    if (type) params.set('type', type)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (search) params.set('search', search)

    try {
      const res = await fetch(`/api/inventory/transactions?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTransactions(data.transactions || [])
        setPagination(data.pagination || null)
      } else {
        toast.error('Failed to load transactions')
      }
    } catch (error) {
      console.error('Failed to load transactions:', error)
      toast.error('Failed to load transactions')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadTransactions(newPage)
  }

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getTypeStyle = (transactionType: string) => {
    return TYPE_COLORS[transactionType] || TYPE_COLORS.adjustment
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Inventory Transactions"
        subtitle="View all inventory movements and adjustments"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
      />
      <AdminSubNav items={inventorySubNav} basePath="/inventory" />

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Search Item</label>
              <input
                type="text"
                placeholder="Search by item name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="border rounded px-3 py-2 min-w-[150px]"
              >
                {TRANSACTION_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border rounded px-3 py-2"
              />
            </div>
            <Button variant="outline" onClick={() => loadTransactions()}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {pagination && (
        <div className="mb-4 text-sm text-gray-600">
          Showing {transactions.length} of {pagination.total} transactions
        </div>
      )}

      {/* Transactions Table */}
      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            Loading transactions...
          </CardContent>
        </Card>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            No transactions found for the selected filters.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Change</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Before</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">After</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transactions.map(tx => {
                  const style = getTypeStyle(tx.type)
                  return (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{tx.inventoryItem.name}</div>
                        {tx.inventoryItem.sku && (
                          <div className="text-xs text-gray-500">{tx.inventoryItem.sku}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium whitespace-nowrap">
                        <span className={tx.quantityChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {tx.quantityChange >= 0 ? '+' : ''}{tx.quantityChange.toFixed(2)} {tx.inventoryItem.storageUnit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 whitespace-nowrap">
                        {tx.quantityBefore.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 whitespace-nowrap">
                        {tx.quantityAfter.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 whitespace-nowrap">
                        {tx.totalCost !== null ? formatCurrency(tx.totalCost) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                        {tx.reason || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.total > limit && (
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Page {page + 1} of {Math.ceil(pagination.total / limit)}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => handlePageChange(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasMore}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

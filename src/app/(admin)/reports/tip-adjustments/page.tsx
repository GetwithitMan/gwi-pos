'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

interface TipEligiblePayment {
  id: string
  orderId: string
  orderNumber: number
  locationId: string
  paymentMethod: string
  cardBrand: string | null
  cardLast4: string | null
  amount: number
  tipAmount: number
  totalAmount: number
  datacapRecordNo: string
  datacapRefNumber: string | null
  paymentReaderId: string | null
  entryMethod: string | null
  createdAt: string
}

export default function TipAdjustmentReportPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const employee = useAuthStore(s => s.employee)

  const [payments, setPayments] = useState<TipEligiblePayment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newTipAmounts, setNewTipAmounts] = useState<Record<string, string>>({})
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const locationId = employee?.location?.id

  const loadPayments = useCallback(async () => {
    if (!locationId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        startDate,
        endDate,
      })
      const res = await fetch(`/api/payments/tip-eligible?${params}`)
      if (!res.ok) throw new Error('Failed to load payments')
      const data = await res.json()
      setPayments(data.data?.payments || [])
    } catch (error) {
      console.error('Failed to load tip-eligible payments:', error)
      toast.error('Failed to load payments')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, startDate, endDate])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/tip-adjustments')
      return
    }
    if (locationId) {
      loadPayments()
    }
  }, [isAuthenticated, router, locationId, loadPayments])

  const handleAdjustTip = async (payment: TipEligiblePayment) => {
    const newTipStr = newTipAmounts[payment.id]
    const newTip = parseFloat(newTipStr)

    if (isNaN(newTip) || newTip < 0) {
      toast.error('Enter a valid tip amount')
      return
    }

    if (Math.abs(newTip - payment.tipAmount) < 0.01) {
      setEditingId(null)
      return
    }

    setAdjustingId(payment.id)
    try {
      // Step 1: Adjust gratuity on the card processor
      const adjustRes = await fetch('/api/datacap/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: payment.locationId,
          readerId: payment.paymentReaderId,
          recordNo: payment.datacapRecordNo,
          purchaseAmount: payment.amount,
          gratuityAmount: newTip,
          employeeId: employee?.id,
        }),
      })

      const adjustData = await adjustRes.json()

      if (!adjustData.data?.approved) {
        toast.error(adjustData.data?.error?.message || 'Processor rejected tip adjustment')
        return
      }

      // Step 2: Update the payment record in our DB
      const batchRes = await fetch('/api/orders/batch-adjust-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustments: [{
            orderId: payment.orderId,
            paymentId: payment.id,
            tipAmount: newTip,
          }],
          employeeId: employee?.id,
        }),
      })

      if (!batchRes.ok) throw new Error('Failed to update tip in database')

      toast.success(`Tip adjusted to ${formatCurrency(newTip)} for order #${payment.orderNumber}`)
      setEditingId(null)

      // Refresh
      setPayments(prev =>
        prev.map(p => p.id === payment.id
          ? { ...p, tipAmount: newTip, totalAmount: p.amount + newTip }
          : p
        )
      )
    } catch (error) {
      console.error('Tip adjustment failed:', error)
      toast.error('Tip adjustment failed')
    } finally {
      setAdjustingId(null)
    }
  }

  const handleExportCSV = () => {
    if (payments.length === 0) {
      toast.error('No data to export')
      return
    }

    const headers = ['Date/Time', 'Order #', 'Card', 'Last 4', 'Entry', 'Amount', 'Tip', 'Total']
    const rows = payments.map(p => [
      new Date(p.createdAt).toLocaleString(),
      p.orderNumber,
      p.cardBrand || '',
      p.cardLast4 || '',
      p.entryMethod || '',
      p.amount.toFixed(2),
      p.tipAmount.toFixed(2),
      p.totalAmount.toFixed(2),
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tip-adjustments-${startDate}-to-${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const totalTips = payments.reduce((sum, p) => sum + p.tipAmount, 0)
  const totalSales = payments.reduce((sum, p) => sum + p.amount, 0)

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Tip Adjustments"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <Button variant="outline" onClick={handleExportCSV} disabled={payments.length === 0}>
            Export CSV
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button variant="primary" onClick={loadPayments} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Apply Filters'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Card Payments</p>
              <p className="text-2xl font-bold text-blue-600">{payments.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSales)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">Total Tips</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(totalTips)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Payments Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-500">Loading payments...</p>
              </div>
            ) : payments.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No card payments found for the selected date range
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date/Time</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Order #</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Card</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Entry</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Original Tip</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">New Tip</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {formatDateTime(payment.createdAt)}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          #{payment.orderNumber}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium">{payment.cardBrand || 'Card'}</span>
                          {payment.cardLast4 && (
                            <span className="text-gray-400 ml-1">***{payment.cardLast4}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {payment.entryMethod || '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatCurrency(payment.amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-green-600">
                          {formatCurrency(payment.tipAmount)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {editingId === payment.id ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newTipAmounts[payment.id] ?? payment.tipAmount.toFixed(2)}
                              onChange={(e) => setNewTipAmounts(prev => ({
                                ...prev,
                                [payment.id]: e.target.value,
                              }))}
                              className="w-24 px-2 py-1 border rounded text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAdjustTip(payment)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                            />
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {editingId === payment.id ? (
                            <div className="flex gap-1 justify-center">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleAdjustTip(payment)}
                                disabled={adjustingId === payment.id}
                              >
                                {adjustingId === payment.id ? 'Saving...' : 'Save'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingId(null)}
                                disabled={adjustingId === payment.id}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingId(payment.id)
                                setNewTipAmounts(prev => ({
                                  ...prev,
                                  [payment.id]: payment.tipAmount.toFixed(2),
                                }))
                              }}
                            >
                              Adjust
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
